# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""049 — wrapper deploy requests + the deploy runner's queue, exercised THROUGH the app.

The load-bearing properties:

* an admin request queues work; a non-admin gets 404 (never 403);
* the runner sees ONLY pending work and can resolve a row exactly once (idempotent retries);
* a failure is recorded as loudly as a success (status `failed` + error) — a silent deploy runner
  must be impossible;
* the literal ``/admin/vaults/wrappers*`` routes are not swallowed by ``/admin/vaults/{vault}``.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.curated_vaults import get_curation_store
from sparkpoint_agent.api.errors import ApiError, api_error_handler, validation_error_handler
from sparkpoint_agent.api.mandate import get_account
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.wrapper_deployments import get_deployment_store, router
from sparkpoint_agent.db.wrapper_deployments import WrapperDeployment

_OWNER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
_CHAIN = 4663
_CHILD = "0x2222222222222222222222222222222222222222"


class FakeStore:
    """In-memory store mirroring the SQL semantics (requested-only resolution)."""

    def __init__(self) -> None:
        self.rows: dict[str, WrapperDeployment] = {}
        self._n = 0

    async def request(
        self,
        chain_id: int,
        *,
        child_address: str,
        fee_bps: int,
        per_user_cap: int,
        total_cap: int,
        vault_cap: int,
        name: str,
        symbol: str,
        label: str,
        actor: str | None,
    ) -> WrapperDeployment:
        self._n += 1
        row = WrapperDeployment(
            id=f"00000000-0000-4000-8000-{self._n:012d}",
            chain_id=chain_id,
            child_address=child_address.lower(),
            fee_bps=fee_bps,
            per_user_cap=per_user_cap,
            total_cap=total_cap,
            vault_cap=vault_cap,
            name=name,
            symbol=symbol,
            label=label,
            status="requested",
            requested_by=actor,
            requested_at="2026-09-18T12:00:00+00:00",
            tx_hash=None,
            proxy_address=None,
            cap_registry=None,
            error=None,
            reported_at=None,
            runner_commit=None,
        )
        self.rows[row.id] = row
        return row

    async def list_deployments(
        self, chain_id: int, *, status: str | None = None, limit: int = 100
    ) -> list[WrapperDeployment]:
        return [r for r in self.rows.values() if status is None or r.status == status][:limit]

    async def pending(self, chain_id: int, *, limit: int = 20) -> list[WrapperDeployment]:
        return [r for r in self.rows.values() if r.status == "requested"][:limit]

    async def get(self, chain_id: int, deployment_id: str) -> WrapperDeployment | None:
        return self.rows.get(deployment_id)

    async def report(
        self,
        chain_id: int,
        *,
        deployment_id: str,
        ok: bool,
        tx_hash: str | None,
        proxy_address: str | None,
        cap_registry: str | None,
        error: str | None,
        runner_commit: str | None,
    ) -> bool:
        row = self.rows.get(deployment_id)
        if row is None or row.status != "requested":
            return False
        self.rows[deployment_id] = replace(
            row,
            status="deployed" if ok else "failed",
            tx_hash=tx_hash,
            proxy_address=proxy_address,
            cap_registry=cap_registry,
            error=error,
            runner_commit=runner_commit,
            reported_at="2026-09-18T12:05:00+00:00",
        )
        return True

    async def cancel(self, chain_id: int, *, deployment_id: str, actor: str | None) -> bool:
        row = self.rows.get(deployment_id)
        if row is None or row.status != "requested":
            return False
        self.rows[deployment_id] = replace(row, status="cancelled")
        return True


class FakeCuration:
    """In-memory curation store: records the T501 wrapped-row updates from deploy reports."""

    def __init__(self) -> None:
        self.wrapped: dict[tuple[int, str], str] = {}
        self.calls = 0

    async def set_wrapper(self, chain_id: int, *, child_address: str, wrapper_address: str) -> bool:
        self.calls += 1
        self.wrapped[(chain_id, child_address.lower())] = wrapper_address.lower()
        return True


@pytest.fixture
def client() -> tuple[TestClient, FakeStore, FakeCuration]:
    store = FakeStore()
    curation = FakeCuration()
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=_OWNER, owner=_OWNER, chain_id=_CHAIN
    )
    app.dependency_overrides[get_deployment_store] = lambda: store

    class FakeAllowlist:
        async def is_admin(self, address: str) -> bool:
            return address.lower() == _OWNER.lower()

    app.dependency_overrides[get_allowlist_store] = lambda: FakeAllowlist()
    app.dependency_overrides[get_curation_store] = lambda: curation
    return TestClient(app), store, curation


def _request_body(**over: Any) -> dict[str, Any]:
    body = {
        "childAddress": _CHILD,
        "feeBps": 1000,
        "perUserCap": 1_000_000_000,
        "totalCap": 100_000_000_000,
        "vaultCap": 100_000_000_000,
        "name": "SparkPoint Universal USDC",
        "symbol": "spuUSDC",
        "label": "First curated wrapper",
    }
    body.update(over)
    return body


