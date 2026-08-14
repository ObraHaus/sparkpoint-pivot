"""Who holds which Sparky Broker, and which of them are activated (feature 044).

Two questions, one problem. The gallery asks *"which brokers does this wallet hold?"*; the revenue
allocation asks *"every activated broker, its holder, and its weight"*. Neither can be answered by
the contracts alone: `SparkyBroker` is solady ERC-721 and is **not enumerable**, so there is no
`tokenOfOwnerByIndex` and no way to walk 10,000 ids without 10,000 calls.

So this module walks **logs**, which is the only enumeration a chain actually offers:

* ``Transfer(from, to, tokenId)`` on the collection — every mint and every change of hands.
* ``Activated(holder, tokenId, tier, srkRetired, weightBps)`` on each registry — every activation.

**Logs are a CANDIDATE SET, never the verdict.** The same discipline as ``broker_gate``: an event
says something happened once, and the chain says what is true now. A holder who sold a broker still
has their old ``Transfer`` in the log forever, and a broker activated last month may have been sold
since — so every answer here is narrowed by a live ``ownerOf`` / ``activatedAt`` read before it is
returned. A log-derived answer that skips that step is a stale answer that looks authoritative.

⚠️ The activation events must be read across **every registry ever wired**, for the same reason the
gate does: re-pointing the NFT's ``activator`` orphans the previous registry's record with no
on-chain recovery, and a holder who paid would silently stop counting.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

#: ``Transfer(address,address,uint256)`` — indexed from, to, tokenId.
TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
#: ``Activated(address,uint256,uint8,uint256,uint32)`` — indexed holder, tokenId.
TOPIC_ACTIVATED = "0xdcbc3225a04436b58bd059934bb0220180e12287355c37ddc024c51199e73607"

#: ``ownerOf(uint256)`` / ``activatedAt(uint256)`` on the collection.
SEL_OWNER_OF = "0x6352211e"
SEL_ACTIVATED_AT = "0xae9ec3cc"
#: ``weightOf(uint256)`` on the registry — 0 unless the broker is activated *and* still held.
SEL_WEIGHT_OF = "0x0767d178"

#: ⚠️ These are pinned by `test_selectors_match_the_deployed_abi`, which recomputes them from the
#: contract ABIs. A wrong selector here does NOT raise — `eth_call` returns empty, the read degrades
#: to "no weight", and the allocation silently pays nobody. Two of the four were wrong when first
#: written by hand, so they are asserted rather than trusted.

ENV_FROM_BLOCK = "BROKER_INDEX_FROM_BLOCK"

#: `eth_getLogs` range per request. Providers cap this and the caps differ wildly (Alchemy's free
#: tier allows 10 blocks; the Robinhood public node is far more generous). Chunking to a modest
#: window means one conservative provider does not make the whole scan fail — and eRPC's
#: split-on-error only helps for the providers it knows about.
LOG_CHUNK = 5_000

#: Hard stop on how many chunks one scan will walk. A scan that would need more than this is a
#: configuration problem (a `fromBlock` of 0 on a 100M-block chain), not something to grind through.
MAX_CHUNKS = 400


class EthCallRpc(Protocol):
    async def call(self, method: str, params: list[Any]) -> Any: ...


def _hex_to_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if not isinstance(value, str) or not value.startswith("0x"):
        return None
    try:
        return int(value, 16)
    except ValueError:
        return None


def _is_address(value: str) -> bool:
    v = (value or "").strip()
    if not v.startswith("0x") or len(v) != 42:
        return False
    try:
        int(v, 16)
    except ValueError:
        return False
    return True


def _word(value: int) -> str:
    return f"{value:064x}"


@dataclass(frozen=True)
class ActivatedBroker:
    """One broker that is activated **right now**, with the holder and weight to prove it.

    ⚠️ `holder` is always **lowercase**. That is a correctness requirement, not formatting: the
    allocation sums per wallet before building the tree, and a wallet that appeared in two casings
    would group as two different people — producing two leaves that each hold part of one person's
    share, and a claim for the full amount that proves against neither.
    """

    token_id: int
    holder: str
    weight_bps: int


@dataclass
class BrokerLedger:
    """Log-derived candidates, narrowed by live reads. Never raises; degrades to empty."""

    rpc: EthCallRpc
    broker: str
    #: Every registry ever wired, newest first. See the module docstring.
    registries: list[str] = field(default_factory=list)
    #: The block the collection was deployed at. Scanning from 0 on a 100M-block chain is a
    #: configuration error, not a slow path — there is nothing before this block.
    from_block: int = 0

    # ── log walking ─────────────────────────────────────────────────────────────────────────

    async def _head(self) -> int | None:
        try:
            return _hex_to_int(await self.rpc.call("eth_blockNumber", []))
        except Exception:  # noqa: BLE001 - the module's contract is to degrade, never to raise
            return None

    async def _logs(
        self, address: str, topics: list[Any], head: int
    ) -> list[dict[str, Any]] | None:
        """Every matching log between `from_block` and `head`, walked in bounded chunks.

        Returns ``None`` on any failure — a PARTIAL log scan is worse than none, because it looks
        like a complete answer with people missing from it.
        """
        out: list[dict[str, Any]] = []
        start = self.from_block
        chunks = 0
        while start <= head:
            if chunks >= MAX_CHUNKS:
                return None
            end = min(start + LOG_CHUNK - 1, head)
            try:
                got = await self.rpc.call(
                    "eth_getLogs",
                    [
                        {
                            "address": address.lower(),
                            "topics": topics,
                            "fromBlock": hex(start),
                            "toBlock": hex(end),
                        }
                    ],
                )
            except Exception:  # noqa: BLE001 - a scan is best-effort; the caller degrades
                return None
            if not isinstance(got, list):
                return None
            out.extend(g for g in got if isinstance(g, dict))
            start = end + 1
            chunks += 1
        return out

    # ── live reads: the authority ───────────────────────────────────────────────────────────

    async def _read_uint(self, to: str, selector: str, arg: int) -> int | None:
        try:
            raw = await self.rpc.call(
                "eth_call", [{"to": to.lower(), "data": selector + _word(arg)}, "latest"]
            )
        except Exception:  # noqa: BLE001 - a nonexistent token reverts; that is an answer
            return None
        return _hex_to_int(raw)

    async def _owner_of(self, token_id: int) -> str | None:
        value = await self._read_uint(self.broker, SEL_OWNER_OF, token_id)
        if value is None or value == 0:
            return None
        return "0x" + f"{value:040x}"

    # ── question 1: which brokers does this wallet hold? ────────────────────────────────────

    async def tokens_owned_by(self, wallet: str) -> list[int] | None:
        """Token ids `wallet` holds right now, or ``None`` if the chain could not be walked.

        ``None`` and ``[]`` are deliberately different: "I could not tell you" must never render as
        "you own nothing", which is the same class of lie as reporting an unreadable chain as
        "not activated".
        """
        if not _is_address(wallet) or not _is_address(self.broker):
            return None
        head = await self._head()
        if head is None:
            return None

        wallet_topic = "0x" + _word(int(wallet, 16))
        # Anything that ever arrived here. Tokens that left are filtered by the live ownerOf below,
        # so there is no need to also walk the outbound side and diff two lists.
        logs = await self._logs(self.broker, [TOPIC_TRANSFER, None, wallet_topic], head)
        if logs is None:
            return None

        seen: list[int] = []
        for log in logs:
            topics = log.get("topics") or []
            if len(topics) < 4:
                continue  # a non-ERC721 Transfer (tokenId not indexed) — not ours
            token_id = _hex_to_int(topics[3])
            if token_id is not None and token_id not in seen:
                seen.append(token_id)

        owned: list[int] = []
        wanted = wallet.lower()
        for token_id in seen:
            owner = await self._owner_of(token_id)
            if owner is not None and owner.lower() == wanted:
                owned.append(token_id)
        return sorted(owned)

    # ── question 2: every activated broker, for the allocation ──────────────────────────────

    async def activated_brokers(self) -> list[ActivatedBroker] | None:
        """Every broker activated **right now**, with its current holder and weight.

        This is the input to a revenue period's allocation, so a partial answer is not acceptable:
        a missing holder is a holder who silently gets nothing. Any failure returns ``None`` and the
        caller must refuse to publish rather than publish an incomplete split.
        """
        if not _is_address(self.broker):
            return None
        head = await self._head()
        if head is None:
            return None

        candidates: list[int] = []
        for registry in self.registries:
            if not _is_address(registry):
                continue
            logs = await self._logs(registry, [TOPIC_ACTIVATED], head)
            if logs is None:
                return None  # partial ⇒ refuse
            for log in logs:
                topics = log.get("topics") or []
                if len(topics) < 3:
                    continue
                token_id = _hex_to_int(topics[2])
                if token_id is not None and token_id not in candidates:
                    candidates.append(token_id)

        out: list[ActivatedBroker] = []
        for token_id in sorted(candidates):
            # The chain decides, not the log: a broker activated last month may have been sold
            # since, which cleared its activation and its weight.
            activated_at = await self._read_uint(self.broker, SEL_ACTIVATED_AT, token_id)
            if not activated_at:
                continue
            holder = await self._owner_of(token_id)
            if holder is None:
                continue
            weight = await self._active_weight(token_id)
            if weight is None or weight == 0:
                continue
            out.append(ActivatedBroker(token_id=token_id, holder=holder, weight_bps=weight))
        return out

    async def _active_weight(self, token_id: int) -> int | None:
        """`weightOf` from whichever registry currently knows this token. 0 when none does."""
        for registry in self.registries:
            if not _is_address(registry):
                continue
            weight = await self._read_uint(registry, SEL_WEIGHT_OF, token_id)
            if weight:
                return weight
        return 0


def from_block_from_env(default: int = 0) -> int:
    raw = os.getenv(ENV_FROM_BLOCK)
    if not raw or not raw.strip():
        return default
    try:
        return max(0, int(raw.strip()))
    except ValueError:
        return default


def build_broker_ledger_from_env(rpc_factory: Any = None) -> BrokerLedger | None:
    """Construct from env, or ``None`` when unconfigured (⇒ callers report "unavailable").

    Deliberately reads the SAME variables as ``broker_gate``, including the comma-separated
    ``BROKER_REGISTRY_ADDRESS`` list. Two sources of truth for "which registries count" is exactly
    how a holder who activated under a superseded registry gets silently dropped from one surface
    but not another.

    ⚠️ ``BROKER_INDEX_FROM_BLOCK`` matters here in a way it does not for the gate. Left at 0, a
    scan of a 100-million-block chain exceeds ``MAX_CHUNKS`` and every answer degrades to ``None``.
    Set it to the collection's deploy block.
    """
    from .broker_gate import ENV_BROKER, ENV_REGISTRY, ENV_RPC_URL, ENV_RPC_URL_FALLBACK

    rpc_url = (os.getenv(ENV_RPC_URL) or os.getenv(ENV_RPC_URL_FALLBACK) or "").strip()
    broker = (os.getenv(ENV_BROKER) or "").strip()
    registry = (os.getenv(ENV_REGISTRY) or "").strip()
    valid = [r for r in (x.strip() for x in registry.split(",")) if _is_address(r)]
    if not rpc_url or not _is_address(broker) or not valid:
        return None
    if rpc_factory is None:
        from ..data.log_source import HttpxLogsRpc

        rpc: Any = HttpxLogsRpc(rpc_url)
    else:
        rpc = rpc_factory(rpc_url)
    return BrokerLedger(
        rpc=rpc, broker=broker, registries=valid, from_block=from_block_from_env()
    )
