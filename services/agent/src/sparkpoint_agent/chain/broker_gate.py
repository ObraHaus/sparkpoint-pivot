"""Does this wallet hold an ACTIVATED Sparky Broker? (feature 043)

The one question behind NFT-derived Premium, answered from the chain on every read and **never
written down**. A stored grant outlives the sale that should end it, and the resulting bug — a
stranger keeping the access their broker was sold with — is the one that makes the collection
pointless. So this module reads, caches the narrow chain fact for about a minute, and stores
nothing.

**Why this is answerable without an indexer.** ``SparkyBroker`` is solady ERC-721 and is NOT
enumerable, so nothing can list a wallet's tokens; the obvious alternatives were a 10,000-id scan
per
request, or a Postgres mirror of ownership that goes stale exactly when it matters. Neither is
needed,
because the product rule collapses the search space:

* ``mint``/``mintBatch`` never set ``activatedAt`` — a fresh broker is unactivated.
* ``_afterTokenTransfer`` clears ``activatedAt`` on every real transfer, marketplace fills included.

So **a wallet can only hold an activated broker that the same wallet activated**. The registry's own
``activationsBy(wallet)`` is therefore a *complete candidate set* — a superset, never a subset — and
the live ``ownerOf`` + ``activatedAt`` reads are the authority. A stale hint can cost a wasted read;
it can never produce a wrong verdict.

Mirrors ``srk_gate.py``'s shape and its discipline: **every failure path returns a non-qualifying
result and this module never raises.** A tier lookup runs on the chat hot path, and the unsafe
direction would be granting premium on a read that did not happen.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

#: ``activationsBy(address)`` — the candidate set. Verified against the deployed contracts on 46630.
SEL_ACTIVATIONS_BY = "0xdeb24aa6"
#: ``ownerOf(uint256)`` — the authority on who holds it.
SEL_OWNER_OF = "0x6352211e"
#: ``activatedAt(uint256)`` — a BLOCK NUMBER (uint64), 0 when never activated or cleared.
SEL_ACTIVATED_AT = "0xae9ec3cc"

ENV_BROKER = "BROKER_NFT_ADDRESS"
ENV_REGISTRY = "BROKER_REGISTRY_ADDRESS"
ENV_RPC_URL = "BROKER_CHAIN_RPC_URL"
ENV_CACHE_SECONDS = "BROKER_GATE_CACHE_SECONDS"

#: Long enough that a chat turn is not a burst of chain reads; short enough that "you sold it and
#: briefly kept access" is a minute rather than a session. A stated constant, never emergent.
DEFAULT_CACHE_SECONDS = 60

#: A wallet is not expected to have activated hundreds of brokers. This bounds the work a hostile or
#: unusual candidate list can cause on the hot path; the cap is generous relative to reality.
MAX_CANDIDATES = 32


class EthCallRpc(Protocol):
    async def call(self, method: str, params: list[Any]) -> Any: ...


@dataclass(frozen=True)
class BrokerGateResult:
    """The outcome of one check. ``qualified`` is the ONLY thing callers may act on.

    Deliberately carries no tier: this answers a chain question, and turning it into an entitlement
    is the caller's job. Baking a tier in here is how the stored-grant bug gets back in through a
    side door.
    """

    qualified: bool
    #: 'ok' | 'no_activated_broker' | 'not_configured' | 'rpc_error' | 'bad_address'
    reason: str
    #: The activated broker that qualified this wallet, for naming the source in the UI.
    token_id: int | None = None
    #: The block the activation happened in. NOTE: on Robinhood Chain this is NOT addressable as an
    #: RPC block height, so it must never be resolved to a date there — see the collection repo.
    activated_at_block: int | None = None


@dataclass
class _Entry:
    result: BrokerGateResult
    at: float


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


def _encode_address_arg(selector: str, address: str) -> str:
    return selector + _word(int(address, 16))


def _encode_uint_arg(selector: str, value: int) -> str:
    return selector + _word(value)


def _decode_uint(result: Any) -> int | None:
    if not isinstance(result, str) or not result.startswith("0x"):
        return None
    try:
        return int(result, 16)
    except ValueError:
        return None


def _decode_address(result: Any) -> str | None:
    value = _decode_uint(result)
    if value is None:
        return None
    return "0x" + f"{value:040x}"


def _decode_uint_array(result: Any) -> list[int] | None:
    """Decode a dynamic ``uint256[]`` return: offset, length, items."""
    if not isinstance(result, str) or not result.startswith("0x"):
        return None
    body = result[2:]
    if len(body) < 128:  # need at least offset + length
        return [] if len(body) == 0 else None
    try:
        length = int(body[64:128], 16)
    except ValueError:
        return None
    if length == 0:
        return []
    if len(body) < 128 + length * 64:
        return None
    out: list[int] = []
    for i in range(min(length, MAX_CANDIDATES)):
        start = 128 + i * 64
        try:
            out.append(int(body[start : start + 64], 16))
        except ValueError:
            return None
    return out


@dataclass
class BrokerGate:
    """Answers "does this wallet hold an activated broker?" from the chain, with a short cache."""

    rpc: EthCallRpc
    broker: str
    registry: str
    cache_seconds: int = DEFAULT_CACHE_SECONDS
    _cache: dict[str, _Entry] = field(default_factory=dict, repr=False)

    @property
    def configured(self) -> bool:
        return _is_address(self.broker) and _is_address(self.registry)

    async def check(self, address: str, *, now: float | None = None) -> BrokerGateResult:
        """Never raises. Never grants on a read that did not happen."""
        if not _is_address(address):
            return BrokerGateResult(False, "bad_address")
        if not self.configured:
            # Unset ⇒ the agent behaves exactly as it did before this feature existed.
            return BrokerGateResult(False, "not_configured")

        key = address.lower()
        stamp = time.monotonic() if now is None else now

        if self.cache_seconds > 0:
            hit = self._cache.get(key)
            if hit is not None and stamp - hit.at < self.cache_seconds:
                return hit.result

        try:
            result = await self._read(address)
        except Exception:  # noqa: BLE001 - fail-closed by contract; a chat turn must not 500 here
            return BrokerGateResult(False, "rpc_error")

        # A failed read is deliberately NOT cached: otherwise one blip pins a wallet to "no premium"
        # for the whole window. Only a real answer is remembered.
        if self.cache_seconds > 0 and result.reason in ("ok", "no_activated_broker"):
            self._cache[key] = _Entry(result, stamp)
        return result

    async def _read(self, address: str) -> BrokerGateResult:
        raw = await self.rpc.call(
            "eth_call",
            [
                {
                    "to": self.registry.lower(),
                    "data": _encode_address_arg(SEL_ACTIVATIONS_BY, address),
                },
                "latest",
            ],
        )
        candidates = _decode_uint_array(raw)
        if candidates is None:
            return BrokerGateResult(False, "rpc_error")

        wanted = address.lower()
        for token_id in candidates:
            # The candidate list is a HINT. These two reads are the authority — which is what
            # makes a
            # sold broker stop qualifying immediately, whatever the registry still remembers.
            try:
                owner_raw = await self.rpc.call(
                    "eth_call",
                    [
                        {
                            "to": self.broker.lower(),
                            "data": _encode_uint_arg(SEL_OWNER_OF, token_id),
                        },
                        "latest",
                    ],
                )
            except Exception:  # noqa: BLE001, S112 - a burnt/nonexistent id reverts by design;
                # skipping that candidate is correct, and must not take the whole answer down.
                continue
            owner = _decode_address(owner_raw)
            if owner is None or owner.lower() != wanted:
                continue

            activated_raw = await self.rpc.call(
                "eth_call",
                [
                    {
                        "to": self.broker.lower(),
                        "data": _encode_uint_arg(SEL_ACTIVATED_AT, token_id),
                    },
                    "latest",
                ],
            )
            block = _decode_uint(activated_raw)
            if block is None:
                return BrokerGateResult(False, "rpc_error")
            if block != 0:
                return BrokerGateResult(True, "ok", token_id, block)

        return BrokerGateResult(False, "no_activated_broker")


def _env_int(name: str) -> int | None:
    raw = os.getenv(name)
    if not raw or not raw.strip():
        return None
    try:
        return int(raw.strip())
    except ValueError:
        return None


def cache_seconds_from_env() -> int:
    value = _env_int(ENV_CACHE_SECONDS)
    return value if value is not None and value >= 0 else DEFAULT_CACHE_SECONDS


def build_broker_gate_from_env(rpc_factory: Any = None) -> BrokerGate | None:
    """Construct from env, or ``None`` when unconfigured (⇒ the broker is not a premium source).

    ``rpc_factory`` is injected in tests; production uses ``HttpxLogsRpc``, imported lazily so this
    module stays cheap and free of transport coupling — same pattern as ``srk_gate``.
    """
    rpc_url = (os.getenv(ENV_RPC_URL) or "").strip()
    broker = (os.getenv(ENV_BROKER) or "").strip()
    registry = (os.getenv(ENV_REGISTRY) or "").strip()
    if not rpc_url or not _is_address(broker) or not _is_address(registry):
        return None
    if rpc_factory is None:
        from ..data.log_source import HttpxLogsRpc

        rpc: Any = HttpxLogsRpc(rpc_url)
    else:
        rpc = rpc_factory(rpc_url)
    return BrokerGate(
        rpc=rpc, broker=broker, registry=registry, cache_seconds=cache_seconds_from_env()
    )
