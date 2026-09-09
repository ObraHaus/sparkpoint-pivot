# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§B allowlist endpoints (api/allowlist.py) — login status check + admin-gated management.

The allowlist store is MOCKED (no live DB). These assert the access-gate contract through the
app + middleware:

  - GET /allowlist/status returns the caller-scoped wallet's {beta, admin} (admin ⇒ beta);
  - admin routes are gated on the caller's X-Owner holding the ``admin`` role;
  - a NON-admin gets 404 (never 403) on every /admin/allowlist route (must not learn it exists);
  - add/remove are audit-logged; the last admin cannot be removed;
  - no response here ever carries a signable artifact (pure access gate, N2).
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.db.allowlist import parse_allowlist_env

TOKEN = "test-web-tier-token"
BETA_WALLET = "0x1111111111111111111111111111111111111111"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    """In-memory AllowlistStore mirroring the real semantics (lowercase, admin ⇒ beta, audit)."""

    def __init__(self) -> None:
        self.beta: set[str] = set()
        self.admin: set[str] = set()
        self.audit: list[tuple[str, str, str, str | None]] = []

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower()
        is_admin = a in self.admin
        return {"beta": is_admin or a in self.beta, "admin": is_admin}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admin

    async def list_role(self, role: str) -> list[str]:
        return sorted(self.admin if role == "admin" else self.beta)

    async def add(self, address: str, role: str, *, actor: str | None) -> None:
        (self.admin if role == "admin" else self.beta).add(address.lower())
        self.audit.append(("add", address.lower(), role, (actor or "").lower() or None))

    async def remove(self, address: str, role: str, *, actor: str | None) -> None:
        (self.admin if role == "admin" else self.beta).discard(address.lower())
        self.audit.append(("remove", address.lower(), role, (actor or "").lower() or None))

    async def recent_audit(self, limit: int = 50) -> list[dict[str, object]]:
        return [
            {"action": a, "address": ad, "role": r, "actor": ac, "at": "2026-01-01T00:00:00+00:00"}
            for (a, ad, r, ac) in reversed(self.audit)
        ][:limit]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, _FakeAllowlist]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    store = _FakeAllowlist()
    app.dependency_overrides[get_allowlist_store] = lambda: store
    try:
        yield TestClient(app), store
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── GET /allowlist/status (login check; not admin-gated) ──────────────────────


def test_status_unknown_wallet_is_fail_closed(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, _ = ctx
    resp = client.get("/allowlist/status", headers=_headers(STRANGER))
    assert resp.status_code == 200
    assert resp.json() == {"beta": False, "admin": False}


def test_status_beta_wallet(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.beta.add(BETA_WALLET.lower())
    resp = client.get("/allowlist/status", headers=_headers(BETA_WALLET))
    assert resp.json() == {"beta": True, "admin": False}


def test_status_admin_implies_beta(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())
    resp = client.get("/allowlist/status", headers=_headers(ADMIN_WALLET))
    assert resp.json() == {"beta": True, "admin": True}


def test_status_is_case_insensitive(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())
    # Header carries the checksummed (mixed-case) address; status still resolves.
    mixed = ADMIN_WALLET.upper().replace("0X", "0x")
    resp = client.get("/allowlist/status", headers=_headers(mixed))
    assert resp.json()["admin"] is True


# ── admin gate: non-admin gets 404, not 403, everywhere ───────────────────────


def test_admin_list_denied_to_non_admin_is_404(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, _ = ctx
    resp = client.get("/admin/allowlist?role=beta", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_admin_add_denied_to_non_admin_is_404(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, _ = ctx
    resp = client.post(
        "/admin/allowlist",
        json={"address": BETA_WALLET, "role": "beta"},
        headers=_headers(STRANGER),
    )
    assert resp.status_code == 404


def test_admin_audit_denied_to_non_admin_is_404(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, _ = ctx
    resp = client.get("/admin/allowlist/audit", headers=_headers(STRANGER))
    assert resp.status_code == 404


# ── admin management (as an admin) ────────────────────────────────────────────


def test_admin_add_then_list_and_audit(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())  # the caller is an admin
    add = client.post(
        "/admin/allowlist",
        json={"address": BETA_WALLET, "role": "beta"},
        headers=_headers(ADMIN_WALLET),
    )
    assert add.status_code == 201
    assert add.json() == {"ok": True, "address": BETA_WALLET.lower(), "role": "beta"}

    listing = client.get("/admin/allowlist?role=beta", headers=_headers(ADMIN_WALLET))
    assert listing.status_code == 200
    assert listing.json() == {"role": "beta", "addresses": [BETA_WALLET.lower()]}

    audit = client.get("/admin/allowlist/audit", headers=_headers(ADMIN_WALLET))
    entries = audit.json()["entries"]
    assert entries and entries[0]["action"] == "add"
    assert entries[0]["actor"] == ADMIN_WALLET.lower()  # the caller is recorded


def test_admin_remove_beta(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())
    store.beta.add(BETA_WALLET.lower())
    resp = client.delete(f"/admin/allowlist/beta/{BETA_WALLET}", headers=_headers(ADMIN_WALLET))
    assert resp.status_code == 200
    assert BETA_WALLET.lower() not in store.beta


def test_admin_remove_beta_via_post(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    # The web console reaches removal through the GET/POST-only BFF, so it POSTs to …/{role}/delete.
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())
    store.beta.add(BETA_WALLET.lower())
    resp = client.post(
        "/admin/allowlist/beta/delete",
        headers=_headers(ADMIN_WALLET),
        json={"address": BETA_WALLET},
    )
    assert resp.status_code == 200
    assert BETA_WALLET.lower() not in store.beta


def test_post_remove_honours_last_admin_guardrail(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())  # the ONLY admin
    resp = client.post(
        "/admin/allowlist/admin/delete",
        headers=_headers(ADMIN_WALLET),
        json={"address": ADMIN_WALLET},
    )
    assert resp.status_code == 400
    assert ADMIN_WALLET.lower() in store.admin  # guardrail held on the POST path too


def test_cannot_remove_last_admin(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())  # the ONLY admin
    resp = client.delete(f"/admin/allowlist/admin/{ADMIN_WALLET}", headers=_headers(ADMIN_WALLET))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert ADMIN_WALLET.lower() in store.admin  # still there


def test_can_remove_admin_when_another_remains(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    other = "0x4444444444444444444444444444444444444444"
    store.admin.update({ADMIN_WALLET.lower(), other})
    resp = client.delete(f"/admin/allowlist/admin/{other}", headers=_headers(ADMIN_WALLET))
    assert resp.status_code == 200
    assert other not in store.admin


def test_add_rejects_malformed_address(ctx: tuple[TestClient, _FakeAllowlist]) -> None:
    client, store = ctx
    store.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/allowlist", json={"address": "nope", "role": "beta"}, headers=_headers(ADMIN_WALLET)
    )
    assert resp.status_code == 400


def test_admin_routes_require_s2s_auth() -> None:
    # No monkeypatched token → fail-closed before the handler runs.
    client = TestClient(app)
    resp = client.get("/admin/allowlist?role=beta")
    assert resp.status_code in (401, 400)


# ── parse_allowlist_env (pure) ────────────────────────────────────────────────


def test_parse_allowlist_env() -> None:
    assert parse_allowlist_env(None) == []
    assert parse_allowlist_env("") == []
    assert parse_allowlist_env("  ") == []
    assert parse_allowlist_env(f"{BETA_WALLET}, {ADMIN_WALLET} ,") == [BETA_WALLET, ADMIN_WALLET]
