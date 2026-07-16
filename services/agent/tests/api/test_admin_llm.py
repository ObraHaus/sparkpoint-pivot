# ruff: noqa: S101, S105  (pytest asserts; token is a test fixture)
"""§B admin LLM-gateway status endpoint (api/admin_llm.py) — admin-gated, degrades honestly."""

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
    monkeypatch.delenv("LITELLM_BASE_URL", raising=False)  # unconfigured → configured:false path
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_non_admin_gets_404(client: TestClient) -> None:
    resp = client.get("/admin/llm/status", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_admin_unconfigured_gateway_degrades(client: TestClient) -> None:
    resp = client.get("/admin/llm/status", headers=_headers(ADMIN))
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert body["reachable"] is False
    assert body["models"] == []
    assert body["key"] is None


def test_requires_s2s_auth() -> None:
    resp = TestClient(app).get("/admin/llm/status")
    assert resp.status_code in (401, 400)
