# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the per-tier quota enforcement (feature 008, US1) - store MOCKED.

Pins the load-bearing enforcement invariants:
  * admits UNDER cap and increments the counter exactly ONCE per call (whole-turn metering);
  * DENIES at/over cap WITHOUT incrementing, and records a masked ``deny`` event;
  * FAILS OPEN if the limits subsystem errors (a limits outage never blocks the assistant);
  * a missing tier-config row fails OPEN (never blocks on a config gap);
  * the dependency raises ``RATE_LIMITED`` (429) on deny; returns the decision on admit;
  * the quota window is Asia/Manila midnight expressed as UTC.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

import pytest

from sparkpoint_agent.api.errors import ApiError, ErrorCode
from sparkpoint_agent.api.quota import (
    LimitDecision,
    check_and_consume,
    refund,
    require_within_quota,
    window_start,
)
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.db.limits import LimitsStore

_DEF = {"chatDailyLimit": 3, "recsDailyLimit": 2, "onboardingDailyLimit": 5}
_OWNER = "0xabc0000000000000000000000000000000000001"
_ACCT = AccountContext(account=_OWNER, owner=_OWNER, chain_id=84532)


class _FakeLimits:
    """Configurable stand-in for LimitsStore recording increments + events."""

    def __init__(
        self,
        *,
        tier: str = "free",
        tier_def: dict[str, Any] | None = None,
        usage: int = 0,
        raise_on: str | None = None,
    ) -> None:
        self.tier = tier
        self.tier_def = tier_def
        self.usage = usage
        self.raise_on = raise_on
        self.increments: list[tuple[str, str, str]] = []
        self.refunds: list[tuple[str, str, datetime]] = []
        self.events: list[tuple[str, str, str, str | None]] = []
        self.refund_value = 0
        self.raise_on_refund = False

    async def resolve_tier(self, owner: str) -> str:
        if self.raise_on == "resolve":
            raise RuntimeError("db down")
        return self.tier

    async def get_tier(self, tier: str) -> dict[str, Any] | None:
        if self.raise_on == "get_tier":
            raise RuntimeError("db down")
        return self.tier_def

    async def default_tier(self) -> str:
        return "free"

    async def get_usage(self, owner: str, metric: str, window: datetime) -> int:
        return self.usage

    async def increment(
        self, owner: str, metric: str, window: datetime, *, tier_at_use: str
    ) -> int:
        self.increments.append((owner, metric, tier_at_use))
        self.usage += 1
        return self.usage

    async def refund(self, owner: str, metric: str, window: datetime) -> int:
        if self.raise_on_refund:
            raise RuntimeError("db down")
        self.refunds.append((owner, metric, window))
        return self.refund_value

    async def record_event(
        self, verdict: str, metric: str, tier: str, *, subject: str | None, detail: Any = None
    ) -> None:
        self.events.append((verdict, metric, tier, subject))


def _store(f: _FakeLimits) -> LimitsStore:
    return cast(LimitsStore, f)


async def test_admits_under_cap_and_increments_once() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF, usage=0)
    d = await check_and_consume(_store(f), _ACCT.owner, "chat")
    assert d.allowed and d.tier == "free" and d.used == 1 and d.limit == 3
    assert len(f.increments) == 1  # one turn = one increment (never per model-call)
    assert f.events == []


async def test_denies_at_cap_without_incrementing() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF, usage=3)  # already at cap
    d = await check_and_consume(_store(f), _ACCT.owner, "chat")
    assert not d.allowed and d.used == 3 and d.limit == 3
    assert len(f.increments) == 0
    assert f.events and f.events[0][0] == "deny"
    assert "…" in (f.events[0][3] or "")  # subject is masked, not the full address


async def test_fails_open_on_subsystem_error() -> None:
    f = _FakeLimits(raise_on="resolve")
    d = await check_and_consume(_store(f), _ACCT.owner, "chat")
    assert d.allowed  # a limits outage must never block the assistant
    assert len(f.increments) == 0


async def test_missing_tier_config_fails_open() -> None:
    f = _FakeLimits(tier="free", tier_def=None)  # no config row (e.g. 0015 not applied)
    d = await check_and_consume(_store(f), _ACCT.owner, "chat")
    assert d.allowed
    assert len(f.increments) == 0


async def test_dependency_raises_rate_limited_when_denied() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF, usage=3)
    dep = require_within_quota("chat")
    with pytest.raises(ApiError) as ei:
        await dep(_ACCT, _store(f))
    assert ei.value.code == ErrorCode.RATE_LIMITED
    assert ei.value.http_status == 429


async def test_dependency_returns_decision_when_allowed() -> None:
    f = _FakeLimits(
        tier="premium",
        tier_def={"chatDailyLimit": 400, "recsDailyLimit": 100, "onboardingDailyLimit": 40},
        usage=0,
    )
    dep = require_within_quota("chat")
    d = await dep(_ACCT, _store(f))
    assert d.allowed and d.tier == "premium" and d.remaining == 399


def test_window_start_is_manila_midnight_as_utc() -> None:
    # 2026-07-21 03:00 UTC == 2026-07-21 11:00 Manila -> window opens at Manila midnight
    # (2026-07-21 00:00 +08:00) == 2026-07-20 16:00 UTC.
    ws = window_start(datetime(2026, 7, 21, 3, 0, tzinfo=UTC))
    assert ws == datetime(2026, 7, 20, 16, 0, tzinfo=UTC)


# ── refund on upstream failure (feature 054) ────────────────────────────────────


def _consumed(metric: str = "chat", ws: datetime | None = None) -> LimitDecision:
    return LimitDecision(
        allowed=True,
        tier="free",
        metric=metric,
        used=1,
        limit=3,
        window_start=ws or datetime(2026, 7, 20, 16, 0, tzinfo=UTC),
        consumed=True,
    )


async def test_refund_returns_the_same_metric_and_captured_window() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF)
    ws = datetime(2026, 7, 20, 16, 0, tzinfo=UTC)
    await refund(_store(f), _ACCT.owner, _consumed(ws=ws))
    assert f.refunds == [(_ACCT.owner, "chat", ws)]
    assert f.events and f.events[0][0] == "refund"
    assert "…" in (f.events[0][3] or "")  # masked subject, never the full wallet


async def test_refund_is_noop_when_the_turn_was_not_charged() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF)
    # Fail-open decisions (limits outage / missing config) are not refundable.
    await refund(_store(f), _ACCT.owner, LimitDecision(True, "unknown", "chat", 0, 0))
    assert f.refunds == []


async def test_refund_uses_store_result_and_clamps_at_zero() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF)
    f.refund_value = 0  # store clamped a duplicate refund at zero
    await refund(_store(f), _ACCT.owner, _consumed())
    assert f.refunds and f.refunds[0][0] == _ACCT.owner


async def test_refund_error_is_swallowed() -> None:
    f = _FakeLimits(tier="free", tier_def=_DEF)
    f.raise_on_refund = True
    await refund(_store(f), _ACCT.owner, _consumed())  # must not raise
