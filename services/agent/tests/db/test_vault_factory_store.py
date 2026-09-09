# ruff: noqa: S101
"""T021 — the feature-011 provenance store (``VaultFactoryStore``) SQL shape + the 0015 migration.

Two 011-owned tables from ``migrations/0016_vault_factory.sql`` (``morpho_curated_allowlist`` +
``sparkpoint_wrappers``). This asserts:

  * the migration is the next-free number (0015) and CREATEs both tables (010 has none to ALTER);
  * ``insert_pending_wrapper`` binds a ``pending`` ``morpho_wrapper`` row (lower-cased addresses);
  * ``upsert_allowlist_record`` binds the vetting record with ``status`` mirroring ``allowed``;
  * list/get bind the expected parameterised statements.

No live DB — the asyncpg executor is a fake that records every ``execute``/``fetch``/``fetchrow``
(mirrors ``tests/knowledge/test_knowledge_store.py``). NON-CUSTODY: these are provenance/access
records only, never a signing input or fund path (N1/N2).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from sparkpoint_agent.db.vault_factory import VaultFactoryStore

_MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


class _FakeRecord(dict[str, Any]):
    """A dict that also exposes asyncpg's ``.keys()`` (dict already does)."""


class _FakeDb:
    """Records every statement + returns canned rows for fetch/fetchrow (no live DB)."""

    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.fetched: list[tuple[str, tuple[Any, ...]]] = []
        self._rows = [_FakeRecord(r) for r in (rows or [])]

    async def execute(self, query: str, *args: Any) -> str:
        self.executed.append((query, args))
        return "INSERT 0 1"

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        self.fetched.append((query, args))
        return self._rows

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        self.fetched.append((query, args))
        return self._rows[0] if self._rows else None


# ── migration file ───────────────────────────────────────────────────────────


def test_migration_is_next_free_0016() -> None:
    numbers = sorted(int(p.name[:4]) for p in _MIGRATIONS.glob("0*.sql"))
    assert 16 in numbers, "0016 migration must exist"
    # 0016 is exactly one past the previous max (0015_limits — feature 008, merged from develop).
    assert max(n for n in numbers if n < 16) == 15


def test_migration_creates_both_011_tables() -> None:
    sql = (_MIGRATIONS / "0016_vault_factory.sql").read_text().lower()
    assert "create table if not exists morpho_curated_allowlist" in sql
    assert "create table if not exists sparkpoint_wrappers" in sql
    # No ALTER — 010 owns a static-config registry, so there is no table to ALTER.
    assert "alter table" not in sql


# ── wrapper provenance ───────────────────────────────────────────────────────


async def test_insert_pending_wrapper_binds_pending_row() -> None:
    db = _FakeDb()
    store = VaultFactoryStore(db)  # type: ignore[arg-type]
    await store.insert_pending_wrapper(
        vault_address="0xAaAaAAAAAaAAAaAAAaAAAAaaaAAAAAaAaaAAaAaA",
        chain_id=84532,
        label="SparkPoint · Steakhouse USDC",
        morpho_vault="0xBbBBbbBBbbBBBBbBBBBbbBbBbBbBbBbBbBbBbBbB",
        native_fee_bps=50,
        factory_address="0xCccCCCCCcCcCCCcccCCcccCCCcCCcccCCcCCcccC",
    )
    assert len(db.executed) == 1
    query, args = db.executed[0]
    assert "insert into sparkpoint_wrappers" in query.lower()
    assert "'pending'" in query.lower() and "'morpho_wrapper'" in query.lower()
    # Addresses are lower-cased before binding (checksum-agnostic).
    assert args[0] == "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    assert args[1] == 84532
    assert args[3] == "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    assert args[4] == 50
    assert args[5] == "0xcccccccccccccccccccccccccccccccccccccccc"


# ── curated allowlist vetting record ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("allowed", "expected_status"),
    [(True, "allowlisted"), (False, "revoked")],
)
async def test_upsert_allowlist_record_status_mirrors_allowed(
    allowed: bool, expected_status: str
) -> None:
    db = _FakeDb()
    store = VaultFactoryStore(db)  # type: ignore[arg-type]
    await store.upsert_allowlist_record(
        morpho_vault="0xDdDDddddDDDDddddDDDDddddDDDDddddDDDDdddd",
        chain_id=8453,
        allowed=allowed,
        curator="0xEeEEeeeeEEEEeeeeEEEEeeeeEEEEeeeeEEEEeeee",
        native_fee_bps=100,
        vetting_notes="Curated: $40M TVL, dual audit, hardened oracle.",
        author="0xADMIN000000000000000000000000000000ADMIN",
    )
    assert len(db.executed) == 1
    query, args = db.executed[0]
    assert "insert into morpho_curated_allowlist" in query.lower()
    assert args[0] == "0xdddddddddddddddddddddddddddddddddddddddd"
    assert args[1] == 8453
    assert args[2] is allowed
    assert args[3] == "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"  # curator lower-cased
    assert args[10] == expected_status  # status column


async def test_mark_wrapper_live_promotes_only_pending() -> None:
    db = _FakeDb()
    store = VaultFactoryStore(db)  # type: ignore[arg-type]
    await store.mark_wrapper_live("0xAaAaAAAAAaAAAaAAAaAAAAaaaAAAAAaAaaAAaAaA", 84532)
    assert len(db.executed) == 1
    query, args = db.executed[0]
    q = query.lower()
    assert "update sparkpoint_wrappers" in q
    assert "set status = 'live'" in q
    # Promote-only guard: the WHERE pins status = 'pending', so a `live` row is never demoted.
    assert "status = 'pending'" in q
    assert args[0] == 84532
    assert args[1] == "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"  # lower-cased


async def test_get_wrapper_returns_dict_or_none() -> None:
    empty = VaultFactoryStore(_FakeDb())  # type: ignore[arg-type]
    assert await empty.get_wrapper(84532, "0x00") is None

    row = {
        "vault_address": "0xvault",
        "chain_id": 84532,
        "kind": "morpho_wrapper",
        "label": "L",
        "morpho_vault": "0xm",
        "native_fee_bps": 50,
        "deploy_tx": None,
        "factory_address": "0xf",
        "status": "pending",
        "created_at": "2026-07-21T00:00:00+00:00",
    }
    populated = VaultFactoryStore(_FakeDb([row]))  # type: ignore[arg-type]
    got = await populated.get_wrapper(84532, "0xVAULT")
    assert got is not None and got["status"] == "pending"
