# ruff: noqa: S101
"""043 T005/T006 — an activated broker as a live source of premium, and the guard that keeps it
live.

Two jobs here. The first is the ordinary one: prove `resolve_tier` answers premium from either
source, and that the pre-043 subscription path is untouched. The second matters more and is T006:
**prove that nothing writes an NFT-derived entitlement into `wallet_tier`.**

That guard is not decoration. `data-model.md` states "zero migrations" as a gate rather than an
omission, and the plan's whole argument rests on the entitlement having nowhere to be stored.
A claim
in a document is not enforcement — a future well-meaning "let's just cache the resolved tier" would
sail past every other test in this suite while re-creating the exact bug the collection exists to
avoid: a holder sells their broker and a stranger keeps the access.
"""

from __future__ import annotations

import asyncio
import inspect
from datetime import UTC, datetime, timedelta
from typing import Any

from sparkpoint_agent.chain.broker_gate import BrokerGate, BrokerGateResult
from sparkpoint_agent.db import limits as limits_mod
from sparkpoint_agent.db.limits import DEFAULT_TIER, PREMIUM_TIER, LimitsStore

WALLET = "0x32Ed4400C5BBB394712c482F1207886d8C22e8b5"


class FakeDb:
    """Just enough Database to answer the two queries `resolve_tier` makes."""

    def __init__(self, tier: str | None = None, expires_at: datetime | None = None) -> None:
        self.tier = tier
        self.expires_at = expires_at
        self.writes: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchval(self, sql: str, *args: Any) -> Any:
        if "SELECT tier FROM wallet_tier" in sql:
            return self.tier
        if "SELECT expires_at FROM wallet_tier" in sql:
            return self.expires_at
        if "FROM tier_definitions WHERE is_default" in sql:
            return DEFAULT_TIER
        raise AssertionError(f"unexpected query: {sql[:60]}")

    async def execute(self, sql: str, *args: Any) -> None:
        self.writes.append((sql, args))


class StubGate(BrokerGate):
    """A gate with a fixed verdict — the chain itself is exercised in test_broker_gate.py."""

    def __init__(self, result: BrokerGateResult) -> None:
        super().__init__(rpc=None, broker="0x" + "11" * 20, registry="0x" + "22" * 20)  # type: ignore[arg-type]
        self._result = result
        self.checks = 0

    async def check(self, address: str, *, now: float | None = None) -> BrokerGateResult:
        self.checks += 1
        return self._result


QUALIFIES = BrokerGateResult(True, "ok", token_id=7, activated_at_block=11_479_836)
DOES_NOT = BrokerGateResult(False, "no_activated_broker")
UNREADABLE = BrokerGateResult(False, "rpc_error")


def store(tier: str | None = None, gate: BrokerGate | None = None, **kw: Any) -> LimitsStore:
    return LimitsStore(FakeDb(tier, **kw), gate)  # type: ignore[arg-type]


# ── the two sources ─────────────────────────────────────────────────────────────────────────


def test_an_activated_broker_confers_premium_with_no_stored_grant() -> None:
    s = store(None, StubGate(QUALIFIES))
    assert asyncio.run(s.resolve_tier(WALLET)) == PREMIUM_TIER


def test_selling_the_broker_returns_the_wallet_to_free() -> None:
    """The same guarantee as the gate test, asserted one layer up where the tier is decided."""
    s = store(None, StubGate(DOES_NOT))
    assert asyncio.run(s.resolve_tier(WALLET)) == DEFAULT_TIER


def test_the_subscription_path_is_untouched_by_this_feature() -> None:
    """FR-004 — a paid subscriber with no broker behaves exactly as before 043."""
    gate = StubGate(DOES_NOT)
    s = store(PREMIUM_TIER, gate)
    assert asyncio.run(s.resolve_tier(WALLET)) == PREMIUM_TIER
    assert gate.checks == 0, "a stored premium must short-circuit — no chain read, no new latency"


def test_the_pre_043_agent_behaviour_survives_with_no_gate_configured() -> None:
    assert asyncio.run(store(PREMIUM_TIER, None).resolve_tier(WALLET)) == PREMIUM_TIER
    assert asyncio.run(store(None, None).resolve_tier(WALLET)) == DEFAULT_TIER


