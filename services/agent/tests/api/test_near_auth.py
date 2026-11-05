# ruff: noqa: S101, S105 — pytest asserts; the token is a test fixture, not a secret
"""076 — NEAR login nonce endpoints (single-use, expiry) without a real database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.near_auth import get_nonce_store
from sparkpoint_agent.db.near_nonces import IssuedNonce

TOKEN = "test-web-tier-token"


class FakeStore:
    def __init__(self) -> None:
        self.issued: dict[str, IssuedNonce] = {}

    async def create(self) -> IssuedNonce:
        now = datetime.now(UTC)
        issued = IssuedNonce("n" * 43, now, now + timedelta(minutes=10))
        self.issued[issued.nonce] = issued
        return issued

    async def consume(self, nonce: str) -> IssuedNonce | None:
        return self.issued.pop(nonce, None)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    store = FakeStore()
    app.dependency_overrides[get_nonce_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.pop(get_nonce_store, None)


def test_nonce_is_issued_with_a_lifetime(client: TestClient) -> None:
    resp = client.post("/auth/near/nonce", headers={"Authorization": f"Bearer {TOKEN}"}, json={})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["nonce"]) >= 16
    assert body["issuedAt"] and body["expiresAt"]


def test_nonce_is_single_use(client: TestClient) -> None:
    issued = client.post(
        "/auth/near/nonce", headers={"Authorization": f"Bearer {TOKEN}"}, json={}
    ).json()
    first = client.post(
        "/auth/near/consume",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"nonce": issued["nonce"]},
    )
    assert first.status_code == 200
    assert first.json()["ok"] is True
    second = client.post(
        "/auth/near/consume",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"nonce": issued["nonce"]},
    )
    assert second.status_code == 200
    assert second.json()["ok"] is False


def test_nonce_routes_still_require_the_s2s_bearer(client: TestClient) -> None:
    assert client.post("/auth/near/nonce", json={}).status_code == 401
