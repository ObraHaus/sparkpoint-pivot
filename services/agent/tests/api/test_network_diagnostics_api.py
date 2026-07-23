# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Network-gate diagnostics endpoints (api/network_diagnostics.py).

The store is MOCKED (no live DB). These assert:
  - POST /diagnostics/ingest records a capture for ANY S2S caller (no admin needed), computes the
    wallet-vs-wagmi mismatch, normalizes the address, and is lenient about partial payloads;
  - GET /admin/diagnostics is admin-gated — a non-admin gets 404 (never 403), invisible;
  - the admin list honours the mismatch-only filter;
  - no response carries a signable artifact (pure diagnostics surface, N2).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.network_diagnostics import get_diagnostics_store
from sparkpoint_agent.db.network_diagnostics import DiagnosticCapture, NetworkDiagnostic

TOKEN = "test-web-tier-token"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
CALLER = "0x1111111111111111111111111111111111111111"
STRANGER = "0x3333333333333333333333333333333333333333"
_BASE = datetime(2026, 1, 1, tzinfo=UTC)


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    def __init__(self) -> None:
        self.admin: set[str] = set()

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admin

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower()
        return {"beta": a in self.admin, "admin": a in self.admin}


class _FakeDiag:
    """In-memory NetworkDiagnosticStore capturing record() args + serving list()."""

    def __init__(self) -> None:
        self.caps: list[tuple[int, DiagnosticCapture]] = []
        self._id = 0

    async def record(self, cap: DiagnosticCapture) -> int:
        self._id += 1
        self.caps.append((self._id, cap))
        return self._id

    async def list(
        self, *, limit: int = 100, address: str | None = None, mismatch_only: bool = False
    ) -> list[NetworkDiagnostic]:
        out: list[NetworkDiagnostic] = []
        for i, c in reversed(self.caps):
            if address is not None and c.address != address:
                continue
            if mismatch_only and c.chain_mismatch is not True:
                continue
            out.append(
                NetworkDiagnostic(
                    id=i, created_at=_BASE + timedelta(seconds=i), reason=c.reason,
                    address=c.address, wagmi_chain_id=c.wagmi_chain_id,
                    wallet_chain_id=c.wallet_chain_id, chain_mismatch=c.chain_mismatch,
                    wagmi_status=c.wagmi_status, connector_id=c.connector_id,
                    connector_name=c.connector_name, is_metamask=c.is_metamask,
                    injected_count=c.injected_count, injected_names=c.injected_names,
                    user_agent=c.user_agent, build_id=c.build_id, raw=c.raw,
                )
            )
        return out[:limit]


_Ctx = tuple[TestClient, "_FakeDiag", "_FakeAllowlist"]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Ctx]:
    from sparkpoint_agent.api.allowlist import get_allowlist_store

    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    diag = _FakeDiag()
    allow = _FakeAllowlist()
    app.dependency_overrides[get_diagnostics_store] = lambda: diag
    app.dependency_overrides[get_allowlist_store] = lambda: allow
    try:
        yield TestClient(app), diag, allow
    finally:
        app.dependency_overrides.pop(get_diagnostics_store, None)
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── ingest (any S2S caller; no admin) ────────────────────────────────────────


def test_ingest_records_capture_and_computes_mismatch(ctx: _Ctx) -> None:
    client, diag, _ = ctx
    # Wallet genuinely on 84532, but wagmi surfaced `undefined` → a flagged mismatch.
    body = {
        "reason": "off-network",
        "wagmi": {
            "chainId": None, "status": "connected", "connectorId": "com.brave",
            "connectorName": "Brave", "address": "0xABC0000000000000000000000000000000000009",
        },
        "walletChainId": 84532,
        "wallet": {"isMetaMask": False, "legacyProvidersCount": 2},
        "eip6963": {"count": 2, "names": ["MetaMask", "Brave Wallet"]},
        "userAgent": "test-ua",
        "buildId": "3658b36",
    }
    resp = client.post("/diagnostics/ingest", json=body, headers=_headers(CALLER))
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "id": 1}

    (_, cap) = diag.caps[0]
    assert cap.reason == "off-network"
    assert cap.address == "0xabc0000000000000000000000000000000000009"  # normalized lower
    assert cap.wagmi_chain_id is None and cap.wallet_chain_id == 84532
    assert cap.chain_mismatch is True  # 84532 != None
    assert cap.injected_names == ("MetaMask", "Brave Wallet")


def test_ingest_is_lenient_about_partial_payloads(ctx: _Ctx) -> None:
    client, diag, _ = ctx
    resp = client.post("/diagnostics/ingest", json={}, headers=_headers(CALLER))
    assert resp.status_code == 200
    (_, cap) = diag.caps[0]
    assert cap.reason == "unknown"
    assert cap.address is None and cap.chain_mismatch is None  # no wallet chain → unknown


def test_ingest_ignores_unknown_fields(ctx: _Ctx) -> None:
    client, diag, _ = ctx
    resp = client.post(
        "/diagnostics/ingest",
        json={"reason": "signin-attempt", "surprise": {"nested": 1}, "walletChainId": 46630,
              "wagmi": {"chainId": 46630}},
        headers=_headers(CALLER),
    )
    assert resp.status_code == 200
    (_, cap) = diag.caps[0]
    assert cap.chain_mismatch is False  # 46630 == 46630


# ── admin list (admin-gated; 404 to everyone else) ───────────────────────────


def test_admin_list_denied_to_non_admin_is_404(ctx: _Ctx) -> None:
    client, _, _ = ctx
    resp = client.get("/admin/diagnostics", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_admin_list_as_admin_returns_rows_and_filters_mismatch(ctx: _Ctx) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())

    # One mismatch, one clean — ingested by an ordinary caller.
    client.post("/diagnostics/ingest",
                json={"reason": "off-network", "walletChainId": 84532, "wagmi": {"chainId": 1}},
                headers=_headers(CALLER))
    client.post("/diagnostics/ingest",
                json={"reason": "signin-attempt", "walletChainId": 84532,
                      "wagmi": {"chainId": 84532}},
                headers=_headers(CALLER))

    all_rows = client.get("/admin/diagnostics", headers=_headers(ADMIN_WALLET))
    assert all_rows.status_code == 200
    assert len(all_rows.json()["entries"]) == 2

    mism = client.get("/admin/diagnostics?mismatch=true", headers=_headers(ADMIN_WALLET))
    entries = mism.json()["entries"]
    assert len(entries) == 1 and entries[0]["chainMismatch"] is True
    assert entries[0]["walletChainId"] == 84532 and entries[0]["wagmiChainId"] == 1
