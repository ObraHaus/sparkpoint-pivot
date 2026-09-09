# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""T020 — request middleware contract (agent-service-api.md §1).

Health is open; user-scoped paths require the s2s bearer token + valid account
headers; every rejection is the canonical §1.5 envelope carrying a §1.6 code, a
stamped ``policyVersion`` and a ``requestId``; a malformed ``Idempotency-Key`` is a
VALIDATION_ERROR; and the idempotency store replays the original (first-write-wins).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.idempotency import IdempotencyStore, StoredResponse, is_valid_key
from sparkpoint_agent.api.main import app

TOKEN = "test-web-tier-token"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    return TestClient(app)


def test_healthz_is_open(client: TestClient) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_missing_token_is_unauthenticated(client: TestClient) -> None:
    resp = client.get("/api/v1/anything")
    assert resp.status_code == 401
    err = resp.json()["error"]
    assert err["code"] == "UNAUTHENTICATED"
    assert err["policyVersion"]  # §1.5 — stamped on every envelope
    assert err["requestId"].startswith("req_")
    assert err["retryable"] is False


def test_wrong_token_is_unauthenticated(client: TestClient) -> None:
    resp = client.get("/api/v1/anything", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


def test_missing_account_headers_rejected(client: TestClient) -> None:
    resp = client.get("/api/v1/anything", headers={"Authorization": f"Bearer {TOKEN}"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "ACCOUNT_HEADERS_INVALID"


def test_account_equal_to_owner_accepted(client: TestClient) -> None:
    # EOA-direct mode (pre-AA-account, W6): the connected EOA is legitimately BOTH the
    # identity anchor and the owner until the AccountFactory is deployed + the frontend
    # derives each user's counterfactual SparkPointAccount. account == owner passes the
    # gate → 404 (no route mounted at this path), NOT a 400 header rejection.
    headers = dict(GOOD_HEADERS, **{"X-Owner": GOOD_HEADERS["X-Account"]})
    resp = client.get("/api/v1/anything", headers=headers)
    assert resp.status_code == 404


def test_unsupported_chain_rejected(client: TestClient) -> None:
    headers = dict(GOOD_HEADERS, **{"X-Chain-Id": "1"})
    resp = client.get("/api/v1/anything", headers=headers)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "ACCOUNT_HEADERS_INVALID"


def test_valid_auth_passes_the_gate(client: TestClient) -> None:
    # No router mounted yet → a 404 from routing, NOT a 401/400 from the gate.
    resp = client.get("/api/v1/anything", headers=GOOD_HEADERS)
    assert resp.status_code == 404


def test_malformed_idempotency_key_is_validation_error(client: TestClient) -> None:
    headers = dict(GOOD_HEADERS, **{"Idempotency-Key": "not-a-uuid"})
    resp = client.post("/api/v1/anything", headers=headers)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_is_valid_key() -> None:
    assert is_valid_key("123e4567-e89b-12d3-a456-426614174000")
    assert not is_valid_key("nope")


async def test_idempotency_store_replays_first_write() -> None:
    store = IdempotencyStore()
    idem_key = "123e4567-e89b-12d3-a456-426614174000"  # gitleaks:allow (example UUID)
    assert await store.get(idem_key) is None
    await store.put(idem_key, StoredResponse(200, "application/json", b'{"ok":true}'))
    first = await store.get(idem_key)
    assert first is not None and first.body == b'{"ok":true}'
    # First write wins — a later put for the same key does not clobber the original.
    await store.put(idem_key, StoredResponse(200, "application/json", b'{"ok":false}'))
    again = await store.get(idem_key)
    assert again is not None and again.body == b'{"ok":true}'
