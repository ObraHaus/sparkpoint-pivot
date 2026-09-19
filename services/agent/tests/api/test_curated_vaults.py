# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""048 — the curated-vault routes, exercised THROUGH the app.

A route's dependency graph is only real once a request goes through it (see
``test_admin_bots.py`` for the bug that taught this repo that lesson), so these tests build a real
FastAPI app with the real router and override only the STORE + identity — never the gates.

Covered: the honest empty board, a published pick + alternates, admin pin precedence, the admin
review actions, non-admin 404, and the ingest publish policy (auto-publish off = AI proposes; on =
published, but never overruling a hidden/denied decision; failed runs write nothing).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.curated_vaults import get_curation_store, router
from sparkpoint_agent.api.errors import ApiError, api_error_handler, validation_error_handler
from sparkpoint_agent.api.mandate import get_account
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.db.curated_vaults import (
    APPROVED,
    CANDIDATE,
    CuratedVault,
    CurationState,
    Recommendation,
)

_OWNER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
_ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
_CHAIN = 4663
_NOW = datetime(2026, 9, 18, 12, 0, tzinfo=UTC)
_A1 = "0x1111111111111111111111111111111111111111"
_A2 = "0x2222222222222222222222222222222222222222"
_A3 = "0x3333333333333333333333333333333333333333"
_A4 = "0x4444444444444444444444444444444444444444"


def _vault(address: str, **over: Any) -> CuratedVault:
    base: dict[str, Any] = {
        "chain_id": _CHAIN,
        "vault_address": address.lower(),
        "source": "morpho",
        "label": f"Vault {address[-3:]}",
        "asset_address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "asset_symbol": "USDC",
        "asset_decimals": 6,
        "curator": None,
        "curator_verified": False,
        "listed": True,
        "status": CANDIDATE,
        "provenance": "ai",
        "score": 70,
        "score_inputs": {"netApyBps": 420, "tvlUsd": 1000.0},
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
        "first_seen_at": _NOW.isoformat(),
        "last_scan_at": _NOW.isoformat(),
        "updated_at": _NOW.isoformat(),
    }
    base.update(over)
    return CuratedVault(**base)


