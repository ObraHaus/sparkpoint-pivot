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

import asyncio
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
ENV_LOG_CHUNK = "BROKER_LOG_CHUNK"
ENV_GRANDFATHER_BPS = "BROKER_GRANDFATHER_WEIGHT_BPS"

#: Weight given to an activation that predates tiers. **Operator decision, 14 Aug 2026: 1.0x.**
#:
#: A pre-tier holder paid for a permanent activation and still holds it, so they keep counting — at
#: the LOWEST weight, because they never chose a tier and none can be invented for them. (It is
#: generous per SRK spent: the old flat price was 10,000 SRK against Analyst's 250,000. The
#: alternative was charging them again for something they already bought.)
#:
#: ⚠️ 0 disables grandfathering, which puts those brokers back in `weightless` and makes
#: `build_allocation` refuse. That is the safe default for a NEW chain where no such policy has been
#: decided — the number here is a decision, and it must stay a decision rather than an accident.
GRANDFATHER_WEIGHT_BPS = 10_000

#: Starting `eth_getLogs` span, overridable with ``BROKER_LOG_CHUNK``.
#:
#: ⚠️ Measured, not guessed. The three numbers that matter here are all different:
#:
#:   * Robinhood's public node   accepts 1,000,000 blocks in one call
#:   * **our own eRPC proxy**    rejects above **~30,000** ("getLogs request exceeded max allowed
#:                               range") — and eRPC is what production actually talks to
#:   * Alchemy's free tier       allows 10
#:
#: So the default is set below the proxy the agent really uses, rather than to what the underlying
#: node could do. A value tuned to the node made every production scan fail while passing locally.
LOG_CHUNK = 25_000

#: Floor for the adaptive narrowing. Below this a provider is not merely strict, something else is
#: wrong, and halving forever would just be a slow failure.
MIN_LOG_CHUNK = 500

#: How many chunk requests run at once. The range is known up front, so the chunks are independent
#: and there is no reason to serialise them — 18 sequential round trips is ~9s on a page load, the
#: same work concurrently is ~1s. Bounded because this is a shared upstream, not ours alone.
LOG_CONCURRENCY = 6

