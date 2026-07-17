# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Alpha content endpoints (api/content.py) — public changelog/announcement + admin authoring.

The content store is MOCKED (no live DB). These assert:
  - GET /content/changelog + /content/announcement are readable by ANY beta wallet (not admin);
  - /admin/content* is admin-gated — a non-admin gets 404 (never 403), invisible;
  - create/update/delete are audit-logged, actor = caller;
  - cta_href is validated (no javascript:/data: schemes);
  - no response carries a signable artifact (pure content surface, N2).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.content import get_content_store
from sparkpoint_agent.api.main import app

TOKEN = "test-web-tier-token"
ADMIN_WALLET = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
BETA_WALLET = "0x1111111111111111111111111111111111111111"
STRANGER = "0x3333333333333333333333333333333333333333"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAllowlist:
    def __init__(self) -> None:
        self.admin: set[str] = set()

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admin

    async def status(self, address: str) -> dict[str, bool]:
        a = address.lower()
        return {"beta": a in self.admin, "admin": a in self.admin}


class _FakeContent:
    """In-memory ContentEntryStore mirroring the real create/update/delete + audit semantics."""

    def __init__(self) -> None:
        self.rows: dict[int, dict[str, Any]] = {}
        self.audit: list[tuple[str, str, str | None]] = []
        self._next = 1

    async def list_changelog(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = [r for r in self.rows.values() if r["type"] == "changelog" and r["isActive"]]
        return sorted(rows, key=lambda r: r["id"], reverse=True)[:limit]

    async def active_announcement(self) -> dict[str, Any] | None:
        rows = [r for r in self.rows.values() if r["type"] == "announcement" and r["isActive"]]
        return sorted(rows, key=lambda r: r["id"], reverse=True)[0] if rows else None

    async def list_all(self, limit: int = 200) -> list[dict[str, Any]]:
        return sorted(self.rows.values(), key=lambda r: r["id"], reverse=True)[:limit]

    async def get(self, entry_id: int) -> dict[str, Any] | None:
        return self.rows.get(entry_id)

    async def create(self, **kw: Any) -> int:
        entry_id = self._next
        self._next += 1
        self.rows[entry_id] = {
            "id": entry_id, "type": kw["type_"], "title": kw["title"], "body": kw["body"],
            "tag": kw["tag"], "ctaLabel": kw["cta_label"], "ctaHref": kw["cta_href"],
            "isActive": kw["is_active"], "publishedAt": kw.get("published_at"),
        }
        self.audit.append(("create", str(entry_id), (kw["actor"] or "").lower() or None))
        return entry_id

    async def update(self, entry_id: int, **kw: Any) -> None:
        self.rows[entry_id].update(
            type=kw["type_"], title=kw["title"], body=kw["body"], tag=kw["tag"],
            ctaLabel=kw["cta_label"], ctaHref=kw["cta_href"], isActive=kw["is_active"],
        )
        self.audit.append(("update", str(entry_id), (kw["actor"] or "").lower() or None))

    async def delete(self, entry_id: int, *, actor: str | None) -> None:
        self.rows.pop(entry_id, None)
        self.audit.append(("delete", str(entry_id), (actor or "").lower() or None))

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        return [
            {"action": a, "subject": s, "actor": ac, "detail": {}, "at": "2026-01-01T00:00:00Z"}
            for (a, s, ac) in reversed(self.audit)
        ][:limit]


_Ctx = tuple[TestClient, "_FakeContent", "_FakeAllowlist"]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Ctx]:
    from sparkpoint_agent.api.allowlist import get_allowlist_store

    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    content = _FakeContent()
    allow = _FakeAllowlist()
    app.dependency_overrides[get_content_store] = lambda: content
    app.dependency_overrides[get_allowlist_store] = lambda: allow
    try:
        yield TestClient(app), content, allow
    finally:
        app.dependency_overrides.pop(get_content_store, None)
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── public reads (any beta wallet, NOT admin) ────────────────────────────────


