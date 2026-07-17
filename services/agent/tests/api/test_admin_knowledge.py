# ruff: noqa: S101, S105, S106  (pytest asserts; tokens are test fixtures)
"""§R2 admin Obsidian console (api/admin_knowledge.py) — admin-gated + fail-closed writes.

Every assertion here reaches its verdict BEFORE any DB access, so no live Postgres is needed:
  * a non-admin is 404'd by ``require_admin`` (invisible admin surface);
  * a PII/secret-shaped note is 422'd by ``scan_for_pii`` BEFORE embedding or persistence;
  * an unconfigured embedder is 503'd (never the stub — writing stub vectors would poison the space)
    BEFORE the ingest/store call.
The precedence guarantee (a seed re-ingest can't clobber an admin-edited note) is covered at the
``ingest_directory(skip_sources=...)`` seam in tests/knowledge/test_knowledge_precedence.py.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"


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

    async def status(self, address: str) -> dict[str, bool]:
        is_admin = address.lower() in self._admins
        return {"beta": is_admin, "admin": is_admin}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self._admins


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    # No embedder configured → put/reingest must 503, never fall back to the stub.
    monkeypatch.delenv("EMBEDDING_OPENAI_API_URL", raising=False)
    monkeypatch.delenv("EMBEDDING_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_OPENAI_MODEL", raising=False)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_non_admin_put_gets_404(client: TestClient) -> None:
    resp = client.post(
        "/admin/knowledge/sources/aave-basics",
        headers=_headers(STRANGER),
        json={"title": "Aave", "markdown": "# Aave\n\nAave is a lending protocol."},
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_non_admin_status_gets_404(client: TestClient) -> None:
    resp = client.get("/admin/knowledge/status", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_put_rejects_pii_with_422_before_embed(client: TestClient) -> None:
    # An email address trips scan_for_pii; the note must be refused BEFORE any embed/store call.
    resp = client.post(
        "/admin/knowledge/sources/contact",
        headers=_headers(ADMIN),
        json={"title": "Contact", "markdown": "# Contact\n\nReach us at alice@example.com."},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_put_without_embedder_degrades_to_503(client: TestClient) -> None:
    # Clean markdown passes the PII scan, then hits the missing-embedder guard → 503 (never a stub).
    resp = client.post(
        "/admin/knowledge/sources/aave-basics",
        headers=_headers(ADMIN),
        json={"title": "Aave", "markdown": "# Aave\n\nAave is a lending protocol on Base."},
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_reingest_without_embedder_degrades_to_503(client: TestClient) -> None:
    resp = client.post("/admin/knowledge/reingest", headers=_headers(ADMIN))
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_requires_s2s_auth() -> None:
    resp = TestClient(app).get("/admin/knowledge/status")
    assert resp.status_code in (401, 400)