#: Request budget for ONE scan. The bound is "what a page load can afford", not "what will
#: eventually finish".
#:
#: At the default span that is 6.25M blocks of headroom — the collection was deployed ~530k blocks
#: ago — while still refusing a `from_block` of 0 on a 100M-block chain, which would need 4,000
#: requests. ⚠️ This and `LOG_CHUNK` have to be changed together: a budget tuned to a large span
#: silently starves a provider that forces a small one, which is exactly how the first production
#: run of this scanner returned "chain-unreadable" while every test passed.
MAX_CHUNKS = 250


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
class ActivationScan:
    """The activated set, plus the brokers that could not be priced.

    ⚠️ `weightless` is the important field. A broker whose `activatedAt` is non-zero IS activated —
    the holder paid — but if no registry in the list can report a `weightOf` for it, there is no
    number to split a pot by. Dropping it silently would allocate that holder nothing, and once a
    period is published that is permanent.

    This is not hypothetical. On Robinhood testnet, brokers #1 and #4 are activated on the NFT while
    both superseded registries **have no `weightOf` function at all** — they predate the 043c tiers,
    so the call reverts rather than returning 0. The registry LIST cannot rescue them, because there
    is no weight recorded anywhere to find.

    So they are reported rather than discarded, and the caller must decide before publishing:
    treat a pre-tier activation as Analyst (1.0x), require re-activation, or exclude it knowingly.
    Any of those is defensible; doing it by accident is not.
    """

    activated: tuple[ActivatedBroker, ...]
    weightless: tuple[int, ...]


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
    #: Starting span per `eth_getLogs`. Narrows automatically when a provider rejects it.
    log_chunk: int = LOG_CHUNK
    #: Weight for an activation no registry can price. 0 ⇒ report as `weightless` and refuse.
    grandfather_bps: int = GRANDFATHER_WEIGHT_BPS

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
        span = await self._working_span(address, topics, head)
        if span is None:
            return None

        # The whole range is known, so the chunks are independent — there is no reason to serialise
        # them. Sequentially this is ~18 round trips (~9s) on a page load; concurrently it is ~1s.
        ranges = []
        start = self.from_block
        while start <= head:
            end = min(start + span - 1, head)
            ranges.append((start, end))
            start = end + 1
        if len(ranges) > MAX_CHUNKS:
            # The budget is about what a page load can afford. See MAX_CHUNKS.
            return None

        sem = asyncio.Semaphore(LOG_CONCURRENCY)

        async def fetch(lo: int, hi: int) -> list[dict[str, Any]] | None:
            async with sem:
                try:
                    got = await self.rpc.call(
                        "eth_getLogs",
                        [
                            {
                                "address": address.lower(),
                                "topics": topics,
                                "fromBlock": hex(lo),
                                "toBlock": hex(hi),
                            }
                        ],
                    )
                except Exception:  # noqa: BLE001 - one bad chunk fails the whole scan, by design
                    return None
            return [g for g in got if isinstance(g, dict)] if isinstance(got, list) else None

        results = await asyncio.gather(*(fetch(lo, hi) for lo, hi in ranges))
        if any(r is None for r in results):
            # A partial scan is worse than none: it looks like a complete answer with people
            # missing from it. One failed chunk therefore fails the whole read.
            return None

        out: list[dict[str, Any]] = []
        for r in results:
            out.extend(r or [])
        return out

    async def _working_span(self, address: str, topics: list[Any], head: int) -> int | None:
        """Find a range width this provider will actually accept.

        ⚠️ Caps are not knowable in advance and differ by an order of magnitude between the node and
        the proxy in front of it — Robinhood's node accepts 1,000,000 while our own eRPC rejects
        above ~30,000. So the width is DISCOVERED with one cheap probe against the newest blocks,
        then reused for every chunk. Halving (not quartering) so it lands near the real cap rather
        than far below it: overshooting downward is what turned an 18-request scan into 68 and blew
        the budget in production.
        """
        span = max(MIN_LOG_CHUNK, self.log_chunk)
        probe_from = max(self.from_block, head - span + 1)
        while True:
            try:
                await self.rpc.call(
                    "eth_getLogs",
                    [
                        {
                            "address": address.lower(),
                            "topics": topics,
                            "fromBlock": hex(probe_from),
                            "toBlock": hex(head),
                        }
                    ],
                )
                return span
            except Exception:  # noqa: BLE001 - "too wide" is the common case, not a fatal error
                if span <= MIN_LOG_CHUNK:
                    return None
                span = max(MIN_LOG_CHUNK, span // 2)
                probe_from = max(self.from_block, head - span + 1)

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

        # Concurrent for the same reason the chunks are: these reads are independent of each other,
        # and a wallet holding a dozen brokers should not pay a dozen round trips in series.
        wanted = wallet.lower()
        sem = asyncio.Semaphore(LOG_CONCURRENCY)

        async def owns(token_id: int) -> int | None:
            async with sem:
                owner = await self._owner_of(token_id)
            return token_id if owner is not None and owner.lower() == wanted else None

        results = await asyncio.gather(*(owns(t) for t in seen))
        return sorted(t for t in results if t is not None)

    # ── question 2: every activated broker, for the allocation ──────────────────────────────

    async def activated_brokers(self) -> list[ActivatedBroker] | None:
        """Convenience wrapper over :meth:`scan_activations` returning only the priced brokers.

        ⚠️ Prefer `scan_activations` when building an allocation: this drops weightless activations
        on the floor, which is the exact silent exclusion this module exists to prevent.
        """
        scan = await self.scan_activations()
        return None if scan is None else list(scan.activated)

    async def scan_activations(self) -> ActivationScan | None:
        """Every broker activated **right now**, split into priced and weightless.

        This is the input to a revenue period's allocation, so a partial answer is not acceptable:
        a missing holder is a holder who silently gets nothing. Any failure returns ``None`` and the
        caller must refuse to publish rather than publish an incomplete split.
        """
        if not _is_address(self.broker):
            return None
        head = await self._head()
        if head is None:
            return None

        candidates: set[int] = set()

        # 1. Every `Activated` event on every registry in the list.
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
                if token_id is not None:
                    candidates.add(token_id)

        # 2. ⚠️ EVERY token that has ever moved, which is every token that exists.
        #
        # The event scan above is NOT sufficient and assuming it was is a real bug this caught:
        # a superseded registry emits a DIFFERENT `Activated` signature (the 043c tiers added two
        # arguments), so its topic0 differs and its activations never appear above at all. On
        # Robinhood testnet that hides brokers #1 and #4, which are activated on the NFT right now.
        #
        # A missing candidate cannot even be reported as weightless — it is invisible, which is
        # strictly worse. So the mint/transfer log is used as the population, and the NFT's own
        # `activatedAt` decides. It costs one extra `eth_getLogs` and removes the whole class.
        mints = await self._logs(self.broker, [TOPIC_TRANSFER], head)
        if mints is None:
            return None
        for log in mints:
            topics = log.get("topics") or []
            if len(topics) < 4:
                continue
            token_id = _hex_to_int(topics[3])
            if token_id is not None:
                candidates.add(token_id)

        sem = asyncio.Semaphore(LOG_CONCURRENCY)

        async def classify(token_id: int) -> tuple[int, ActivatedBroker | None, bool]:
            """Returns `(token_id, priced_or_None, is_weightless)`."""
            async with sem:
                # The chain decides, not the log: a broker activated last month may have been sold
                # since, which cleared its activation and its weight.
                activated_at = await self._read_uint(self.broker, SEL_ACTIVATED_AT, token_id)
                if not activated_at:
                    return token_id, None, False
                holder = await self._owner_of(token_id)
                if holder is None:
                    return token_id, None, False
                weight = await self._active_weight(token_id)
            if not weight:
                if self.grandfather_bps > 0:
                    # Pre-tier activation, grandfathered by operator decision. Still surfaced in
                    # `weightless` so the published allocation can name exactly who this applied to
                    # — a weight nobody chose must be auditable, not invisible.
                    return (
                        token_id,
                        ActivatedBroker(token_id, holder, self.grandfather_bps),
                        True,
                    )
                # Activated, held, and unpriceable. Reported, never quietly dropped.
                return token_id, None, True
            return token_id, ActivatedBroker(token_id, holder, weight), False

        # Sorted afterwards rather than iterated in order, so the reads overlap. The output order
        # is still deterministic, which matters: the allocation hashes leaves in a fixed order.
        rows = await asyncio.gather(*(classify(t) for t in sorted(candidates)))
        out = [b for _, b, _ in rows if b is not None]
        weightless = [t for t, _, w in rows if w]
        return ActivationScan(
            activated=tuple(sorted(out, key=lambda b: b.token_id)),
            weightless=tuple(sorted(weightless)),
        )

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
        rpc=rpc,
        broker=broker,
        registries=valid,
        from_block=from_block_from_env(),
        log_chunk=log_chunk_from_env(),
        grandfather_bps=grandfather_bps_from_env(),
    )


def log_chunk_from_env(default: int = LOG_CHUNK) -> int:
    """`BROKER_LOG_CHUNK`, for a deployment whose provider caps ranges differently.

    The scan narrows on rejection anyway, so this is a starting point rather than a requirement —
    but starting near the real cap saves probe round trips on every request.
    """
    raw = os.getenv(ENV_LOG_CHUNK)
    if not raw or not raw.strip():
        return default
    try:
        return max(MIN_LOG_CHUNK, int(raw.strip()))
    except ValueError:
        return default


def grandfather_bps_from_env(default: int = GRANDFATHER_WEIGHT_BPS) -> int:
    """`BROKER_GRANDFATHER_WEIGHT_BPS` — 0 disables grandfathering entirely."""
    raw = os.getenv(ENV_GRANDFATHER_BPS)
    if not raw or not raw.strip():
        return default
    try:
        return max(0, int(raw.strip()))
    except ValueError:
        return default
