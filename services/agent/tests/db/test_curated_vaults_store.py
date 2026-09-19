# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""048 — ``PgCurationStore`` + ``public_board`` invariants, with asyncpg MOCKED (no live DB).

The load-bearing rules pinned here:

* the scan upsert FREEZES admin metadata (``provenance='admin'``) and never writes ``status``;
* a FAILED run touches only the state row (``record_run(ok=False)`` leaves the list + pick alone);
* auto-publish promotes AI candidates only — never a hidden/denied/admin row;
* the public read serves PUBLISHED recommendations only, and an admin PIN outranks the AI pick;
* an empty board carries the honest note, never a bare empty table.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sparkpoint_agent.api.curated_vaults import public_board
from sparkpoint_agent.db.curated_vaults import (
    APPROVED,
    CANDIDATE,
    HIDDEN,
    PgCurationStore,
    Recommendation,
    ScanVault,
)
from sparkpoint_agent.db.curated_vaults import CuratedVault as V
from sparkpoint_agent.db.curated_vaults import CurationState as S

_NOW = datetime(2026, 9, 18, 12, 0, tzinfo=UTC)


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
        return self._db.execute_result

    async def executemany(self, sql: str, params: list[Any]) -> None:
        self._db.calls.append((sql, tuple(params)))
        self._db.executemany_count = len(params)


class _FakeDb:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_result = "UPDATE 1"
        self.fetch_rows: list[Any] = []
        self.executemany_count = 0

    def acquire(self) -> _Ctx:
        return _Ctx(_FakeConn(self))

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        return self.execute_result

    async def fetch(self, sql: str, *args: Any) -> list[Any]:
        self.calls.append((sql, args))
        return self.fetch_rows


def _store() -> tuple[PgCurationStore, _FakeDb]:
    db = _FakeDb()
    return PgCurationStore(db), db


def _sql(db: _FakeDb) -> str:
    return "\n".join(sql for sql, _ in db.calls)


async def test_scan_upsert_freezes_admin_metadata_and_never_writes_status() -> None:
    store, db = _store()
    written = await store.upsert_scan_vaults(
        4663,
        [ScanVault(address="0xAbC", label="V", screened=True, score=80)],
        source="morpho",
        as_of=_NOW,
    )
    assert written == 1
    sql = _sql(db)
    # The freeze is a CASE on provenance for every admin-editable field...
    assert "curated_vaults.provenance = 'admin'" in sql
    for frozen in ("label", "curator", "curator_verified"):
        assert f"{frozen} = CASE WHEN" in sql
    # ...and the scan NEVER touches the decision fields. A guard against a future "helpful" edit.
    # Comment lines are stripped first: the SQL's own commentary names these columns.
    body = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    for untouched in (
        "status = EXCLUDED",
        "provenance = EXCLUDED",
        "wrapped = EXCLUDED",
        "deposit_mode = EXCLUDED",
        "pinned_at = EXCLUDED",
        "decided_by = EXCLUDED",
    ):
        assert untouched not in body, f"scan upsert must not write {untouched}"


async def test_failed_run_records_only_the_failure_and_clears_the_request() -> None:
    store, db = _store()
    db.execute_result = "INSERT 0 1"
    recorded = await store.record_run(
        4663, run_key="curator-4663-x", as_of=_NOW, ok=False, detail={"error": "morpho 503"}
    )
    assert recorded is True
    sql = _sql(db)
    # Fail-open: last_run_at is only advanced on success; the request marker is always cleared.
    assert "last_run_at = CASE WHEN $4" in sql
    assert "last_failed_at = CASE WHEN $4" in sql
    assert "run_requested_at = NULL" in sql


async def test_auto_publish_moves_ai_candidates_only() -> None:
    store, db = _store()
    await store.approve_recommended(4663, ["0xAbC"])
    sql = _sql(db)
    assert "provenance = 'ai'" in sql
    assert "status = 'candidate'" in sql
    assert db.calls[0][1] == (4663, ["0xabc"])


async def test_latest_recommendation_can_exclude_unpublished_proposals() -> None:
    store, db = _store()
    await store.latest_recommendation(4663, published_only=True)
    assert db.calls[0][1] == (4663, True)
    assert "NOT $2::boolean OR published" in db.calls[0][0]


async def test_pin_outranks_published_pick_and_hidden_never_surfaces() -> None:
    """Pure composition test: a pin outranks a published AI pick; hidden vaults never surface."""
    approved = _vault("0xaaa", status=APPROVED, pinned_at=_NOW.isoformat())
    other = _vault("0xbbb", status=APPROVED, score=99)
    hidden = _vault("0xccc", status=HIDDEN)
    rec = Recommendation(
        chain_id=4663,
        run_key="r1",
        as_of="2026-09-17T00:00:00+00:00",
        source="morpho",
        pick_address="0xbbb",
        pick_reason="Best net APY.",
        alternates=[{"address": "0xccc", "reason": "suppressed"}],
        published=True,
        provenance="ai",
    )
    board = public_board(4663, [approved, other, hidden], rec, S(chain_id=4663, auto_publish=True))
    # Hidden is not in the list the API passes (approved-only), but the alternates filter is the
    # second guard — the hidden address must not appear either way.
    assert board["pick"] is not None and board["pick"]["address"] == "0xaaa"
    assert board["pick"]["reason"] == "Pinned by SparkPoint."
    assert [v["address"] for v in board["vaults"]] == ["0xaaa", "0xbbb"]
    assert all(a["address"] != "0xccc" for a in board["alternates"])


async def test_empty_board_is_honest_not_a_bare_table() -> None:
    board = public_board(4663, [], None, S(chain_id=4663, auto_publish=False))
    assert board["pick"] is None
    assert board["vaults"] == []
    assert board["note"] and "No curated vaults" in board["note"]
    assert board["lastRunAt"] is None


def _vault(address: str, **over: Any) -> V:
    base: dict[str, Any] = {
        "chain_id": 4663,
        "vault_address": address,
        "source": "morpho",
        "label": f"Vault {address[-3:]}",
        "asset_address": "0xusdc",
        "asset_symbol": "USDC",
        "asset_decimals": 6,
        "curator": None,
        "curator_verified": False,
        "listed": True,
        "status": CANDIDATE,
        "provenance": "ai",
        "score": 70,
        "score_inputs": {},
        "screening": [],
        "net_apy_bps": 420,
        "tvl_usd": 1000.0,
        "liquidity_usd": 900.0,
        "vault_age_seconds": 86_400,
        "wrapped": False,
        "wrapper_address": None,
        "deposit_mode": "direct",
        "admin_note": None,
        "pinned_at": None,
        "decided_by": None,
        "decided_at": None,
        "first_seen_at": "2026-09-01T00:00:00+00:00",
        "last_scan_at": _NOW.isoformat(),
        "updated_at": _NOW.isoformat(),
    }
    base.update(over)
    return V(**base)


def test_a_published_pick_whose_vault_is_no_longer_approved_does_not_surface() -> None:
    """Deny/hide a pick after publication and the hero becomes empty — the record is not a right."""
    rec = Recommendation(
        chain_id=4663,
        run_key="r1",
        as_of="2026-09-17T00:00:00+00:00",
        source="morpho",
        pick_address="0xbbb",
        pick_reason="Best net APY.",
        alternates=[],
        published=True,
        provenance="ai",
    )
    board = public_board(4663, [], rec, S(chain_id=4663, auto_publish=True))
    assert board["pick"] is None
    assert board["note"]
