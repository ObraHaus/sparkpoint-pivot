# ruff: noqa: S101, S105  (pytest asserts; token is a test fixture)
"""027 · Task 3 — ``GET /memory/self`` + ``POST /memory/clear``, session-scoped.

Memory the assistant keeps ABOUT a user must be inspectable and erasable BY that user. An in-memory
fake store keyed by owner exercises the scoping without a DB: a caller only ever sees or erases
their OWN digest, and there is no admin override anywhere on this surface.

Also pins the two DIFFERENT degradation postures, which are deliberate and not symmetric:
  * READ fails open — an empty digest is a valid 200, so Settings renders honestly on a database
    (or migration) that isn't ready, instead of 500ing;
  * CLEAR does NOT — a user-initiated erase must never report success it did not achieve.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.memory import get_memory_store
from sparkpoint_agent.memory import MemoryEntry, UserMemory

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
    """In-memory stand-in for MemoryStore: {lowercased owner: UserMemory}."""

    def __init__(self) -> None:
        self.memories: dict[str, UserMemory] = {}
        self.cleared: list[str] = []
        self.clear_raises = False

    def seed(self, owner: str, *lines: str) -> None:
        self.memories[owner.lower()] = UserMemory(
            entries=tuple(MemoryEntry(at="2026-08-02T04:15:00+00:00", line=x) for x in lines),
            updated_at="2026-08-02T04:15:00+00:00",
        )

    async def get(self, owner_eoa: str) -> UserMemory:
        return self.memories.get(owner_eoa.lower(), UserMemory())

    async def clear(self, owner_eoa: str) -> None:
        if self.clear_raises:
            raise RuntimeError("pool is down")
        self.cleared.append(owner_eoa.lower())
        self.memories.pop(owner_eoa.lower(), None)


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeStore]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    fake = _FakeStore()
    app.dependency_overrides[get_memory_store] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# ── GET /memory/self ────────────────────────────────────────────────────────────


def test_get_returns_the_callers_own_lines_with_the_timestamp(
    client: TestClient, store: _FakeStore
) -> None:
    store.seed(ALICE, "asked: what is APY?", "viewed portfolio")
    res = client.get("/memory/self", headers=_headers(ALICE))
    assert res.status_code == 200
    body = res.json()
    assert [entry["line"] for entry in body["lines"]] == [
        "asked: what is APY?",
        "viewed portfolio",
    ]
    assert body["updatedAt"] == "2026-08-02T04:15:00+00:00"


def test_get_serves_the_same_shape_the_model_is_given(
    client: TestClient, store: _FakeStore
) -> None:
    # HONESTY: the Settings page must show the literal stored entries, not a friendlier paraphrase,
    # or "here is what Sparky remembers" stops being a true statement.
    store.seed(ALICE, "was recommended: Aave USDC Supply")
    (entry,) = client.get("/memory/self", headers=_headers(ALICE)).json()["lines"]
    assert set(entry) == {"at", "line"}


def test_get_with_no_memory_is_an_empty_200_not_an_error(
    client: TestClient, store: _FakeStore
) -> None:
    res = client.get("/memory/self", headers=_headers(ALICE))
    assert res.status_code == 200
    assert res.json() == {"lines": [], "updatedAt": None}


def test_a_caller_never_sees_another_wallets_memory(
    client: TestClient, store: _FakeStore
) -> None:
    store.seed(ALICE, "asked: something private")
    body = client.get("/memory/self", headers=_headers(BOB)).json()
    assert body["lines"] == []


# ── POST /memory/clear ──────────────────────────────────────────────────────────


def test_clear_erases_only_the_callers_own_memory(client: TestClient, store: _FakeStore) -> None:
    store.seed(ALICE, "asked: something")
    store.seed(BOB, "asked: something else")
    res = client.post("/memory/clear", headers=_headers(ALICE))
    assert res.status_code == 200
    assert res.json() == {"ok": True, "lines": [], "updatedAt": None}
    assert store.cleared == [ALICE.lower()]
    assert client.get("/memory/self", headers=_headers(ALICE)).json()["lines"] == []
    assert client.get("/memory/self", headers=_headers(BOB)).json()["lines"] != []


def test_clear_is_idempotent_on_empty_memory(client: TestClient, store: _FakeStore) -> None:
    assert client.post("/memory/clear", headers=_headers(ALICE)).status_code == 200
    assert client.post("/memory/clear", headers=_headers(ALICE)).status_code == 200


def test_clear_reports_a_real_failure_instead_of_claiming_success(
    client: TestClient, store: _FakeStore
) -> None:
    # The user pressed a button that says "Clear memory". If it did not clear, we say so.
    store.seed(ALICE, "asked: something")
    store.clear_raises = True
    res = client.post("/memory/clear", headers=_headers(ALICE))
    assert res.status_code >= 500
    assert res.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


# ── auth / method ───────────────────────────────────────────────────────────────


def test_both_routes_require_the_service_bearer(client: TestClient, store: _FakeStore) -> None:
    unauthed: dict[str, Any] = {"X-Account": ALICE, "X-Owner": ALICE, "X-Chain-Id": "84532"}
    assert client.get("/memory/self", headers=unauthed).status_code == 401
    assert client.post("/memory/clear", headers=unauthed).status_code == 401


def test_clear_is_a_post_because_the_bff_forwards_only_get_and_post(
    client: TestClient, store: _FakeStore
) -> None:
    assert client.delete("/memory/clear", headers=_headers(ALICE)).status_code == 405
