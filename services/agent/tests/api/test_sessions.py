# ruff: noqa: S101, S105
"""US6 session-key API — grant/revoke/list build endpoints (feature 022; agent-service-api §3.9).

DB-free: a fake SessionKeyStore + a config with the deployed vault. The crux (non-custody): the
service builds UNSIGNED txs only (never signs, holds no session key); an out-of-policy grant yields
reasons and NO tx; revoke is a sacred exit built unconditionally (N2). These MUST pass.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.sessions import get_session_store
from sparkpoint_agent.api.vault import get_sim_config
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.session_keys import SessionKeyRow

TOKEN = "test-web-tier-token"
VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
ACCOUNT = "0x07754fed9680872710d7e91195890435ee4aaf59"
OWNER = "0xa71e24359a6cb7a939aae2d62dd12b6256365c30"
SESSION_KEY = "0xd9a07554bb203fa0c5b3e2a27a52eaede7fd1830"
DEP_SEL = "0x6e553f65"
WITHDRAW_SEL = "0xb460af94"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": ACCOUNT,
    "X-Owner": OWNER,
    "X-Chain-Id": "84532",
}
_AUTHORIZE_SELECTOR = "bc3cabbb"
_REVOKE_SELECTOR = "84f4fc6a"


class _FakeStore:
    """Records mirror writes; returns a canned list. All async, all fail-safe."""

    def __init__(self, rows: list[SessionKeyRow] | None = None) -> None:
        self.rows = rows or []
        self.granted: list[str] = []
        self.revoked: list[str] = []

    async def upsert_grant(self, *, session_pubkey: str, **_: object) -> UUID:
        self.granted.append(session_pubkey)
        return UUID("22222222-2222-2222-2222-222222222222")

    async def mark_revoked(self, *, session_pubkey: str, **_: object) -> None:
        self.revoked.append(session_pubkey)

    async def list_by_account(self, _account: str) -> list[SessionKeyRow]:
        return self.rows


def _config() -> AgentConfig:
    return AgentConfig(chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, _FakeStore]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    store = _FakeStore()
    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_sim_config] = _config
    yield TestClient(app), store
    app.dependency_overrides.clear()


def _grant_body(**over: object) -> dict[str, object]:
    body: dict[str, object] = {
        "sessionPubkey": SESSION_KEY,
        "validUntil": int(time.time()) + 7 * 86400,
        "validAfter": 0,
        "perTxCap": 500_000_000,
        "cumulativeCap": 5_000_000_000,
        "maxSlippageBps": 0,
        "allowlist": [
            {"target": VAULT, "selector": DEP_SEL},
            {"target": VAULT, "selector": WITHDRAW_SEL},
        ],
    }
    body.update(over)
    return body


def test_grant_build_in_scope_returns_unsigned_tx(client: tuple[TestClient, _FakeStore]) -> None:
    c, store = client
    resp = c.post("/session-keys/grant/build", json=_grant_body(), headers=HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["reasons"] == ["OK"]
    assert data["scopeEcho"]["sessionKey"] == SESSION_KEY
    assert data["scopeEcho"]["recipientPin"] == "user_account"
    tx = data["tx"]
    assert tx["to"].lower() == ACCOUNT
    assert tx["chainId"] == 84532
    assert tx["data"].startswith("0x" + _AUTHORIZE_SELECTOR)
    assert store.granted == [SESSION_KEY]  # mirrored


def test_grant_build_over_cap_rejected_no_tx(client: tuple[TestClient, _FakeStore]) -> None:
    c, _ = client
    resp = c.post(
        "/session-keys/grant/build", json=_grant_body(perTxCap=500_000_001), headers=HEADERS
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["tx"] is None
    assert "CAP_PER_TX_EXCEEDED" in data["reasons"]


def test_grant_build_forbidden_selector_rejected(client: tuple[TestClient, _FakeStore]) -> None:
    c, _ = client
    body = _grant_body(allowlist=[{"target": VAULT, "selector": "0x095ea7b3"}])  # approve
    resp = c.post("/session-keys/grant/build", json=body, headers=HEADERS)
    assert resp.json()["ok"] is False
    assert "SELECTOR_NOT_ALLOWLISTED" in resp.json()["reasons"]


def test_revoke_build_is_always_buildable(client: tuple[TestClient, _FakeStore]) -> None:
    c, store = client
    resp = c.post(
        "/session-keys/revoke/build", json={"sessionPubkey": SESSION_KEY}, headers=HEADERS
    )
    assert resp.status_code == 200
    tx = resp.json()["tx"]
    assert tx["to"].lower() == ACCOUNT
    assert tx["data"].startswith("0x" + _REVOKE_SELECTOR)
    assert store.revoked == [SESSION_KEY]  # sacred exit mirrored


def test_list_session_keys_maps_store_rows(client: tuple[TestClient, _FakeStore]) -> None:
    c, store = client
    store.rows = [
        SessionKeyRow(
            id=UUID("33333333-3333-3333-3333-333333333333"),
            smart_account_address=ACCOUNT,
            owner_address=OWNER,
            chain_id=84532,
            session_pubkey=SESSION_KEY,
            status="active",
            allowlisted_targets=[VAULT],
            allowlisted_selectors=[DEP_SEL],
            per_tx_cap_raw=500_000_000,
            cumulative_cap_raw=5_000_000_000,
            spent_raw=1_000_000,
            max_slippage_bps=0,
            valid_after=None,
            valid_until=datetime(2030, 1, 1, tzinfo=UTC),
            registered_tx_hash="0xabc",
            revoked_tx_hash=None,
            created_at=datetime(2026, 7, 24, tzinfo=UTC),
            updated_at=datetime(2026, 7, 24, tzinfo=UTC),
        )
    ]
    resp = c.get("/session-keys", headers=HEADERS)
    assert resp.status_code == 200
    keys = resp.json()["sessionKeys"]
    assert len(keys) == 1
    assert keys[0]["sessionKey"] == SESSION_KEY
    assert keys[0]["status"] == "active"
    assert keys[0]["spent"] == "1000000"