def test_public_changelog_readable_by_non_admin(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, content, _ = ctx
    content.rows[1] = {
        "id": 1, "type": "changelog", "title": "Live portfolio", "body": "Real numbers now.",
        "tag": "New", "ctaLabel": None, "ctaHref": None, "isActive": True,
    }
    resp = client.get("/content/changelog", headers=_headers(STRANGER))
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert len(entries) == 1 and entries[0]["title"] == "Live portfolio"


def test_public_announcement_null_when_none(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, _ = ctx
    resp = client.get("/content/announcement", headers=_headers(BETA_WALLET))
    assert resp.status_code == 200
    assert resp.json() == {"announcement": None}


# ── admin gate: non-admin gets 404 everywhere ────────────────────────────────


def test_admin_list_denied_to_non_admin_is_404(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, _ = ctx
    resp = client.get("/admin/content", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_admin_create_denied_to_non_admin_is_404(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, _ = ctx
    resp = client.post(
        "/admin/content",
        json={"type": "changelog", "title": "x", "body": "y"},
        headers=_headers(STRANGER),
    )
    assert resp.status_code == 404


# ── admin authoring (as an admin) ────────────────────────────────────────────


def test_admin_create_then_public_read_and_audit(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, content, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    created = client.post(
        "/admin/content",
        json={"type": "changelog", "title": "Swap page", "body": "Uniswap V3 live.", "tag": "New"},
        headers=_headers(ADMIN_WALLET),
    )
    assert created.status_code == 200
    assert created.json()["created"] is True

    # Now a NON-admin beta wallet sees it on the public feed.
    feed = client.get("/content/changelog", headers=_headers(BETA_WALLET))
    assert feed.json()["entries"][0]["title"] == "Swap page"

    audit = client.get("/admin/content/audit", headers=_headers(ADMIN_WALLET))
    entries = audit.json()["entries"]
    assert entries and entries[0]["action"] == "create"
    assert entries[0]["actor"] == ADMIN_WALLET.lower()


def test_admin_update_missing_id_is_404(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/content",
        json={"id": 999, "type": "changelog", "title": "x", "body": "y"},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 404


def test_admin_delete(ctx: tuple[TestClient, _FakeContent, _FakeAllowlist]) -> None:
    client, content, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    content.rows[5] = {
        "id": 5, "type": "announcement", "title": "Hi", "body": "b", "tag": None,
        "ctaLabel": None, "ctaHref": None, "isActive": True,
    }
    resp = client.post("/admin/content/delete", json={"id": 5}, headers=_headers(ADMIN_WALLET))
    assert resp.status_code == 200
    assert 5 not in content.rows


def test_cta_href_rejects_javascript_scheme(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/content",
        json={"type": "announcement", "title": "x", "body": "y",
              "cta_label": "go", "cta_href": "javascript:alert(1)"},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 400  # validation error — unsafe href refused


def test_cta_href_allows_internal_and_https(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    for href in ("/vault", "https://docs.sparkpoint.io"):
        resp = client.post(
            "/admin/content",
            json={"type": "announcement", "title": "x", "body": "y",
                  "cta_label": "go", "cta_href": href},
            headers=_headers(ADMIN_WALLET),
        )
        assert resp.status_code == 200


def test_published_at_backdate_is_passed_through(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, content, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/content",
        json={"type": "changelog", "title": "Old news", "body": "b",
              "tag": "New", "published_at": "2026-07-14"},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 200
    new_id = resp.json()["id"]
    assert content.rows[new_id]["publishedAt"] == "2026-07-14"


def test_published_at_rejects_bad_date(
    ctx: tuple[TestClient, _FakeContent, _FakeAllowlist],
) -> None:
    client, _, allow = ctx
    allow.admin.add(ADMIN_WALLET.lower())
    resp = client.post(
        "/admin/content",
        json={"type": "changelog", "title": "x", "body": "y", "published_at": "last tuesday"},
        headers=_headers(ADMIN_WALLET),
    )
    assert resp.status_code == 400  # validation error — not an ISO date


def test_parse_ts_backdating_helper() -> None:
    from datetime import UTC, datetime

    from sparkpoint_agent.db.content_entries import _parse_ts

    assert _parse_ts(None) is None
    assert _parse_ts("  ") is None
    # date-only → midnight UTC (tz-aware, so asyncpg binds it to timestamptz)
    assert _parse_ts("2026-07-10") == datetime(2026, 7, 10, tzinfo=UTC)
    got = _parse_ts("2026-07-12T09:30")
    assert got == datetime(2026, 7, 12, 9, 30, tzinfo=UTC)
    assert got is not None and got.tzinfo is not None
