# ruff: noqa: S101, S105, S106
"""034 — the admin console surface for self-authoring.

Same posture as the rest of `/admin/*`: invisible to a non-admin. What is specific here is that
this surface is the ONLY control over what Sparky is allowed to read, so its validation has to be
strict and its error messages have to name what was wrong.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import admin_self_authoring
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.selfauthor.settings import DEFAULTS, SelfAuthorSettings

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


class _Doc:
    def __init__(self, slug: str, status: str = "draft") -> None:
        self.slug, self.status = slug, status
        self.title, self.markdown, self.claims = "T", "# T", []
        self.first_written_at = self.updated_at = self.published_at = None
        self.edited_by_admin = False


class _Finding:
    def __init__(self, fid: int, status: str = "held") -> None:
        self.id, self.status = fid, status
        self.topic, self.summary, self.created_at = "fee_competitiveness", "s", None


class _FakeStore:
    def __init__(self) -> None:
        self.settings = DEFAULTS
        self.actor: str | None = None
        self.docs = {"self-authored-base-usdc-yields": _Doc("self-authored-base-usdc-yields")}
        self.findings = [_Finding(1)]
        self.resolved: list[tuple[int, str, str | None]] = []

    async def get_settings(self) -> SelfAuthorSettings:
        return self.settings

    async def put_settings(self, settings: SelfAuthorSettings, *, actor: str | None) -> None:
        self.settings, self.actor = settings, actor

    async def settings_updated(self) -> tuple[Any, str | None]:
        return None, self.actor

    async def list_documents(self) -> list[_Doc]:
        return list(self.docs.values())

    async def get_document(self, slug: str) -> _Doc | None:
        return self.docs.get(slug)

    async def set_document_fields(self, slug: str, **kw: Any) -> bool:
        doc = self.docs.get(slug)
        if doc is None:
            return False
        if kw.get("status"):
            doc.status = kw["status"]
        return True

    async def delete_document(self, slug: str) -> bool:
        return self.docs.pop(slug, None) is not None

    async def list_findings(self, limit: int = 50) -> list[_Finding]:
        return self.findings

    async def resolve_finding(self, fid: int, *, status: str, actor: str | None) -> bool:
        if not any(f.id == fid for f in self.findings):
            return False
        self.resolved.append((fid, status, actor))
        return True

    async def list_runs(self, limit: int = 20) -> list[Any]:
        return []


@pytest.fixture
def store() -> _FakeStore:
    return _FakeStore()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, store: _FakeStore) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.setattr(admin_self_authoring, "_store", lambda: store)

    async def _noop(*_a: Any, **_k: Any) -> None:
        return None

    import sparkpoint_agent.api.self_authoring_runner as runner

    monkeypatch.setattr(runner, "publish_document", _noop)
    monkeypatch.setattr(runner, "unpublish_document", _noop)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── the gate ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/self-authoring"),
        ("PUT", "/admin/self-authoring/settings"),
        ("POST", "/admin/self-authoring/run"),
        ("PUT", "/admin/self-authoring/documents/x"),
        ("DELETE", "/admin/self-authoring/documents/x"),
        ("POST", "/admin/self-authoring/findings/1"),
    ],
)
def test_every_route_is_invisible_to_a_non_admin(
    client: TestClient, method: str, path: str
) -> None:
    response = client.request(method, path, headers=_headers(STRANGER), json={})
    assert response.status_code == 404


# ── the overview ─────────────────────────────────────────────────────────────


def test_the_overview_fills_the_whole_section_in_one_call(client: TestClient) -> None:
    body = client.get("/admin/self-authoring", headers=_headers(ADMIN)).json()
    assert set(body) == {"settings", "documents", "findings", "runs"}
    assert body["settings"]["enabled"] is False
    assert body["settings"]["allowedProseDomains"] == []


def test_the_console_shows_the_held_COUNT_and_the_age_of_the_oldest(client: TestClient) -> None:
    """A growing pile of held findings is what turns editorial control into silence. A number that
    goes up is visible in a way a list alone is not."""
    findings = client.get("/admin/self-authoring", headers=_headers(ADMIN)).json()["findings"]
    assert findings["heldCount"] == 1
    assert "oldestHeldAt" in findings


# ── settings ─────────────────────────────────────────────────────────────────


def test_a_partial_patch_changes_only_what_was_sent(client: TestClient, store: _FakeStore) -> None:
    client.put(
        "/admin/self-authoring/settings", headers=_headers(ADMIN), json={"draftWindowHours": 0}
    )
    assert store.settings.draft_window_hours == 0
    assert store.settings.enabled is False, "unmentioned fields are untouched"


def test_a_full_url_in_the_domain_list_is_rejected_and_the_message_NAMES_it(
    client: TestClient,
) -> None:
    """An admin who typed a URL must be told, not silently coerced — otherwise they believe a path
    restriction is in force when the allowlist is per-host."""
    response = client.put(
        "/admin/self-authoring/settings",
        headers=_headers(ADMIN),
        json={"allowedProseDomains": ["https://docs.aave.com/v3"]},
    )
    assert response.status_code == 400
    assert "docs.aave.com/v3" in response.json()["error"]["message"]


def test_an_unknown_data_source_is_rejected_by_name(client: TestClient) -> None:
    response = client.put(
        "/admin/self-authoring/settings",
        headers=_headers(ADMIN),
        json={"allowedDataSources": ["chain", "wikipedia"]},
    )
    assert response.status_code == 400
    assert "wikipedia" in response.json()["error"]["message"]


def test_an_impossible_draft_window_is_rejected(client: TestClient) -> None:
    response = client.put(
        "/admin/self-authoring/settings", headers=_headers(ADMIN), json={"draftWindowHours": -1}
    )
    assert response.status_code == 400


def test_the_change_records_who_made_it(client: TestClient, store: _FakeStore) -> None:
    client.put("/admin/self-authoring/settings", headers=_headers(ADMIN), json={"enabled": True})
    # The context preserves the checksummed form the caller sent; compare case-insensitively.
    assert (store.actor or "").lower() == ADMIN.lower()


# ── running ──────────────────────────────────────────────────────────────────


def test_a_run_on_a_disabled_feature_says_so_rather_than_erroring(client: TestClient) -> None:
    body = client.post("/admin/self-authoring/run", headers=_headers(ADMIN)).json()
    assert body["outcome"] == "skipped_disabled"


# ── documents and findings ───────────────────────────────────────────────────


def test_an_unknown_document_is_a_404_not_a_silent_success(client: TestClient) -> None:
    response = client.put(
        "/admin/self-authoring/documents/nope", headers=_headers(ADMIN), json={"title": "x"}
    )
    assert response.status_code == 404


def test_an_unknown_document_status_is_rejected(client: TestClient) -> None:
    response = client.put(
        "/admin/self-authoring/documents/self-authored-base-usdc-yields",
        headers=_headers(ADMIN),
        json={"status": "live"},
    )
    assert response.status_code == 400


def test_publishing_a_document_marks_it_published(client: TestClient, store: _FakeStore) -> None:
    client.put(
        "/admin/self-authoring/documents/self-authored-base-usdc-yields",
        headers=_headers(ADMIN),
        json={"status": "published"},
    )
    assert store.docs["self-authored-base-usdc-yields"].status == "published"


def test_deleting_a_document_is_allowed_because_an_empty_corpus_is_valid(
    client: TestClient, store: _FakeStore
) -> None:
    response = client.delete(
        "/admin/self-authoring/documents/self-authored-base-usdc-yields", headers=_headers(ADMIN)
    )
    assert response.json()["removed"] is True
    assert store.docs == {}


def test_releasing_a_finding_records_who_did_it(client: TestClient, store: _FakeStore) -> None:
    response = client.post(
        "/admin/self-authoring/findings/1", headers=_headers(ADMIN), json={"status": "released"}
    )
    assert response.status_code == 200
    assert len(store.resolved) == 1
    fid, status, actor = store.resolved[0]
    assert (fid, status) == (1, "released")
    assert (actor or "").lower() == ADMIN.lower()


def test_an_unknown_finding_status_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/admin/self-authoring/findings/1", headers=_headers(ADMIN), json={"status": "maybe"}
    )
    assert response.status_code == 400


def test_an_unknown_finding_is_a_404(client: TestClient) -> None:
    response = client.post(
        "/admin/self-authoring/findings/999", headers=_headers(ADMIN), json={"status": "released"}
    )
    assert response.status_code == 404
