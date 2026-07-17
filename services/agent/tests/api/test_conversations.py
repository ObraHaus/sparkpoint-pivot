# ruff: noqa: S101, S105  (pytest asserts; token is a test fixture)
"""§B1 chat conversation history endpoints — session-scoped, no admin override.

Uses an in-memory fake store keyed by (owner, id) so ownership is exercised without a DB: a caller
only ever lists / reads / deletes their OWN conversations; a foreign id is a 404 (never leaks
existence), and an admin gets NO override.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.conversations import get_conversation_store
from sparkpoint_agent.api.main import app

TOKEN = "test-web-tier-token"
ALICE = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
BOB = "0x3333333333333333333333333333333333333333"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeStore:
    """In-memory stand-in for ConversationStore: {id: (owner, title, turns)}."""

    def __init__(self) -> None:
        self.convos: dict[str, dict[str, Any]] = {}

    def seed(self, cid: str, owner: str, title: str) -> None:
        self.convos[cid] = {"owner": owner.lower(), "title": title, "turns": []}

    async def list_conversations(self, owner_eoa: str, *, limit: int = 50) -> list[dict[str, Any]]:
        return [
            {"id": cid, "title": c["title"], "turnCount": len(c["turns"]),
             "createdAt": "t", "updatedAt": "t"}
            for cid, c in self.convos.items()
            if c["owner"] == owner_eoa.lower()
        ]

    async def get_conversation(self, owner_eoa: str, conversation_id: str) -> dict[str, Any] | None:
        c = self.convos.get(conversation_id)
        if c is None or c["owner"] != owner_eoa.lower():
            return None
        return {"id": conversation_id, "turns": c["turns"]}

    async def delete_conversation(self, owner_eoa: str, conversation_id: str) -> bool:
        c = self.convos.get(conversation_id)
        if c is None or c["owner"] != owner_eoa.lower():
            return False
        del self.convos[conversation_id]
        return True


@pytest.fixture
def store() -> Iterator[_FakeStore]:
    fake = _FakeStore()
    fake.seed("11111111-1111-1111-1111-111111111111", ALICE, "Alice's chat")
    fake.seed("22222222-2222-2222-2222-222222222222", BOB, "Bob's chat")
    app.dependency_overrides[get_conversation_store] = lambda: fake
    try:
        yield fake
    finally:
        app.dependency_overrides.pop(get_conversation_store, None)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    return TestClient(app)


def test_list_returns_only_own_conversations(client: TestClient, store: _FakeStore) -> None:
    resp = client.get("/conversations", headers=_headers(ALICE))
    assert resp.status_code == 200
    convos = resp.json()["conversations"]
    assert [c["title"] for c in convos] == ["Alice's chat"]  # Bob's is not visible


def test_get_own_conversation(client: TestClient, store: _FakeStore) -> None:
    cid = "11111111-1111-1111-1111-111111111111"
    resp = client.get(f"/conversations/{cid}", headers=_headers(ALICE))
    assert resp.status_code == 200
    assert resp.json()["id"] == "11111111-1111-1111-1111-111111111111"


def test_get_foreign_conversation_is_404(client: TestClient, store: _FakeStore) -> None:
    # Alice cannot read Bob's conversation — 404 (never leaks that it exists), no admin override.
    cid = "22222222-2222-2222-2222-222222222222"
    resp = client.get(f"/conversations/{cid}", headers=_headers(ALICE))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_delete_foreign_convo_404_preserves_it(client: TestClient, store: _FakeStore) -> None:
    resp = client.post(
        "/conversations/22222222-2222-2222-2222-222222222222/delete", headers=_headers(ALICE)
    )
    assert resp.status_code == 404
    assert "22222222-2222-2222-2222-222222222222" in store.convos  # Bob's is untouched


def test_delete_own_conversation(client: TestClient, store: _FakeStore) -> None:
    resp = client.post(
        "/conversations/11111111-1111-1111-1111-111111111111/delete", headers=_headers(ALICE)
    )
    assert resp.status_code == 200
    assert "11111111-1111-1111-1111-111111111111" not in store.convos


def test_conversations_require_s2s_auth() -> None:
    assert TestClient(app).get("/conversations").status_code in (401, 400)
