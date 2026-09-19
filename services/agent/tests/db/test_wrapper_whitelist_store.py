# ruff: noqa: S101
"""049 v4.1.0 — the admission mirror store (``PgWhitelistStore``) + the 0040 migration.

Asserts the migration is the next-free number and creates the mirror table, that
``default_wrapper_params`` mirrors the panel's P11 defaults, that record_whitelist is idempotent
per pending child, and that every read/write fail-opens on an unapplied DB (no live DB: the
asyncpg executor is a fake that records calls, mirrors tests/db/test_vault_factory_store.py).
NON-CUSTODY: records only, never a signing input or fund path (N1/N2).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from asyncpg.exceptions import UndefinedTableError

from sparkpoint_agent.db.wrapper_whitelist import (
    DEPLOYED,
    PENDING,
    PgWhitelistStore,
    default_wrapper_params,
)

_MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"

_CHILD = "0x2222222222222222222222222222222222222222"
_AI = "0x7777777777777777777777777777777777777777"

_ENTRY_ROW: dict[str, Any] = {
    "id": "11111111-1111-4111-8111-111111111111",
    "chain_id": 4663,
    "child_address": _CHILD,
    "by_address": _AI,
    "ready_at": 4_102_444_800,
    "fee_bps": 1000,
    "per_user_cap": 5_000_000_000,
    "total_cap": 1_000_000_000_000,
    "vault_cap": 1_000_000_000_000,
    "name": "Steakhouse USDG",
    "symbol": "spUSDG",
    "label": "Steakhouse USDG · SparkPoint wrapper",
    "status": "pending",
    "tx_hash": None,
    "proxy_address": None,
    "cap_registry": None,
    "error": None,
    "runner_commit": None,
    "recorded_by": None,
    "reported_at": None,
    "deployed_at": None,
    "cancelled_at": None,
    "created_at": "2026-09-19T12:00:00+00:00",
    "updated_at": "2026-09-19T12:00:00+00:00",
}


class _FakeDb:
    """Returns queued responses (row / list / exception) and records every statement."""

    def __init__(self, responses: list[Any] | None = None) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._responses = list(responses or [])

    def _next(self) -> Any:
        response = self._responses.pop(0) if self._responses else None
        if isinstance(response, Exception):
            raise response
        return response

    async def fetch(self, query: str, *args: Any) -> Any:
        self.calls.append((query, args))
        return self._next() or []

    async def fetchrow(self, query: str, *args: Any) -> Any:
        self.calls.append((query, args))
        return self._next()


def _whitelist_kwargs() -> dict[str, Any]:
    return {
        "child_address": _CHILD,
        "by_address": _AI,
        "ready_at": 4_102_444_800,
        "fee_bps": 1000,
        "per_user_cap": 5_000_000_000,
        "total_cap": 1_000_000_000_000,
        "vault_cap": 1_000_000_000_000,
        "name": "Steakhouse USDG",
        "symbol": "spUSDG",
        "label": "Steakhouse USDG · SparkPoint wrapper",
        "tx_hash": None,
        "actor": None,
    }


def test_migration_is_next_free_0040() -> None:
    numbers = sorted(int(p.name[:4]) for p in _MIGRATIONS.glob("0*.sql"))
    assert 40 in numbers, "0040 migration must exist"
    assert max(n for n in numbers if n < 40) == 39


def test_migration_creates_the_mirror_table() -> None:
    sql = (_MIGRATIONS / "0040_wrapper_whitelist.sql").read_text().lower()
    assert "create table if not exists wrapper_whitelist" in sql
    assert "child_address = lower(child_address)" in sql
    assert "alter table" not in sql  # additive only


def test_default_params_mirror_the_panel_form() -> None:
    params = default_wrapper_params(
        label="Steakhouse USDG", asset_symbol="USDG", asset_decimals=6
    )
    assert params["fee_bps"] == 1000
    assert params["per_user_cap"] == 5_000 * 10**6
    assert params["total_cap"] == 1_000_000 * 10**6
    assert params["vault_cap"] == 1_000_000 * 10**6
    assert params["name"] == "Steakhouse USDG"
    assert params["symbol"] == "spUSDG"
    assert params["label"] == "Steakhouse USDG · SparkPoint wrapper"


def test_default_params_scale_sanitize_and_bound() -> None:
    params = default_wrapper_params(
        label="A very long label " * 10, asset_symbol="US+D/G!", asset_decimals=18
    )
    assert params["per_user_cap"] == 5_000 * 10**18
    assert params["symbol"] == "spUSDG"
    assert len(params["name"]) <= 80
    assert len(params["label"]) <= 200


def test_default_params_fall_back_to_six_decimals() -> None:
    params = default_wrapper_params(label="X", asset_symbol=None, asset_decimals=None)
    assert params["per_user_cap"] == 5_000 * 10**6
    assert params["symbol"] == "spUSDG"


async def test_record_whitelist_inserts_a_pending_row() -> None:
    db = _FakeDb(responses=[None, _ENTRY_ROW])  # get_latest -> none, INSERT -> row
    store = PgWhitelistStore(db)  # type: ignore[arg-type]
    entry = await store.record_whitelist(4663, **_whitelist_kwargs())
    assert entry.status == PENDING
    assert entry.by_address == _AI
    assert entry.ready is False  # 4_102_444_800 is far in the future
    assert "insert into wrapper_whitelist" in db.calls[-1][0].lower()


async def test_record_whitelist_refreshes_the_existing_pending_row() -> None:
    updated = dict(_ENTRY_ROW, ready_at=0, status="pending")
    db = _FakeDb(responses=[_ENTRY_ROW, updated])  # get_latest -> pending, UPDATE -> row
    store = PgWhitelistStore(db)  # type: ignore[arg-type]
    entry = await store.record_whitelist(4663, **_whitelist_kwargs())
    assert entry.ready_at == 0
    assert "update wrapper_whitelist" in db.calls[-1][0].lower()
    assert len(db.calls) == 2  # no second INSERT


async def test_record_deploy_resolves_the_pending_row() -> None:
    deployed = dict(_ENTRY_ROW, status="deployed", proxy_address="0x" + "44" * 20)
    db = _FakeDb(responses=[deployed])
    store = PgWhitelistStore(db)  # type: ignore[arg-type]
    entry = await store.record_deploy(
        4663,
        child_address=_CHILD,
        tx_hash=None,
        proxy_address="0x" + "44" * 20,
        cap_registry=None,
        actor=None,
    )
    assert entry is not None and entry.status == DEPLOYED
    assert "status = 'deployed'" in db.calls[-1][0].lower()


async def test_fail_open_on_an_unapplied_db() -> None:
    db = _FakeDb(responses=[UndefinedTableError(), UndefinedTableError(), UndefinedTableError()])
    store = PgWhitelistStore(db)  # type: ignore[arg-type]
    assert await store.list_entries(4663) == []
    assert await store.latest_by_child(4663) == {}
    assert await store.get_latest(4663, _CHILD) is None
