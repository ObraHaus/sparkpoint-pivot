# ruff: noqa: S101, S105, S106  (pytest asserts; tokens are test fixtures)
"""Admin persona console (api/admin_persona.py) — admin-gated, PII-fail-closed, embedder-free.

Mirrors the admin-knowledge posture:
  * every route is invisible to a non-admin (404 via ``require_admin``, before any store access);
  * a PII/secret-shaped override is 422'd by ``scan_for_pii`` BEFORE persistence;
  * S2S auth is required.
Plus the persona-specific guarantees (with an in-memory store double, no live DB):
  * a save works with NO embedder configured (persona is not the RAG corpus) and RELOADS the live
    persona so ``get_persona()`` reflects the override;
  * a revert drops the override and reloads back toward the seed.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent import persona
from sparkpoint_agent.api import admin_persona
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


class _FakePersonaStore:
    """In-memory PersonaNoteStore double — no DB needed to exercise the success path."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.audit: list[tuple[str, str, str | None]] = []

    async def overrides(self) -> dict[str, str]:
        return {slug: row["markdown"] for slug, row in self.rows.items()}

    async def list_notes(self) -> list[dict[str, Any]]:
        return [
            {
                "source": slug, "title": row["title"], "author": row.get("author"),
                "git_sha": None, "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
            for slug, row in self.rows.items()
        ]

    async def get_note(self, source: str) -> dict[str, Any] | None:
        row = self.rows.get(source)
        if row is None:
            return None
        return {
            "source": source, "title": row["title"], "markdown": row["markdown"],
            "author": row.get("author"), "git_sha": None,
            "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
        }

    async def put(
        self, *, source: str, title: str, markdown: str, author: str | None,
        git_sha: str | None, audit_action: str = "put",
    ) -> None:
        self.rows[source] = {"title": title, "markdown": markdown, "author": author}
        self.audit.append((audit_action, source, author))

    async def delete(self, source: str, *, actor: str | None) -> None:
        self.rows.pop(source, None)
        self.audit.append(("delete", source, actor))

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        return [
            {"action": a, "source": s, "actor": ac, "at": "2026-01-01T00:00:00+00:00"}
            for a, s, ac in reversed(self.audit)
        ][:limit]


@pytest.fixture
def store() -> _FakePersonaStore:
    return _FakePersonaStore()


@pytest.fixture(autouse=True)
def _reset_persona() -> Iterator[None]:
    persona._CACHE = None
    yield
    persona._CACHE = None


@pytest.fixture
def client(
    monkeypatch: pytest.MonkeyPatch, store: _FakePersonaStore
) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    # No embedder configured — a persona edit must STILL succeed (persona isn't the RAG corpus).
    monkeypatch.delenv("EMBEDDING_OPENAI_API_URL", raising=False)
    monkeypatch.delenv("EMBEDDING_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("EMBEDDING_OPENAI_MODEL", raising=False)
    monkeypatch.setattr(admin_persona, "_store", lambda: store)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/persona"),
        ("GET", "/admin/persona/identity"),
        ("POST", "/admin/persona/identity"),
        ("POST", "/admin/persona/identity/delete"),
        ("GET", "/admin/persona/audit"),
    ],
)
def test_every_persona_route_404s_for_non_admin(
    client: TestClient, method: str, path: str
) -> None:
    resp = client.request(method, path, headers=_headers(STRANGER), json={})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_put_rejects_pii_with_422(client: TestClient) -> None:
    resp = client.post(
        "/admin/persona/voice",
        headers=_headers(ADMIN),
        json={"title": "Voice", "markdown": "# Voice\n\nReach me at alice@example.com."},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_unknown_slug_404s(client: TestClient) -> None:
    resp = client.post(
        "/admin/persona/not-a-section",
        headers=_headers(ADMIN),
        json={"title": "X", "markdown": "# X\n\nbody"},
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_save_without_embedder_succeeds_and_reloads_persona(
    client: TestClient, store: _FakePersonaStore
) -> None:
    marker = "SPARKY_ADMIN_VOICE_MARKER"
    resp = client.post(
        "/admin/persona/voice",
        headers=_headers(ADMIN),
        json={"title": "Voice", "markdown": f"# Voice\n\n{marker} keep it plain."},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True and body["slug"] == "voice"
    assert body["persona_chars"] > 0
    # The override persisted AND the live persona was reloaded to include it.
    assert "voice" in store.rows
    assert marker in persona.get_persona()


def test_revert_drops_override_and_reloads(
    client: TestClient, store: _FakePersonaStore
) -> None:
    marker = "SPARKY_ADMIN_SOUL_MARKER"
    store.rows["soul"] = {"title": "Soul", "markdown": f"# Soul\n\n{marker}", "author": ADMIN}
    persona.reload_persona({"soul": store.rows["soul"]["markdown"]})
    assert marker in persona.get_persona()

    resp = client.post("/admin/persona/soul/delete", headers=_headers(ADMIN))
    assert resp.status_code == 200, resp.text
    assert resp.json()["reverted_to"] == "seed"
    assert "soul" not in store.rows
    assert marker not in persona.get_persona()  # reverted to the seed soul


def test_audit_lists_recent_changes(client: TestClient, store: _FakePersonaStore) -> None:
    client.post(
        "/admin/persona/identity",
        headers=_headers(ADMIN),
        json={"title": "Identity", "markdown": "# Identity\n\nSparky is a labeled tool."},
    )
    resp = client.get("/admin/persona/audit", headers=_headers(ADMIN))
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert any(e["action"] == "put" and e["source"] == "identity" for e in entries)


def test_requires_s2s_auth() -> None:
    resp = TestClient(app).get("/admin/persona")
    assert resp.status_code in (401, 400)
