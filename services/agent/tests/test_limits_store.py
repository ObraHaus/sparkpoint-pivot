# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for ``LimitsStore`` (feature 008) - the asyncpg executor is MOCKED (no live DB).

Pins the load-bearing store invariants:
  * the per-window counter is an ATOMIC upsert (ON CONFLICT ... +1) returning the new count;
  * tier resolution FAILS CLOSED to the default (free) tier when a wallet is unassigned;
  * the zero-chat-on-default guard rejects a config that would strand the assistant (FR-008);
  * an unknown tier raises ``KeyError``; a negative value raises ``ValueError``;
  * every mutation writes an in-tx ``limits_audit`` row (grant/revoke/seed/tier_update);
  * env seeding is idempotent (a conflict no-op is not audited and not counted).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

import pytest

from sparkpoint_agent.db.limits import DEFAULT_TIER, LimitsStore
from sparkpoint_agent.db.pool import Database


class _Ctx:
    """Minimal async context manager (for ``acquire()`` and ``transaction()``)."""

    def __init__(self, value: Any = None) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _FakeConn:
    def __init__(self, db: _FakeDb) -> None:
        self._db = db

    def transaction(self) -> _Ctx:
        return _Ctx()

    async def execute(self, sql: str, *args: Any) -> str:
        self._db.calls.append((sql, args))
        return self._db.execute_result

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self._db.calls.append((sql, args))
        return self._db.val_for(sql)


class _FakeDb:
    """Records execute/fetchval SQL + args; returns programmable fetchval values by SQL fragment."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_result = "INSERT 0 1"
        self.resolve_value: Any = None  # wallet_tier lookup
        self.is_default_value: Any = False  # tier_definitions.is_default (None => unknown tier)
        self.default_tier_value: Any = "free"
        self.incr_value: Any = 1

    def val_for(self, sql: str) -> Any:
        if "FROM wallet_tier WHERE address" in sql:
            return self.resolve_value
        if "is_default LIMIT 1" in sql:
            return self.default_tier_value
        if "SELECT is_default FROM tier_definitions WHERE tier" in sql:
            return self.is_default_value
        if "RETURNING count" in sql:
            return self.incr_value
        return None

    def acquire(self) -> _Ctx:
        return _Ctx(_FakeConn(self))

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        return self.execute_result

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self.val_for(sql)


def _store(db: _FakeDb) -> LimitsStore:
    return LimitsStore(cast(Database, db))


def _audit_actions(db: _FakeDb) -> list[str]:
    """The actions written to limits_audit (INSERT ... VALUES ($1=action, ...))."""
    return [args[0] for sql, args in db.calls if "INTO limits_audit" in sql]


_WS = datetime(2026, 7, 21, tzinfo=UTC)


async def test_increment_is_atomic_upsert_and_returns_count() -> None:
    db = _FakeDb()
    db.incr_value = 7
    n = await _store(db).increment("0xABCdef", "chat", _WS, tier_at_use="free")
    assert n == 7
    sql, args = db.calls[-1]
    assert "ON CONFLICT (address, metric, window_start) DO UPDATE" in sql
    assert "count = usage_counters.count + 1" in sql
    assert "RETURNING count" in sql
    assert args[0] == "0xabcdef"  # lowercased
    assert args[1] == "chat"
    assert args[3] == "free"


async def test_resolve_tier_returns_assigned() -> None:
    db = _FakeDb()
    db.resolve_value = "premium"
    assert await _store(db).resolve_tier("0xABC") == "premium"


async def test_resolve_tier_fails_closed_to_default() -> None:
    db = _FakeDb()
    db.resolve_value = None
    db.default_tier_value = "free"
    assert await _store(db).resolve_tier("0xABC") == DEFAULT_TIER


async def test_upsert_zero_chat_on_default_is_rejected() -> None:
    db = _FakeDb()
    db.is_default_value = True
    with pytest.raises(ValueError, match="strand"):
        await _store(db).upsert_tier(
            "free",
            display_name="Free",
            chat_daily_limit=0,
            recs_daily_limit=10,
            onboarding_daily_limit=20,
            concurrency=1,
            priority_weight=1,
            model_alias="sparkpoint-chat",
            actor="0xADM",
        )
    assert not any("UPDATE tier_definitions" in sql for sql, _ in db.calls)


async def test_upsert_unknown_tier_raises_keyerror() -> None:
    db = _FakeDb()
    db.is_default_value = None  # unknown tier
    with pytest.raises(KeyError):
        await _store(db).upsert_tier(
            "gold",
            display_name="Gold",
            chat_daily_limit=5,
            recs_daily_limit=5,
            onboarding_daily_limit=5,
            concurrency=1,
            priority_weight=1,
            model_alias="sparkpoint-chat",
            actor="0xADM",
        )


async def test_upsert_negative_value_is_rejected() -> None:
    db = _FakeDb()
    with pytest.raises(ValueError, match=">= 0"):
        await _store(db).upsert_tier(
            "premium",
            display_name="Premium",
            chat_daily_limit=-1,
            recs_daily_limit=100,
            onboarding_daily_limit=40,
            concurrency=2,
            priority_weight=3,
            model_alias="sparkpoint-chat",
            actor="0xADM",
        )


async def test_upsert_valid_writes_update_and_audit() -> None:
    db = _FakeDb()
    db.is_default_value = False
    db.execute_result = "UPDATE 1"
    await _store(db).upsert_tier(
        "premium",
        display_name="Premium",
        chat_daily_limit=400,
        recs_daily_limit=100,
        onboarding_daily_limit=40,
        concurrency=2,
        priority_weight=3,
        model_alias="sparkpoint-chat",
        actor="0xADM",
    )
    assert any("UPDATE tier_definitions" in sql for sql, _ in db.calls)
    assert _audit_actions(db) == ["tier_update"]


async def test_assign_and_revoke_are_audited() -> None:
    db = _FakeDb()
    await _store(db).assign("0xABC", "premium", actor="0xADM")
    assert _audit_actions(db) == ["grant"]

    db2 = _FakeDb()
    await _store(db2).revoke("0xABC", actor="0xADM")
    assert _audit_actions(db2) == ["revoke"]


async def test_seed_premium_is_idempotent() -> None:
    db = _FakeDb()
    db.execute_result = "INSERT 0 1"  # every seed is a new row
    added = await _store(db).seed_premium(["0xABC", "  ", "0xDEF"])
    assert added == 2  # blank skipped
    assert _audit_actions(db) == ["seed", "seed"]

    db2 = _FakeDb()
    db2.execute_result = "INSERT 0 0"  # all conflicts (already present)
    added2 = await _store(db2).seed_premium(["0xABC"])
    assert added2 == 0
    assert _audit_actions(db2) == []
