# ruff: noqa: S101
"""RecommendationStore + dedupe_key (migration 0022, feature 020 US5).

The asyncpg executor is a FAKE that records every fetchval/fetchrow/fetch/execute and returns canned
values by SQL fragment (no live Postgres). Covers: content-dedupe determinism, the upsert wire args,
forward-only status advance (never demote executed → acted), and the attribution joins.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sparkpoint_agent.db.pool import Database
from sparkpoint_agent.db.recommendations import (
    RecInsert,
    RecommendationStore,
    dedupe_key,
)

_RID = UUID("11111111-1111-1111-1111-111111111111")
_WALLET = "0xABCdef0000000000000000000000000000000001"
_NOW = datetime(2026, 7, 24, tzinfo=UTC)


class _FakeDb:
    """Records SQL + args; canned fetchval/fetchrow/fetch by SQL fragment (no live DB)."""

    def __init__(
        self,
        *,
        rec_id: UUID | None = _RID,
        status: str | None = None,
        row: dict[str, Any] | None = None,
        rows: list[dict[str, Any]] | None = None,
        tx_hex: str | None = None,
    ) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._rec_id = rec_id
        self._status = status
        self._row = row
        self._rows = rows or []
        self._tx_hex = tx_hex

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        if "SELECT status FROM recommendations" in sql:
            return self._status
        if "INSERT INTO recommendations" in sql:
            return self._rec_id
        if "encode(e.tx_hash" in sql and "intent_bundles" in sql:
            return self._tx_hex
        return None

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._row

    async def fetch(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._rows

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        return "UPDATE 1"


def _store(db: _FakeDb) -> RecommendationStore:
    return RecommendationStore(cast(Database, db))


def _find(db: _FakeDb, fragment: str) -> tuple[str, tuple[Any, ...]]:
    for sql, args in db.calls:
        if fragment in sql:
            return sql, args
    raise AssertionError(f"no call matched {fragment!r}")


def _has(db: _FakeDb, fragment: str) -> bool:
    return any(fragment in sql for sql, _ in db.calls)


# ── dedupe_key ────────────────────────────────────────────────────────────────────


def test_dedupe_key_is_stable_and_case_insensitive_on_wallet() -> None:
    action = {"type": "vault_deposit", "amount": "100"}
    a = dedupe_key(_WALLET, "vault_deposit", action, "v1")
    b = dedupe_key(_WALLET.lower(), "vault_deposit", dict(reversed(list(action.items()))), "v1")
    assert a == b  # same content (key order irrelevant) + wallet case-folded → identical hash


def test_dedupe_key_varies_on_content_and_policy_version() -> None:
    action = {"type": "vault_deposit", "amount": "100"}
    base = dedupe_key(_WALLET, "vault_deposit", action, "v1")
    assert base != dedupe_key(_WALLET, "vault_deposit", {**action, "amount": "200"}, "v1")
    assert base != dedupe_key(_WALLET, "vault_deposit", action, "v2")
    assert base != dedupe_key(_WALLET, "vault_redeem", action, "v1")


# ── upsert ────────────────────────────────────────────────────────────────────────


async def test_upsert_lowercases_wallet_encodes_json_and_returns_id() -> None:
    db = _FakeDb(rec_id=_RID)
    action = {"type": "vault_deposit", "amount": "100"}
    rid = await _store(db).upsert(
        RecInsert(
            wallet=_WALLET,
            strategy_kind="vault_deposit",
            title="Deposit into the Aave vault",
            proposed_action=action,
            policy_version="v1",
            rationale="Earn yield on idle USDC.",
        )
    )
    assert rid == _RID
    _, args = _find(db, "INSERT INTO recommendations")
    assert args[0] == _WALLET.lower()  # $1 wallet, case-folded
    assert args[1] == dedupe_key(_WALLET, "vault_deposit", action, "v1")  # $2 content hash
    assert args[5] == '{"type": "vault_deposit", "amount": "100"}'  # $6 proposed_action json


# ── mark_status (forward-only) ──────────────────────────────────────────────────────


async def test_mark_status_advances_acted_to_executed() -> None:
    db = _FakeDb(status="acted")
    await _store(db).mark_status(_RID, "executed")
    _, args = _find(db, "UPDATE recommendations SET status")
    assert args == (_RID, "executed")


async def test_mark_status_never_demotes_executed_to_acted() -> None:
    db = _FakeDb(status="executed")
    await _store(db).mark_status(_RID, "acted")
    # It reads the current status but must NOT issue the downgrade UPDATE.
    assert _has(db, "SELECT status FROM recommendations")
    assert not _has(db, "UPDATE recommendations SET status")


# ── attribution joins ───────────────────────────────────────────────────────────────


async def test_deposit_tx_for_prefixes_0x_or_returns_none() -> None:
    assert await _store(_FakeDb(tx_hex="deadbeef")).deposit_tx_for(_RID) == "0xdeadbeef"
    assert await _store(_FakeDb(tx_hex=None)).deposit_tx_for(_RID) is None


async def test_list_acted_maps_rows_to_acted_recs_with_0x_tx() -> None:
    rows = [
        {
            "id": _RID,
            "title": "Deposit into the Aave vault",
            "strategy_kind": "vault_deposit",
            "proposed_action": {"type": "vault_deposit", "amount": "100"},
            "rationale": "Earn yield.",
            "tx_hex": "abc123",
        }
    ]
    acted = await _store(_FakeDb(rows=rows)).list_acted(_WALLET)
    assert len(acted) == 1
    assert acted[0].rec_id == _RID
    assert acted[0].deposit_tx == "0xabc123"
    assert acted[0].strategy_kind == "vault_deposit"


async def test_get_returns_none_when_absent() -> None:
    assert await _store(_FakeDb(row=None)).get(_RID) is None
