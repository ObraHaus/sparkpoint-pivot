"""024/T032-T033 — GET /admin/vault-registry: advisory, all-chains, and FAIL-OPEN.

Two properties matter more than the happy path:

  * It must not 500 when migration 0026 is unapplied. 0026 is additive and NOT applied on develop,
    so an unmigrated database is the expected state, not an error state. The endpoint reports
    ``available: false`` with a reason and empty rows — never invented rows, never a 500.
  * It must be mounted somewhere ``GET /admin/vaults/{vault}`` cannot shadow. FastAPI matches routes
    in registration order, so ``/admin/vaults/registry`` would have been swallowed by the catch-all
    path param and silently become a lookup for a vault named "registry".

It is also admin-gated by the repo's invisible-admin convention: a non-admin gets 404, not 403.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import admin_vaults
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.chain.vault_resolution import VAULT_REGISTRY_ENABLED_ENV

TOKEN = "s2s-test-token"  # noqa: S105 - a test fixture, not a credential
ADMIN = "0x00000000000000000000000000000000000ad301"
NOT_ADMIN = "0x00000000000000000000000000000000000b0b00"
LAUNCH_VAULT = "0x15d269b1d4fb3581e5a47482a70215e63ed547f2"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    def __init__(self, admins: set[str]) -> None:
        self._admins = {a.lower() for a in admins}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self._admins


class _FakeRegistryStore:
    """Structural ``VaultRegistryStore`` stand-in. ``raises=True`` models an unapplied 0026."""

    def __init__(self, *, raises: bool = False) -> None:
        self._raises = raises

    async def list_vaults(self, chain_id: int | None = None) -> list[dict[str, Any]]:
        if self._raises:
            raise RuntimeError('relation "vault_registry" does not exist')
        return [
            {
                "chain_id": 84532,
                "vault_address": LAUNCH_VAULT,
                "kind": "first_party",
                "status": "live",
            },
            {"chain_id": 8453, "vault_address": "0xdead", "kind": "fee_wrapper", "status": "live"},
        ]

    async def list_allowlist(self, chain_id: int) -> list[dict[str, Any]]:
        if self._raises:
            raise RuntimeError('relation "vault_allowlist" does not exist')
        return [{"candidate_address": "0xbeef", "status": "rejected", "gates_abdicated": False}]

    async def latest_apy(self, chain_id: int) -> list[dict[str, Any]]:
        if self._raises:
            raise RuntimeError('relation "vault_apy_snapshots" does not exist')
        # Base Sepolia is honestly "unavailable" — Morpho's API supports no testnet.
        return [{"vault_address": LAUNCH_VAULT, "source": "unavailable", "net_apy_bps": None}]


def _client(store: _FakeRegistryStore, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    app.dependency_overrides[admin_vaults.get_vault_registry_store] = lambda: store
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from _client(_FakeRegistryStore(), monkeypatch)


@pytest.fixture
def unmigrated_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from _client(_FakeRegistryStore(raises=True), monkeypatch)


# ── the route is reachable, i.e. NOT shadowed by /admin/vaults/{vault} ────────


def test_registry_route_is_not_shadowed_by_the_catch_all_vault_route(client: TestClient) -> None:
    r = client.get("/admin/vault-registry", headers=_headers(ADMIN))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    # A `{vault}` lookup would have returned a single row or 404, never these collections.
    assert {"vaults", "allowlist", "apySnapshots"} <= body.keys()


def test_it_lists_every_chain_not_just_the_header_chain(client: TestClient) -> None:
    """The registry is the multi-chain view — that is the whole reason it exists."""
    rows = client.get("/admin/vault-registry", headers=_headers(ADMIN)).json()["vaults"]
    assert {r["chain_id"] for r in rows} == {84532, 8453}


# ── FAIL-OPEN on an unapplied 0026 ───────────────────────────────────────────


def test_unapplied_migration_returns_available_false_not_a_500(
    unmigrated_client: TestClient,
) -> None:
    r = unmigrated_client.get("/admin/vault-registry", headers=_headers(ADMIN))
    assert r.status_code == 200, "an unapplied 0026 is an expected state, not a server error"
    body = r.json()
    assert body["available"] is False
    assert body["vaults"] == [] and body["allowlist"] == [] and body["apySnapshots"] == []
    assert "0026" in body["reason"], "the reason must point the operator at the actual cause"


# ── the flag is surfaced, so rows-exist ≠ rows-are-load-bearing ───────────────


def test_resolution_flag_is_reported_off_by_default(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(VAULT_REGISTRY_ENABLED_ENV, raising=False)
    body = client.get("/admin/vault-registry", headers=_headers(ADMIN)).json()
    assert body["resolutionEnabled"] is False, (
        "rows can exist while the service still resolves from SPARKPOINT_VAULT_ADDRESS; "
        "the operator must be able to see which"
    )


def test_resolution_flag_is_reported_on_when_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    body = client.get("/admin/vault-registry", headers=_headers(ADMIN)).json()
    assert body["resolutionEnabled"] is True


# ── admin gating (invisible admin: 404, never 403) ────────────────────────────


def test_non_admin_gets_404_not_403(client: TestClient) -> None:
    r = client.get("/admin/vault-registry", headers=_headers(NOT_ADMIN))
    assert r.status_code == 404


def test_apy_unavailable_is_passed_through_as_null_never_zero(client: TestClient) -> None:
    """Principle III: on a chain no APY source covers, the honest value is null, not 0."""
    snaps = client.get("/admin/vault-registry", headers=_headers(ADMIN)).json()["apySnapshots"]
    assert snaps[0]["source"] == "unavailable"
    assert snaps[0]["net_apy_bps"] is None
