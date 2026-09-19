# ruff: noqa: S101
"""049 v4.1.0 — the admission queue (admin) + the AI runner's candidate/report surface.

Load-bearing properties: candidates are the approved+unwrapped curated rows with deterministic
params; the runner's whitelist report mirrors `by`/`readyAt`; a successful deploy flips the
curated row and removes the candidate; a failure is as loud as a success; the admin's instant lane
records `by = admin, readyAt = 0`; and a non-admin gets 404 (never 403).
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
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
from sparkpoint_agent.api.wrapper_whitelist import get_whitelist_store, router
from sparkpoint_agent.db.wrapper_whitelist import (
    DEPLOYED,
    PENDING,
    WrapperWhitelistEntry,
)

_OWNER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
_AI = "0xb555dbec2cc5908c8b245ed84cb038d5d205d875"
_CHILD = "0x2222222222222222222222222222222222222222"
_CHAIN = 4663


def _entry(**over: Any) -> WrapperWhitelistEntry:
    base: dict[str, Any] = {
        "id": "11111111-1111-4111-8111-111111111111",
        "chain_id": _CHAIN,
        "child_address": _CHILD,
        "by_address": None,
        "ready_at": 0,
        "fee_bps": 1000,
        "per_user_cap": 5_000_000_000,
        "total_cap": 1_000_000_000_000,
        "vault_cap": 1_000_000_000_000,
        "name": "Steakhouse USDG",
        "symbol": "spUSDG",
        "label": "Steakhouse USDG · SparkPoint wrapper",
        "status": PENDING,
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
    base.update(over)
    return WrapperWhitelistEntry(**base)


class FakeStore:
    def __init__(self) -> None:
        self.rows: list[WrapperWhitelistEntry] = []
        self._n = 0

    async def list_entries(
        self, chain_id: int, *, limit: int = 200
    ) -> list[WrapperWhitelistEntry]:
        return list(reversed(self.rows))[:limit]

    async def latest_by_child(self, chain_id: int) -> dict[str, WrapperWhitelistEntry]:
        return {row.child_address: row for row in self.rows}

    async def get_latest(self, chain_id: int, child_address: str) -> WrapperWhitelistEntry | None:
        return next(
            (r for r in reversed(self.rows) if r.child_address == child_address.lower()), None
        )

    async def record_whitelist(self, chain_id: int, **kw: Any) -> WrapperWhitelistEntry:
        existing = await self.get_latest(chain_id, kw["child_address"])
        if existing is not None and existing.status == PENDING:
            row = replace(
                existing,
                by_address=kw["by_address"] or existing.by_address,
                ready_at=kw["ready_at"],
                fee_bps=kw["fee_bps"],
                name=kw["name"],
                symbol=kw["symbol"],
                label=kw["label"],
                tx_hash=kw["tx_hash"],
                recorded_by=kw["actor"] or existing.recorded_by,
            )
            self.rows[self.rows.index(existing)] = row
            return row
        self._n += 1
        row = _entry(
            id=f"00000000-0000-4000-8000-{self._n:012d}",
            child_address=kw["child_address"].lower(),
            by_address=kw["by_address"].lower() if kw["by_address"] else None,
            ready_at=kw["ready_at"],
            fee_bps=kw["fee_bps"],
            per_user_cap=kw["per_user_cap"],
            total_cap=kw["total_cap"],
            vault_cap=kw["vault_cap"],
            name=kw["name"],
            symbol=kw["symbol"],
            label=kw["label"],
            tx_hash=kw["tx_hash"],
            recorded_by=kw["actor"],
        )
        self.rows.append(row)
        return row

    async def _resolve(
        self, chain_id: int, child: str, **over: Any
    ) -> WrapperWhitelistEntry | None:
        row = await self.get_latest(chain_id, child)
        if row is None or row.status != PENDING:
            return None
        updated = replace(row, **over)
        self.rows[self.rows.index(row)] = updated
        return updated

    async def record_deploy(self, chain_id: int, **kw: Any) -> WrapperWhitelistEntry | None:
        return await self._resolve(
            chain_id,
            kw["child_address"],
            status=DEPLOYED,
            tx_hash=kw["tx_hash"],
            proxy_address=kw["proxy_address"],
        )

    async def record_cancel(self, chain_id: int, **kw: Any) -> WrapperWhitelistEntry | None:
        return await self._resolve(chain_id, kw["child_address"], status="cancelled")

    async def record_failure(self, chain_id: int, **kw: Any) -> WrapperWhitelistEntry | None:
        return await self._resolve(
            chain_id, kw["child_address"], status="failed", error=kw["error"]
        )


class FakeCuration:
    def __init__(self, vaults: list[SimpleNamespace]) -> None:
        self.vaults = vaults
        self.wrapped: dict[str, str] = {}

    async def list_vaults(
        self, chain_id: int, *, statuses: tuple[str, ...] | None = None
    ) -> list[SimpleNamespace]:
        return [v for v in self.vaults if statuses is None or v.status in statuses]

    async def get_vault(self, chain_id: int, address: str) -> SimpleNamespace | None:
        return next((v for v in self.vaults if v.vault_address == address.lower()), None)

    async def set_wrapper(
        self, chain_id: int, *, child_address: str, wrapper_address: str
    ) -> bool:
        self.wrapped[child_address.lower()] = wrapper_address.lower()
        for vault in self.vaults:
            if vault.vault_address == child_address.lower():
                vault.wrapped = True
                vault.wrapper_address = wrapper_address.lower()
        return True


def _vault(**over: Any) -> SimpleNamespace:
    base = {
        "vault_address": _CHILD,
        "label": "Steakhouse USDG",
        "asset_symbol": "USDG",
        "asset_decimals": 6,
        "wrapped": False,
        "vendor": None,
        "status": "approved",
    }
    base.update(over)
    return SimpleNamespace(**base)


def _client(vaults: list[SimpleNamespace]) -> tuple[TestClient, FakeStore, FakeCuration]:
    store, curation = FakeStore(), FakeCuration(vaults)
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=_OWNER, owner=_OWNER, chain_id=_CHAIN
    )
    app.dependency_overrides[get_whitelist_store] = lambda: store
    app.dependency_overrides[get_curation_store] = lambda: curation

    class FakeAllowlist:
        async def is_admin(self, address: str) -> bool:
            return address.lower() == _OWNER.lower()

    app.dependency_overrides[get_allowlist_store] = lambda: FakeAllowlist()
    return TestClient(app), store, curation


@pytest.fixture
def client() -> tuple[TestClient, FakeStore, FakeCuration]:
    return _client([_vault()])


def test_candidates_offer_approved_unwrapped_vaults_with_defaults(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    body = c.get("/curator/wrapper-whitelist").json()
    assert len(body["candidates"]) == 1
    candidate = body["candidates"][0]
    assert candidate["childAddress"] == _CHILD
    assert candidate["feeBps"] == 1000
    assert candidate["perUserCap"] == "5000000000"
    assert candidate["name"] == "Steakhouse USDG"
    assert candidate["symbol"] == "spUSDG"
    assert candidate["status"] == "none"


def test_wrapped_vaults_are_not_offered() -> None:
    c, _, _ = _client([_vault(wrapped=True, wrapper_address="0x" + "44" * 20)])
    assert c.get("/curator/wrapper-whitelist").json()["candidates"] == []


def test_runner_whitelist_report_mirrors_by_and_ready_at(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, store, _ = client
    resp = c.post(
        "/curator/wrapper-whitelist/report",
        json={
            "childAddress": _CHILD,
            "action": "whitelist",
            "ok": True,
            "txHash": "0x" + "ab" * 32,
            "byAddress": _AI,
            "readyAt": 1_700_086_400,
            "runnerCommit": "deadbee",
        },
    )
    assert resp.status_code == 200, resp.text
    entry = resp.json()["entry"]
    assert entry["status"] == PENDING
    assert entry["byAddress"] == _AI  # normalized lowercase
    assert entry["readyAt"] == 1_700_086_400

    candidate = c.get("/curator/wrapper-whitelist").json()["candidates"][0]
    assert candidate["status"] == PENDING
    assert candidate["byAddress"] == _AI


def test_runner_deploy_report_flips_curated_and_removes_the_candidate(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, curation = client
    c.post(
        "/curator/wrapper-whitelist/report",
        json={"childAddress": _CHILD, "action": "whitelist", "ok": True, "byAddress": _AI},
    )
    proxy = "0x" + "44" * 20
    resp = c.post(
        "/curator/wrapper-whitelist/report",
        json={
            "childAddress": _CHILD,
            "action": "deploy",
            "ok": True,
            "txHash": "0x" + "cd" * 32,
            "proxyAddress": proxy,
        },
    )
    assert resp.json()["status"] == "deployed"
    assert curation.wrapped[_CHILD] == proxy
    assert c.get("/curator/wrapper-whitelist").json()["candidates"] == []


def test_runner_failure_is_recorded_loudly(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, store, _ = client
    c.post(
        "/curator/wrapper-whitelist/report",
        json={"childAddress": _CHILD, "action": "whitelist", "ok": True, "byAddress": _AI},
    )
    resp = c.post(
        "/curator/wrapper-whitelist/report",
        json={
            "childAddress": _CHILD,
            "action": "deploy",
            "ok": False,
            "error": "createVault reverted: CooldownNotElapsed",
        },
    )
    assert resp.json()["status"] == "failed"
    assert store.rows[-1].status == "failed"
    assert "CooldownNotElapsed" in (store.rows[-1].error or "")


def test_admin_instant_whitelist_records_admin_and_ready_now(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    resp = c.post(
        "/admin/vaults/whitelist/record",
        json={"childAddress": _CHILD, "action": "whitelist", "txHash": "0x" + "ef" * 32},
    )
    assert resp.status_code == 200, resp.text
    entry = resp.json()["entry"]
    assert entry["byAddress"] == _OWNER.lower()
    assert entry["readyAt"] == 0
    assert entry["ready"] is True
    assert entry["status"] == PENDING


def test_admin_unwhitelist_cancels_only_a_pending_entry(
    client: tuple[TestClient, FakeStore, FakeCuration],
) -> None:
    c, _, _ = client
    c.post("/admin/vaults/whitelist/record", json={"childAddress": _CHILD, "action": "whitelist"})
    first = c.post(
        "/admin/vaults/whitelist/record", json={"childAddress": _CHILD, "action": "unwhitelist"}
    )
    assert first.status_code == 200
    assert first.json()["entry"]["status"] == "cancelled"
    second = c.post(
        "/admin/vaults/whitelist/record", json={"childAddress": _CHILD, "action": "unwhitelist"}
    )
    assert second.status_code == 404


def test_malformed_input_is_rejected(client: tuple[TestClient, FakeStore, FakeCuration]) -> None:
    c, _, _ = client
    assert (
        c.post(
            "/admin/vaults/whitelist/record",
            json={"childAddress": "0x123", "action": "whitelist"},
        ).status_code
        == 400
    )
    assert (
        c.post(
            "/admin/vaults/whitelist/record",
            json={"childAddress": _CHILD, "action": "explode"},
        ).status_code
        == 400
    )


def test_non_admin_gets_404_on_every_surface() -> None:
    store, curation = FakeStore(), FakeCuration([_vault()])
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    stranger = "0x9999999999999999999999999999999999999999"
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=stranger, owner=stranger, chain_id=_CHAIN
    )
    app.dependency_overrides[get_whitelist_store] = lambda: store
    app.dependency_overrides[get_curation_store] = lambda: curation

    class FakeAllowlist:
        async def is_admin(self, address: str) -> bool:
            return False

    app.dependency_overrides[get_allowlist_store] = lambda: FakeAllowlist()
    c = TestClient(app)
    assert c.get("/admin/vaults/whitelist").status_code == 404
    assert c.get("/curator/wrapper-whitelist").status_code == 404
    assert (
        c.post(
            "/admin/vaults/whitelist/record",
            json={"childAddress": _CHILD, "action": "whitelist"},
        ).status_code
        == 404
    )


def _route_paths(routes: list[Any]) -> list[str]:
    """Flatten the real app's routes (mirrors tests/api/test_wrapper_deployments.py)."""
    out: list[str] = []
    for route in routes:
        path = getattr(route, "path", None)
        if path:
            out.append(path)
        child = getattr(route, "original_router", None)
        if child is not None:
            out.extend(_route_paths(child.routes))
    return out


def test_literal_routes_are_registered_before_the_admin_vault_catchall() -> None:
    from sparkpoint_agent.api.main import app  # imported late: builds the real app

    paths = _route_paths(app.routes)
    assert "/admin/vaults/whitelist" in paths
    assert paths.index("/admin/vaults/whitelist") < paths.index("/admin/vaults/{vault}")
    assert "/curator/wrapper-whitelist" in paths
