# ruff: noqa: S101, S105, S106
"""T007 - SubscriptionStore SQL shape + the 0017 migration (feature 012).

The asyncpg executor is a FAKE that records every execute/fetchval + returns canned values (no live
DB; mirrors tests/db/test_vault_factory_store.py + tests/test_limits_store.py). Pins:

  * ``record_and_grant`` banks the payment, opens the ``subscriptions`` row, grants premium via the
    008 ``wallet_tier`` upsert (source='srk', expires_at set) + a ``limits_audit`` 'grant' -- all in
    one transaction; addresses/hashes are lower-cased;
  * a duplicate ``(network_id, tx_hash)`` (payment insert returns no id) raises and grants NOTHING;
  * the ``0017_subscriptions.sql`` migration CREATEs payments (UNIQUE anti-replay) + subscriptions +
    ALTERs wallet_tier with expires_at; the 008 tier-resolve is now expiry-aware.

NON-CUSTODY: these are entitlement records only, never a signing input or fund path (N1/N2).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pytest

from sparkpoint_agent.db.limits import _RESOLVE_SQL
from sparkpoint_agent.db.pool import Database
from sparkpoint_agent.db.subscriptions import PaymentAlreadyRecorded, SubscriptionStore

_MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
_EXPIRY = datetime(2026, 8, 21, tzinfo=UTC)


class _Ctx:
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
        return "INSERT 0 1"

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self._db.calls.append((sql, args))
        return self._db.val_for(sql)


class _FakeDb:
    """Records execute/fetchval SQL + args; canned fetchval by SQL fragment (no live DB)."""

    def __init__(self, *, payment_id: int | None = 1) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.payment_id = payment_id  # None => ON CONFLICT DO NOTHING returned no row (a replay)

    def val_for(self, sql: str) -> Any:
        if "INTO payments" in sql:
            return self.payment_id
        if "new_expiry" in sql:
            return _EXPIRY
        return None

    def acquire(self) -> _Ctx:
        return _Ctx(_FakeConn(self))


def _store(db: _FakeDb) -> SubscriptionStore:
    return SubscriptionStore(cast(Database, db))


def _find(db: _FakeDb, fragment: str) -> tuple[str, tuple[Any, ...]]:
    for sql, args in db.calls:
        if fragment in sql:
            return sql, args
    raise AssertionError(f"no call matched {fragment!r}")


async def test_record_and_grant_banks_payment_and_grants_premium() -> None:
    db = _FakeDb(payment_id=42)
    expiry = await _store(db).record_and_grant(
        buyer="0xABCdef0000000000000000000000000000000001",
        tx_hash="0xDEADbeef",
        network_id="base-sepolia",
        token="0xTOKEN000000000000000000000000000000000A".lower(),
        amount_raw=500 * 10**18,
        block_number=123,
    )
    assert expiry == _EXPIRY

    # payment banked with lower-cased buyer/hash and the amount in raw base units
    _, pay = _find(db, "INTO payments")
    assert pay == (
        "base-sepolia",
        "0xdeadbeef",
        "0xabcdef0000000000000000000000000000000001",
        "0xtoken000000000000000000000000000000000a",
        500 * 10**18,
        123,
    )
    # subscription row opened for the buyer with the computed expiry
    _, sub = _find(db, "INTO subscriptions")
    assert sub[0] == "0xabcdef0000000000000000000000000000000001"
    assert sub[1] == _EXPIRY
    # premium granted via the 008 wallet_tier upsert: source='srk', expires_at set
    _, grant = _find(db, "INTO wallet_tier")
    assert grant[1] == "premium"
    assert grant[2] == "srk"
    assert grant[4] == _EXPIRY
    # audited as a 'grant'
    _, audit = _find(db, "INTO limits_audit")
    assert audit[0] == "grant"


async def test_duplicate_payment_raises_and_grants_nothing() -> None:
    db = _FakeDb(payment_id=None)  # ON CONFLICT DO NOTHING => replay
    with pytest.raises(PaymentAlreadyRecorded):
        await _store(db).record_and_grant(
            buyer="0xabc0000000000000000000000000000000000001",
            tx_hash="0xfeed",
            network_id="base-sepolia",
            token="0xtoken000000000000000000000000000000000a",
            amount_raw=1,
            block_number=1,
        )
    # NO grant, NO subscription, NO audit after the replay abort
    assert not any("INTO subscriptions" in sql for sql, _ in db.calls)
    assert not any("INTO wallet_tier" in sql for sql, _ in db.calls)
    assert not any("INTO limits_audit" in sql for sql, _ in db.calls)


def test_migration_0017_shape() -> None:
    sql = (_MIGRATIONS / "0017_subscriptions.sql").read_text()
    assert "CREATE TABLE IF NOT EXISTS payments" in sql
    assert "UNIQUE (network_id, tx_hash)" in sql  # the anti-replay control
    assert "REFERENCES networks (id)" in sql
    assert "CREATE TABLE IF NOT EXISTS subscriptions" in sql
    assert "REFERENCES tier_definitions (tier)" in sql
    assert "ALTER TABLE wallet_tier ADD COLUMN IF NOT EXISTS expires_at" in sql


def test_tier_resolve_is_expiry_aware() -> None:
    # the one-clause 008 change that makes an expired grant fail-closed to free on the hot path
    assert "expires_at IS NULL OR expires_at > now()" in _RESOLVE_SQL