def test_admin_request_queues_work_and_shows_in_the_list(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, store, curation = client
    resp = c.post("/admin/vaults/wrappers/request", json=_request_body())
    assert resp.status_code == 200, resp.text
    created = resp.json()["deployment"]
    assert created["status"] == "requested"
    assert created["childAddress"] == _CHILD  # normalized lowercase
    assert created["perUserCap"] == "1000000000"  # wire uses strings for uint256

    listing = c.get("/admin/vaults/wrappers").json()
    assert listing["pending"] == 1
    assert listing["deployments"][0]["id"] == created["id"]


def test_request_rejects_malformed_input(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    bad_addr = c.post("/admin/vaults/wrappers/request", json=_request_body(childAddress="0x123"))
    assert bad_addr.status_code == 400
    bad_fee = c.post("/admin/vaults/wrappers/request", json=_request_body(feeBps=2001))
    assert bad_fee.status_code == 400
    empty = c.post("/admin/vaults/wrappers/request", json=_request_body(name=""))
    assert empty.status_code == 400


def test_runner_sees_only_pending_and_resolves_once(client: tuple[TestClient, FakeStore]) -> None:
    c, store, curation = client
    first = c.post("/admin/vaults/wrappers/request", json=_request_body()).json()["deployment"]
    c.post("/admin/vaults/wrappers/request", json=_request_body(label="second"))

    jobs = c.get("/curator/wrapper-jobs").json()["jobs"]
    assert len(jobs) == 2

    report = {
        "id": first["id"],
        "ok": True,
        "txHash": "0x" + "ab" * 32,
        "proxyAddress": "0x" + "11" * 20,
        "capRegistry": "0x" + "22" * 20,
        "runnerCommit": "deadbee",
    }
    resp = c.post("/curator/wrapper-jobs/report", json=report)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "updated": True, "status": "deployed"}

    # Idempotent retry: the row is already resolved, so the runner learns it was a no-op.
    again = c.post("/curator/wrapper-jobs/report", json=report)
    assert again.json() == {"ok": True, "updated": False, "status": "deployed"}

    # Only the still-pending request remains in the queue.
    jobs = c.get("/curator/wrapper-jobs").json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["id"] != first["id"]


def test_a_failed_report_is_recorded_loudly(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, store, curation = client
    row = c.post("/admin/vaults/wrappers/request", json=_request_body()).json()["deployment"]
    resp = c.post(
        "/curator/wrapper-jobs/report",
        json={"id": row["id"], "ok": False, "error": "createVault reverted: NotAllowlisted"},
    )
    assert resp.json() == {"ok": True, "updated": True, "status": "failed"}
    stored = store.rows[row["id"]]
    assert stored.status == "failed"
    assert "NotAllowlisted" in (stored.error or "")


def test_report_for_an_unknown_id_is_404(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    resp = c.post(
        "/curator/wrapper-jobs/report",
        json={"id": "11111111-1111-4111-8111-111111111111", "ok": True},
    )
    assert resp.status_code == 404


def test_cancel_only_works_while_pending(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    row = c.post("/admin/vaults/wrappers/request", json=_request_body()).json()["deployment"]
    assert c.post("/admin/vaults/wrappers/cancel", json={"id": row["id"]}).status_code == 200
    assert c.post("/admin/vaults/wrappers/cancel", json={"id": row["id"]}).status_code == 404
    assert c.get("/curator/wrapper-jobs").json()["jobs"] == []


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
    app.dependency_overrides[get_deployment_store] = lambda: store

    class NotAdmin:
        async def is_admin(self, address: str) -> bool:
            return False

    app.dependency_overrides[get_allowlist_store] = lambda: NotAdmin()
    app.dependency_overrides[get_curation_store] = lambda: FakeCuration()
    c = TestClient(app)
    assert c.get("/admin/vaults/wrappers").status_code == 404
    assert c.post("/admin/vaults/wrappers/request", json=_request_body()).status_code == 404
    # ⚠️ The machine routes are admin/service-gated too: the BFF reaches them for EVERY alpha
    # session, so a non-admin must not be able to poll the queue or forge a report.
    assert c.get("/curator/wrapper-jobs").status_code == 404
    assert c.post("/curator/wrapper-jobs/report", json={"id": "x", "ok": True}).status_code == 404


def _route_paths(routes: Any) -> list[str]:
    out: list[str] = []
    for route in routes:
        path = getattr(route, "path", None)
        if path:
            out.append(path)
        child = getattr(route, "original_router", None)
        if child is not None:
            out.extend(_route_paths(child.routes))
    return out


def test_wrapper_routes_are_registered_before_the_vault_catch_all() -> None:
    from sparkpoint_agent.api.main import app

    paths = _route_paths(app.routes)
    assert paths.index("/admin/vaults/wrappers") < paths.index("/admin/vaults/{vault}")
    assert "/curator/wrapper-jobs" in paths


def test_successful_report_flips_the_curated_row_to_wrapped(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    """T501 — the verified deploy fact must reach the board's data, and only on success."""
    c, _store, curation = client
    row = c.post("/admin/vaults/wrappers/request", json=_request_body()).json()["deployment"]
    proxy = "0x" + "11" * 20

    ok = c.post(
        "/curator/wrapper-jobs/report",
        json={"id": row["id"], "ok": True, "txHash": "0x" + "ab" * 32, "proxyAddress": proxy},
    )
    assert ok.status_code == 200, ok.text
    assert curation.wrapped[(_CHAIN, _CHILD)] == proxy.lower()
    assert curation.calls == 1

    # An idempotent retry is a no-op: the deployment row is resolved and the row must not be
    # written twice (a rewrite could mask a different later deployment).
    again = c.post(
        "/curator/wrapper-jobs/report",
        json={"id": row["id"], "ok": True, "proxyAddress": "0x" + "99" * 20},
    )
    assert again.json()["updated"] is False
    assert curation.calls == 1


def test_failed_report_leaves_the_curated_row_unwrapped(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _store, curation = client
    row = c.post("/admin/vaults/wrappers/request", json=_request_body()).json()["deployment"]
    resp = c.post(
        "/curator/wrapper-jobs/report",
        json={"id": row["id"], "ok": False, "error": "createVault reverted: NotAllowlisted"},
    )
    assert resp.json()["status"] == "failed"
    assert curation.calls == 0
    assert curation.wrapped == {}