def test_the_broker_carries_the_wallet_after_the_subscription_lapses() -> None:
    """The stored grant has expired, so the SQL returns nothing — the broker keeps them premium."""
    s = store(None, StubGate(QUALIFIES))
    assert asyncio.run(s.resolve_tier(WALLET)) == PREMIUM_TIER
    assert asyncio.run(s.resolve_tier_source(WALLET))["source"] == "broker"


# ── an unreadable chain degrades, it does not decide ────────────────────────────────────────


def test_an_unreadable_chain_falls_back_to_stored_and_never_raises() -> None:
    """FR-006 — the request must not fail, and 'I could not read' must not become 'no premium'."""
    kept = asyncio.run(store(PREMIUM_TIER, StubGate(UNREADABLE)).resolve_tier(WALLET))
    assert kept == PREMIUM_TIER
    assert asyncio.run(store(None, StubGate(UNREADABLE)).resolve_tier(WALLET)) == DEFAULT_TIER


# ── naming the source (FR-005) ──────────────────────────────────────────────────────────────


def test_the_source_is_named_so_a_holder_can_tell_what_ends_their_access() -> None:
    broker = asyncio.run(store(None, StubGate(QUALIFIES)).resolve_tier_source(WALLET))
    assert broker == {"tier": PREMIUM_TIER, "source": "broker", "expiresAt": None, "tokenId": 7}

    until = datetime.now(UTC) + timedelta(days=20)
    stored = asyncio.run(
        store(PREMIUM_TIER, StubGate(DOES_NOT), expires_at=until).resolve_tier_source(WALLET)
    )
    assert stored["source"] == "stored"
    assert stored["expiresAt"] == until

    none = asyncio.run(store(None, StubGate(DOES_NOT)).resolve_tier_source(WALLET))
    assert none["source"] is None


def test_a_broker_sourced_tier_never_manufactures_an_expiry_date() -> None:
    """It ends on transfer, not on a date. A date here would be a fabricated promise.
    It is also unresolvable in practice: `activatedAt` is a block number, and on Robinhood Chain
    that
    is not addressable as an RPC block height, so even the activation date cannot be derived there.
    """
    result = asyncio.run(store(None, StubGate(QUALIFIES)).resolve_tier_source(WALLET))
    assert result["expiresAt"] is None


# ── T006 — THE GUARD ────────────────────────────────────────────────────────────────────────


def test_resolving_a_tier_writes_nothing_at_all() -> None:
    """Behavioural half of the guard: a read must stay a read."""
    db = FakeDb(None)
    s = LimitsStore(db, StubGate(QUALIFIES))  # type: ignore[arg-type]
    assert asyncio.run(s.resolve_tier(WALLET)) == PREMIUM_TIER
    asyncio.run(s.resolve_tier_source(WALLET))
    assert db.writes == [], f"tier resolution must not write; it wrote {db.writes!r}"


def test_no_broker_derived_grant_can_be_written_into_wallet_tier() -> None:
    """Structural half: the resolve path contains no write, so it cannot grow one by accident.

    This is what makes "zero migrations" a gate rather than a claim. If someone later adds an
    `assign(...)` or an INSERT inside tier resolution — the shape a "let's cache the tier" refactor
    takes — this fails, and the reason is in the message.
    """
    resolvers = (
        LimitsStore.resolve_tier,
        LimitsStore.resolve_tier_source,
        LimitsStore._stored_tier,
    )
    for fn in resolvers:
        src = inspect.getsource(fn)
        for forbidden in ("INSERT", "UPDATE", "assign(", "_ASSIGN_SQL", "execute("):
            assert forbidden not in src, (
                f"{fn.__name__} contains {forbidden!r}. An NFT-derived entitlement must NEVER be "
                "persisted — a stored grant outlives the sale that should end it, and the "
                "bug shows up as a stranger keeping the Premium their broker was sold with."
            )


def test_the_gate_result_carries_no_tier() -> None:
    """A tier on the chain answer is how the stored-grant bug gets back in through a side door."""
    assert not hasattr(QUALIFIES, "tier")
    assert "tier" not in getattr(BrokerGateResult, "__dataclass_fields__", {})


def test_the_module_defines_no_broker_sourced_write_sql() -> None:
    """Nothing in the limits module may name a broker as a `wallet_tier.source`."""
    src = inspect.getsource(limits_mod)
    lowered = src.lower()
    for token in ("'broker'", '"broker"'):
        idx = lowered.find(f"source = {token}")
        assert idx == -1, "wallet_tier must never carry a broker-sourced grant"
