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

    def _mine(self, owner_eoa: str, query: str | None) -> list[tuple[str, dict[str, Any]]]:
        """040 — ownership FIRST, then the search. The order is the security model: a search that
        filtered before scoping would be a search across every wallet."""
        rows = [(cid, c) for cid, c in self.convos.items() if c["owner"] == owner_eoa.lower()]
        if query:
            rows = [(cid, c) for cid, c in rows if query.lower() in c["title"].lower()]
        return rows

    async def list_conversations(
        self,
        owner_eoa: str,
        *,
        limit: int = 50,
        offset: int = 0,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        rows = self._mine(owner_eoa, query)[offset : offset + limit]
        return [
            {"id": cid, "title": c["title"], "turnCount": len(c["turns"]),
             "createdAt": "t", "updatedAt": "t"}
            for cid, c in rows
        ]

    async def count_conversations(self, owner_eoa: str, *, query: str | None = None) -> int:
        return len(self._mine(owner_eoa, query))

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


# ── 025 · Task 2: the endpoint carries the persisted cards ─────────────────────

_ACTION_BLOCK = {
    "type": "action",
    "proposedAction": {
        "type": "aerodrome_swap",
        "asset": "0x4200000000000000000000000000000000000006",
        "decimals": 18,
        "amount": "10000000000000000",
        "params": {"maxSlippageBps": 50},
    },
    "policy": {"status": "rejected", "reason": "Swaps run on Uniswap V3."},
}


def test_get_conversation_returns_persisted_blocks(
    client: TestClient, store: _FakeStore
) -> None:
    # A 025 turn carries its cards, so the web can replay real cards instead of the summary.
    cid = "11111111-1111-1111-1111-111111111111"
    store.convos[cid]["turns"] = [
        {"role": "user", "content": "Swap ETH to USDC", "blocks": [], "at": "t"},
        {
            "role": "assistant",
            "content": "[proposed action: aerodrome_swap]",
            "blocks": [_ACTION_BLOCK],
            "at": "t",
        },
    ]
    resp = client.get(f"/conversations/{cid}", headers=_headers(ALICE))
    assert resp.status_code == 200
    turns = resp.json()["turns"]
    assert turns[0]["blocks"] == []
    assert turns[1]["blocks"] == [_ACTION_BLOCK]
    # The lossy summary is still there — legacy readers and the classifier both keep working.
    assert turns[1]["content"] == "[proposed action: aerodrome_swap]"
    # The policy stamp survives replay verbatim; nothing re-derives or upgrades it.
    assert turns[1]["blocks"][0]["policy"]["status"] == "rejected"


def test_get_conversation_legacy_turns_are_unaffected(
    client: TestClient, store: _FakeStore
) -> None:
    # A pre-0028 turn (no `blocks` key at all) still returns its text and never 500s.
    cid = "11111111-1111-1111-1111-111111111111"
    store.convos[cid]["turns"] = [
        {"role": "user", "content": "hello", "at": "t"},
        {"role": "assistant", "content": "[showed your portfolio]", "at": "t"},
    ]
    resp = client.get(f"/conversations/{cid}", headers=_headers(ALICE))
    assert resp.status_code == 200
    turns = resp.json()["turns"]
    assert [t["content"] for t in turns] == ["hello", "[showed your portfolio]"]
    assert all("blocks" not in t for t in turns)


def test_persisted_blocks_are_not_leaked_to_a_foreign_caller(
    client: TestClient, store: _FakeStore
) -> None:
    # Ownership is unchanged by 025: Bob still cannot read Alice's cards.
    cid = "11111111-1111-1111-1111-111111111111"
    store.convos[cid]["turns"] = [
        {"role": "assistant", "content": "s", "blocks": [_ACTION_BLOCK], "at": "t"}
    ]
    resp = client.get(f"/conversations/{cid}", headers=_headers(BOB))
    assert resp.status_code == 404
    assert "aerodrome_swap" not in resp.text


# ── 040: paging, search, and the scope that must survive both ────────────────


def test_040_a_page_is_bounded_and_the_total_says_how_many_exist(
    client: TestClient,
    store: _FakeStore,
) -> None:
    """The control says "Show 60 older conversations", not "Show more" — so the count has to be a
    fact. Without it the sidebar cannot tell "this is all of them" from "this is the first page"."""
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    for i in range(12):
        store.seed(f"c{i}", ALICE, f"conversation {i}")

    body = client.get("/conversations?limit=5", headers=_headers(ALICE)).json()
    assert len(body["conversations"]) == 5
    assert body["total"] == 12


def test_040_offset_returns_the_next_page_without_repeating_the_first(
    client: TestClient,
    store: _FakeStore,
) -> None:
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    for i in range(12):
        store.seed(f"c{i}", ALICE, f"conversation {i}")

    first = client.get(
        "/conversations?limit=5&offset=0",
        headers=_headers(ALICE),
    ).json()["conversations"]
    second = client.get(
        "/conversations?limit=5&offset=5",
        headers=_headers(ALICE),
    ).json()["conversations"]
    assert {c["id"] for c in first}.isdisjoint({c["id"] for c in second})
    assert len(second) == 5


def test_040_search_filters_by_title(client: TestClient, store: _FakeStore) -> None:
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    store.seed("a", ALICE, "Explain the performance fee")
    store.seed("b", ALICE, "What is in my wallet")

    body = client.get("/conversations?q=performance", headers=_headers(ALICE)).json()
    assert [c["id"] for c in body["conversations"]] == ["a"]
    assert body["total"] == 1, "the total narrows to the search, so the control does not lie"


def test_040_a_search_matching_nothing_is_an_empty_list_not_an_error(
    client: TestClient,
    store: _FakeStore,
) -> None:
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    store.seed("a", ALICE, "Explain the performance fee")
    body = client.get("/conversations?q=zzzznothing", headers=_headers(ALICE)).json()
    assert body["conversations"] == []
    assert body["total"] == 0


def test_040_an_empty_search_is_not_a_search(client: TestClient, store: _FakeStore) -> None:
    """A blank or whitespace `q` must return the full list, not zero results — the box is empty far
    more often than it is filled."""
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    store.seed("a", ALICE, "Explain the performance fee")
    for q in ("", "   "):
        body = client.get(f"/conversations?q={q}", headers=_headers(ALICE)).json()
        assert body["total"] == 1, f"q={q!r}"


def test_040_SEARCH_NEVER_REACHES_ANOTHER_WALLET(client: TestClient, store: _FakeStore) -> None:
    """The one that matters. A title search is exactly the shape of change that quietly widens a
    scope: filter before you scope, and you have built a search across every user's
    conversations."""
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    store.seed("mine", ALICE, "shared secret title")
    store.seed("theirs", BOB, "shared secret title")

    body = client.get("/conversations?q=shared", headers=_headers(ALICE)).json()
    assert [c["id"] for c in body["conversations"]] == ["mine"]
    assert body["total"] == 1


def test_040_paging_never_reaches_another_wallet_either(
    client: TestClient,
    store: _FakeStore,
) -> None:
    store.convos.clear()  # this test owns its data; the fixture pre-seeds a row
    store.seed("mine", ALICE, "a")
    for i in range(10):
        store.seed(f"theirs{i}", BOB, "b")

    body = client.get("/conversations?limit=50&offset=0", headers=_headers(ALICE)).json()
    assert [c["id"] for c in body["conversations"]] == ["mine"]
    assert body["total"] == 1