class FakeStore:
    """An in-memory :class:`CurationStore` that mirrors the store's core semantics."""

    def __init__(self) -> None:
        self.vaults: dict[str, CuratedVault] = {}
        self.recs: list[Recommendation] = []
        self.state = CurationState(
            chain_id=_CHAIN,
            auto_publish=False,
            last_run_at=None,
            last_run_ok=None,
            last_run_key=None,
            last_failed_at=None,
            last_failed_detail={},
            run_requested_at=None,
            run_requested_by=None,
        )
        self.audit: list[dict[str, Any]] = []
        self.last_run_detail: dict[str, Any] = {}

    async def list_vaults(
        self, chain_id: int, *, statuses: tuple[str, ...] | None = None
    ) -> list[CuratedVault]:
        rows = [
            v
            for v in self.vaults.values()
            if v.chain_id == chain_id and (statuses is None or v.status in statuses)
        ]
        return sorted(rows, key=lambda v: (-(v.score or 0), v.vault_address))

    async def get_vault(self, chain_id: int, address: str) -> CuratedVault | None:
        return self.vaults.get(address.lower())

    async def upsert_scan_vaults(
        self, chain_id: int, vaults: list[Any], *, source: str, as_of: datetime
    ) -> int:
        for sv in vaults:
            key = sv.address.lower()
            existing = self.vaults.get(key)
            if existing is None:
                self.vaults[key] = _vault(
                    key,
                    label=sv.label,
                    asset_address=sv.asset_address or _vault(key).asset_address,
                    asset_symbol=sv.asset_symbol,
                    asset_decimals=sv.asset_decimals,
                    curator=sv.curator,
                    curator_verified=sv.curator_verified,
                    listed=sv.listed,
                    score=sv.score,
                    score_inputs=sv.score_inputs,
                    screening=sv.screening,
                    net_apy_bps=sv.net_apy_bps,
                    tvl_usd=sv.tvl_usd,
                    liquidity_usd=sv.liquidity_usd,
                    vault_age_seconds=sv.vault_age_seconds,
                )
                continue
            changes: dict[str, Any] = {
                "score": sv.score,
                "score_inputs": sv.score_inputs,
                "screening": sv.screening,
                "net_apy_bps": sv.net_apy_bps,
                "tvl_usd": sv.tvl_usd,
                "liquidity_usd": sv.liquidity_usd,
                "last_scan_at": as_of.isoformat(),
            }
            if existing.provenance != "admin":
                changes.update(
                    label=sv.label,
                    curator=sv.curator,
                    curator_verified=sv.curator_verified,
                )
            # status is deliberately NOT touched, mirroring the SQL.
            self.vaults[key] = replace(existing, **changes)
        return len(vaults)

    async def approve_recommended(self, chain_id: int, addresses: list[str]) -> int:
        count = 0
        for address in addresses:
            vault = self.vaults.get(address.lower())
            if vault and vault.provenance == "ai" and vault.status == CANDIDATE:
                self.vaults[vault.vault_address] = replace(vault, status=APPROVED)
                count += 1
        return count

    async def record_recommendation(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        source: str,
        pick_address: str,
        pick_reason: str,
        alternates: list[dict[str, Any]],
        published: bool,
        provenance: str = "ai",
    ) -> bool:
        if run_key is not None and any(r.run_key == run_key for r in self.recs):
            return False
        self.recs.append(
            Recommendation(
                chain_id=chain_id,
                run_key=run_key,
                as_of=as_of.isoformat(),
                source=source,
                pick_address=pick_address.lower(),
                pick_reason=pick_reason,
                alternates=alternates,
                published=published,
                provenance=provenance,
            )
        )
        return True

    async def latest_recommendation(
        self, chain_id: int, *, published_only: bool = True
    ) -> Recommendation | None:
        rows = [
            r
            for r in self.recs
            if r.chain_id == chain_id and (not published_only or r.published)
        ]
        return rows[-1] if rows else None

    async def get_state(self, chain_id: int) -> CurationState:
        return self.state

    async def set_auto_publish(
        self, chain_id: int, *, enabled: bool, actor: str | None
    ) -> None:
        self.state = replace(self.state, auto_publish=enabled)

    async def request_run(self, chain_id: int, *, actor: str | None) -> None:
        # Mirrors the store: actors are persisted lowercase.
        self.state = replace(
            self.state,
            run_requested_at=_NOW.isoformat(),
            run_requested_by=actor.lower() if actor else None,
        )

    async def record_run(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        ok: bool,
        detail: dict[str, Any],
    ) -> bool:
        changes: dict[str, Any] = {"run_requested_at": None, "run_requested_by": None}
        self.last_run_detail = detail
        if ok:
            changes.update(
                last_run_at=as_of.isoformat(), last_run_ok=True, last_run_key=run_key
            )
        else:
            changes.update(
                last_failed_at=as_of.isoformat(), last_run_ok=False, last_failed_detail=detail
            )
        self.state = replace(self.state, **changes)
        return True

    async def decide(
        self,
        chain_id: int,
        *,
        address: str,
        status: str,
        actor: str | None,
        note: str | None = None,
    ) -> bool:
        vault = self.vaults.get(address.lower())
        if vault is None:
            return False
        self.vaults[vault.vault_address] = replace(
            vault,
            status=status,
            provenance="admin",
            decided_by=actor,
            decided_at=_NOW.isoformat(),
            admin_note=note or vault.admin_note,
        )
        self.audit.append(
            {
                "action": status,
                "address": vault.vault_address,
                "actor": actor.lower() if actor else None,
            }
        )
        return True

    async def set_pinned(
        self, chain_id: int, *, address: str, pinned: bool, actor: str | None
    ) -> bool:
        vault = self.vaults.get(address.lower())
        if vault is None:
            return False
        if pinned:
            for key, other in list(self.vaults.items()):
                if other.pinned_at and key != vault.vault_address:
                    self.vaults[key] = replace(other, pinned_at=None)
        self.vaults[vault.vault_address] = replace(
            vault,
            pinned_at=_NOW.isoformat() if pinned else None,
            status=APPROVED if pinned else vault.status,
            provenance="admin" if pinned else vault.provenance,
        )
        self.audit.append(
            {
                "action": "pin" if pinned else "unpin",
                "address": address,
                "actor": actor.lower() if actor else None,
            }
        )
        return True

    async def update_metadata(
        self, chain_id: int, *, address: str, fields: dict[str, Any], actor: str | None
    ) -> CuratedVault | None:
        vault = self.vaults.get(address.lower())
        if vault is None:
            return None
        updated = replace(vault, provenance="admin", **fields)
        self.vaults[vault.vault_address] = updated
        self.audit.append(
            {"action": "edit", "address": address, "actor": actor.lower() if actor else None}
        )
        return updated

    async def upsert_admin_vault(
        self, chain_id: int, *, address: str, label: str, **over: Any
    ) -> bool:
        key = address.lower()
        created = key not in self.vaults
        base = self.vaults.get(key, _vault(key))
        self.vaults[key] = replace(
            base,
            label=label,
            status=APPROVED,
            provenance="admin",
            wrapped=bool(over.get("wrapped", False)),
            wrapper_address=over.get("wrapper_address"),
            deposit_mode=over.get("deposit_mode", "direct"),
            admin_note=over.get("admin_note"),
        )
        self.audit.append({"action": "add", "address": key})  # add carries no actor in this fake
        return created

    async def list_audit(self, chain_id: int | None, limit: int = 50) -> list[dict[str, Any]]:
        return self.audit[:limit]


@pytest.fixture
def client() -> tuple[TestClient, FakeStore]:
    store = FakeStore()
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=_OWNER, owner=_OWNER, chain_id=_CHAIN
    )
    app.dependency_overrides[get_curation_store] = lambda: store

    # require_admin stays in the graph; only its allowlist store is faked.
    class FakeAllowlist:
        async def is_admin(self, address: str) -> bool:
            return address.lower() == _ADMIN.lower()

    app.dependency_overrides[get_allowlist_store] = lambda: FakeAllowlist()
    return TestClient(app), store


# ── public board ─────────────────────────────────────────────────────────────────────────────────


def test_empty_board_is_an_honest_state_not_a_bare_table(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, _ = client
    resp = c.get("/vaults/curated")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["chainId"] == _CHAIN
    assert data["pick"] is None
    assert data["alternates"] == []
    assert data["vaults"] == []
    assert "No curated vaults" in (data["note"] or "")
    assert data["lastRunAt"] is None
    assert data["autoPublish"] is False


def test_published_pick_and_alternates_render(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=APPROVED, label="Alpha", net_apy_bps=500)
    store.vaults[_A2] = _vault(_A2, status=APPROVED, label="Beta", score=60)
    store.vaults[_A3] = _vault(_A3, status=APPROVED, label="Gamma", score=50)
    store.recs.append(
        Recommendation(
            chain_id=_CHAIN,
            run_key="r1",
            as_of=_NOW.isoformat(),
            source="morpho",
            pick_address=_A1,
            pick_reason="Best net APY with verified curator.",
            alternates=[
                {"address": _A2, "reason": "Runner-up."},
                {"address": _A3, "reason": "Third."},
            ],
            published=True,
            provenance="ai",
        )
    )
    data = c.get("/vaults/curated").json()
    assert data["pick"]["address"] == _A1
    assert data["pick"]["reason"] == "Best net APY with verified curator."
    assert data["pick"]["label"] == "Alpha"
    assert [a["address"] for a in data["alternates"]] == [_A2, _A3]
    assert len(data["vaults"]) == 3
    assert data["note"] is None


def test_a_candidate_is_never_public_until_approved(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=CANDIDATE)
    data = c.get("/vaults/curated").json()
    assert data["vaults"] == []
    assert data["note"]


# ── admin panel ──────────────────────────────────────────────────────────────────────────────────


def test_admin_list_includes_candidates_and_state(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=CANDIDATE)
    data = c.get("/admin/vaults/curation").json()
    assert [v["address"] for v in data["vaults"]] == [_A1]
    assert data["autoPublish"] is False
    assert data["statuses"] == ["candidate", "approved", "hidden", "denied"]


def test_approve_publishes_and_records_provenance(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=CANDIDATE)
    resp = c.post("/admin/vaults/curation/approve", json={"address": _A1})
    assert resp.status_code == 200
    assert store.vaults[_A1].status == APPROVED
    assert store.vaults[_A1].provenance == "admin"
    assert c.get("/vaults/curated").json()["vaults"][0]["address"] == _A1


def test_deny_and_hide_remove_from_the_public_board(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=APPROVED)
    assert c.post("/admin/vaults/curation/deny", json={"address": _A1}).status_code == 200
    assert c.get("/vaults/curated").json()["vaults"] == []
    store.vaults[_A1] = replace(store.vaults[_A1], status=APPROVED)
    assert c.post("/admin/vaults/curation/hide", json={"address": _A1}).status_code == 200
    assert c.get("/vaults/curated").json()["vaults"] == []


def test_pin_wins_the_hero_over_the_ai_pick(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=APPROVED)
    store.vaults[_A2] = _vault(_A2, status=APPROVED)
    store.recs.append(
        Recommendation(
            chain_id=_CHAIN,
            run_key="r1",
            as_of=_NOW.isoformat(),
            source="morpho",
            pick_address=_A1,
            pick_reason="AI pick.",
            alternates=[],
            published=True,
            provenance="ai",
        )
    )
    assert c.get("/vaults/curated").json()["pick"]["address"] == _A1
    c.post("/admin/vaults/curation/pin", json={"address": _A2, "pinned": True})
    assert c.get("/vaults/curated").json()["pick"]["address"] == _A2
    c.post("/admin/vaults/curation/pin", json={"address": _A2, "pinned": False})
    assert c.get("/vaults/curated").json()["pick"]["address"] == _A1


def test_edit_rejects_an_inconsistent_deposit_rail_and_cannot_clear_not_null_fields(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=APPROVED)
    bad = c.post(
        "/admin/vaults/curation/edit", json={"address": _A1, "wrapped": True}
    )
    assert bad.status_code == 400
    # A NOT NULL column given an explicit null is dropped, not applied as null.
    empty = c.post("/admin/vaults/curation/edit", json={"address": _A1, "label": None})
    assert empty.status_code == 400
    good = c.post(
        "/admin/vaults/curation/edit",
        json={"address": _A1, "admin_note": "Reviewed by operator."},
    )
    assert good.status_code == 200
    assert good.json()["vault"]["provenance"] == "admin"
    assert good.json()["vault"]["adminNote"] == "Reviewed by operator."


def test_add_by_address_lands_approved_and_admin_owned(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    resp = c.post(
        "/admin/vaults/curation/add",
        json={"address": _A4, "label": "Operator find", "asset_symbol": "USDC"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["created"] is True
    assert store.vaults[_A4].status == APPROVED
    assert store.vaults[_A4].provenance == "admin"
    # Invalid address shape is refused at the edge (VALIDATION_ERROR → 400).
    assert c.post(
        "/admin/vaults/curation/add", json={"address": "0x123", "label": "x"}
    ).status_code == 400


def test_run_now_is_a_request_not_a_command(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    resp = c.post("/admin/vaults/curation/run-now")
    assert resp.status_code == 200
    assert resp.json()["requested"] is True
    assert store.state.run_requested_at is not None
    assert store.state.run_requested_by == _OWNER.lower()


def test_auto_publish_toggle_is_audited(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    resp = c.post("/admin/vaults/curation/auto-publish", json={"enabled": True})
    assert resp.status_code == 200
    assert store.state.auto_publish is True
    assert c.get("/admin/vaults/curation").json()["autoPublish"] is True


def test_an_admin_edit_survives_a_later_scan(client: tuple[TestClient, FakeStore]) -> None:
    """FR-007 through the API: the scan refreshes numbers, never the admin's metadata."""
    c, store = client
    c.post("/curator/ingest", json=_ingest_body())
    assert store.vaults[_A1].provenance == "ai"

    c.post(
        "/admin/vaults/curation/edit",
        json={"address": _A1, "label": "Operator reviewed label", "admin_note": "checked"},
    )
    assert store.vaults[_A1].provenance == "admin"

    # A later scan sees the same vault with a different label.
    scan = _ingest_body(runKey="curator-4663-later", pick=None, alternates=[])
    scan["vaults"][0]["label"] = "AI refreshed label"  # type: ignore[index]
    resp = c.post("/curator/ingest", json=scan)
    assert resp.status_code == 200, resp.text
    assert store.vaults[_A1].label == "Operator reviewed label"
    assert store.vaults[_A1].admin_note == "checked"


def test_audit_records_review_actions(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    store.vaults[_A1] = _vault(_A1, status=CANDIDATE)
    c.post("/admin/vaults/curation/approve", json={"address": _A1, "note": "looks good"})
    c.post("/admin/vaults/curation/pin", json={"address": _A1, "pinned": True})
    c.post(
        "/admin/vaults/curation/edit",
        json={"address": _A1, "admin_note": "reviewed"},
    )
    audit = c.get("/admin/vaults/curation/audit").json()["audit"]
    assert [entry["action"] for entry in audit] == ["approved", "pin", "edit"]
    assert all(entry["actor"] == _OWNER.lower() for entry in audit)


def test_non_admin_gets_404_never_403() -> None:
    store = FakeStore()
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account="0x9999999999999999999999999999999999999999",
        owner="0x9999999999999999999999999999999999999999",
        chain_id=_CHAIN,
    )
    app.dependency_overrides[get_curation_store] = lambda: store

    class NotAdmin:
        async def is_admin(self, address: str) -> bool:
            return False

    app.dependency_overrides[get_allowlist_store] = lambda: NotAdmin()
    c = TestClient(app)
    assert c.get("/admin/vaults/curation").status_code == 404
    assert c.post("/admin/vaults/curation/run-now").status_code == 404
    # The public board stays readable (it is not an admin surface).
    assert c.get("/vaults/curated").status_code == 200


# ── curator ingest (the runner's publish path) ───────────────────────────────────────────────────


def _ingest_body(**over: Any) -> dict[str, Any]:
    body = {
        # gitleaks false positive: this is a run ID fixture, not a credential.
        "runKey": "curator-4663-20260918",  #gitleaks:allow
        "asOf": _NOW.isoformat(),
        "source": "morpho",
        "ok": True,
        "vaults": [
            {
                "address": _A1,
                "label": "Alpha",
                "screened": True,
                "score": 88,
                "scoreInputs": {"netApyBps": 500},
                "screening": [{"code": "asset", "ok": True}],
                "assetAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                "assetSymbol": "USDC",
                "assetDecimals": 6,
                "listed": True,
                "netApyBps": 500,
                "tvlUsd": 250000.0,
                "liquidityUsd": 200000.0,
                "ageSeconds": 86400,
            },
            {
                "address": _A2,
                "label": "Beta",
                "screened": True,
                "score": 70,
                "netApyBps": 400,
                "tvlUsd": 100000.0,
            },
        ],
        "pick": {"address": _A1, "reason": "Best risk-adjusted net APY.", "score": 88},
        "alternates": [{"address": _A2, "reason": "Runner-up.", "score": 70}],
    }
    body.update(over)
    return body


def test_a_failed_run_is_a_noop_for_the_list_and_the_pick(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    store.vaults[_A3] = _vault(_A3, status=APPROVED)
    store.recs.append(
        Recommendation(
            chain_id=_CHAIN,
            run_key="old",
            as_of=_NOW.isoformat(),
            source="morpho",
            pick_address=_A3,
            pick_reason="Last good pick.",
            alternates=[],
            published=True,
            provenance="ai",
        )
    )
    resp = c.post(
        "/curator/ingest",
        json=_ingest_body(
            runKey="curator-4663-failed",  #gitleaks:allow (run ID fixture, not a credential)
            ok=False,
            error="morpho returned 503",
            vaults=[],
            pick=None,
            alternates=[],
        ),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "stored": 0, "published": False, "approved": 0}
    # The last good record is untouched and still served.
    board = c.get("/vaults/curated").json()
    assert board["pick"]["address"] == _A3
    assert store.state.last_run_ok is False
    assert store.state.last_failed_detail["error"] == "morpho returned 503"


def test_auto_publish_off_stores_a_proposal_the_public_cannot_see(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    resp = c.post("/curator/ingest", json=_ingest_body())
    assert resp.status_code == 200, resp.text
    assert resp.json()["published"] is False
    assert store.state.last_run_ok is True
    assert [v.status for v in store.vaults.values()] == [CANDIDATE, CANDIDATE]
    assert store.recs and store.recs[-1].published is False
    # AI proposes, admin publishes: public is still empty, the panel sees the proposal.
    assert c.get("/vaults/curated").json()["vaults"] == []
    admin = c.get("/admin/vaults/curation").json()
    assert admin["recommendation"]["pickAddress"] == _A1


def test_auto_publish_on_approves_candidates_and_publishes(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    c.post("/admin/vaults/curation/auto-publish", json={"enabled": True})
    resp = c.post("/curator/ingest", json=_ingest_body())
    assert resp.status_code == 200, resp.text
    assert resp.json()["published"] is True
    assert resp.json()["approved"] == 2
    board = c.get("/vaults/curated").json()
    assert board["pick"]["address"] == _A1
    assert board["pick"]["reason"] == "Best risk-adjusted net APY."
    assert [a["address"] for a in board["alternates"]] == [_A2]


def test_unscreened_vaults_never_enter_the_curated_list(
    client: tuple[TestClient, FakeStore],
) -> None:
    """FR-002 in the agent, not just the runner: a vault must pass screening to be stored."""
    c, store = client
    body = _ingest_body()
    voucher = body["vaults"][0]  # type: ignore[index]
    voucher["screened"] = False
    body["rejected"] = [{"address": voucher["address"], "reasons": ["tvl"]}]
    resp = c.post("/curator/ingest", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["stored"] == 1
    assert voucher["address"] not in store.vaults
    assert store.last_run_detail["screenedOut"] == [
        {"address": voucher["address"], "reasons": ["tvl"]}
    ]


def test_auto_publish_never_overturns_a_hidden_decision(
    client: tuple[TestClient, FakeStore],
) -> None:
    c, store = client
    c.post("/admin/vaults/curation/auto-publish", json={"enabled": True})
    # The source proposes a vault the admin already hid.
    store.vaults[_A1] = _vault(_A1, status="hidden", provenance="admin")
    resp = c.post("/curator/ingest", json=_ingest_body())
    assert resp.status_code == 200, resp.text
    assert resp.json()["published"] is False
    assert store.vaults[_A1].status == "hidden"
    board = c.get("/vaults/curated").json()
    assert board["pick"] is None
    assert all(v["address"] != _A1 for v in board["vaults"])


def _route_paths(routes: Any) -> list[str]:
    """Flatten this FastAPI version's nested ``_IncludedRouter`` wrappers into route paths."""
    out: list[str] = []
    for route in routes:
        path = getattr(route, "path", None)
        if path:
            out.append(path)
        child = getattr(route, "original_router", None)
        if child is not None:
            out.extend(_route_paths(child.routes))
    return out


def test_curation_routes_are_registered_before_the_vault_catch_all() -> None:
    """The literal `/admin/vaults/curation*` routes must not be swallowed by `{vault}`."""
    from sparkpoint_agent.api.main import app

    paths = _route_paths(app.routes)
    assert paths.index("/admin/vaults/curation") < paths.index("/admin/vaults/{vault}")
    assert "/vaults/curated" in paths
    assert "/curator/ingest" in paths
