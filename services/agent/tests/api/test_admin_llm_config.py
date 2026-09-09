# ruff: noqa: S101, S105, S106  (pytest asserts; tokens are test fixtures)
"""§R3 configurable LLM gateway (api/admin_llm.py) — admin-gated, degrades honestly, scrubs keys.

Covers the new stats/activity/config surface: non-admins get 404; with no scoped admin key every
read degrades to ``adminConfigured:false`` (never 500) and every write 503s; key material is
scrubbed from anything the panel or audit log sees; and the delete guardrail refuses to strand the
chat alias with zero backends. The configured path is driven by an httpx MockTransport standing in
for the LiteLLM gateway (no network, no DB) — the audit store is faked so writes need no Postgres.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import admin_llm
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"
ALIAS = "sparkpoint-chat"


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
        ok = address.lower() in self._admins
        return {"beta": ok, "admin": ok}

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self._admins


class _FakeAudit:
    """Captures audit rows in memory so config-write tests need no Postgres."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str | None, dict[str, Any]]] = []

    async def record(
        self, action: str, subject: str, actor: str | None, detail: dict[str, Any] | None = None
    ) -> None:
        self.rows.append((action, subject, actor, detail or {}))

    async def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        return []


@pytest.fixture
def audit(monkeypatch: pytest.MonkeyPatch) -> _FakeAudit:
    fake = _FakeAudit()
    monkeypatch.setattr(admin_llm, "_audit_store", lambda: fake)
    return fake


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.delenv("LITELLM_BASE_URL", raising=False)
    monkeypatch.delenv("LITELLM_ADMIN_KEY", raising=False)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


# ── The mock gateway ─────────────────────────────────────────────────────────
# /model/info returns TWO alias deployments, one carrying an api_key + a hashed_token in its params
# (to prove scrubbing). One-deployment variants are built per-test for the guardrail.
def _model_info(ids: list[str]) -> dict[str, Any]:
    data = []
    for i, mid in enumerate(ids):
        data.append(
            {
                "model_name": ALIAS,
                "model_info": {"id": mid},
                "litellm_params": {
                    "model": f"openrouter/example/model-{i}",
                    "rpm": 60,
                    "api_key": "sk-should-be-scrubbed",  # must never reach the panel
                },
            }
        )
    return {"data": data}


def _gateway_handler(model_ids: list[str]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/model/info":
            return httpx.Response(200, json=_model_info(model_ids))
        if path == "/global/spend":
            return httpx.Response(200, json={"spend": 1.2345})
        if path == "/global/spend/report":
            return httpx.Response(200, json=[{"model": ALIAS, "spend": 1.23}])
        if path == "/key/info":
            return httpx.Response(200, json={"info": {"spend": 0.5, "api_key": "sk-secret"}})
        if path == "/spend/logs":
            return httpx.Response(
                200,
                json=[
                    {
                        "model": ALIAS,
                        "user": ADMIN,
                        "total_tokens": 42,
                        "spend": 0.01,
                        "status": "ok",
                    }
                ],
            )
        if path == "/model/new":
            return httpx.Response(200, json={"model_id": "new-1", "api_key": "sk-leak"})
        if path == "/model/delete":
            return httpx.Response(200, json={"deleted": True})
        return httpx.Response(404, json={"error": "not found"})

    return handler


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> Callable[[list[str]], TestClient]:
    """Return a factory: build a TestClient whose gateway serves the given alias deployment ids."""

    def make(model_ids: list[str]) -> TestClient:
        monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
        monkeypatch.setenv("LITELLM_BASE_URL", "http://gw/v1")
        monkeypatch.setenv("LITELLM_ADMIN_KEY", "sk-admin-scoped-test")
        monkeypatch.setenv("LITELLM_MODEL", ALIAS)
        transport = httpx.MockTransport(_gateway_handler(model_ids))
        real_client = httpx.AsyncClient  # capture BEFORE patching to avoid recursion

        def _client(*_a: Any, **kw: Any) -> httpx.AsyncClient:
            kw.pop("timeout", None)
            return real_client(transport=transport)

        monkeypatch.setattr(admin_llm.httpx, "AsyncClient", _client)
        app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
        return TestClient(app)

    yield make
    app.dependency_overrides.pop(get_allowlist_store, None)


# ── Unit: the scrubber ───────────────────────────────────────────────────────
def test_scrub_drops_secret_shaped_fields() -> None:
    dirty = {
        "model": "x",
        "api_key": "sk-1",
        "nested": {"master_key": "m", "hashed_token": "h", "ok": 1},
        "list": [{"password": "p", "keep": 2}],
    }
    clean = admin_llm._scrub(dirty)
    flat = repr(clean)
    assert "sk-1" not in flat and "master_key" not in flat and "hashed_token" not in flat
    assert "password" not in flat
    assert clean["model"] == "x"
    assert clean["nested"]["ok"] == 1
    assert clean["list"][0]["keep"] == 2


# ── Admin gate ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/admin/llm/stats"),
        ("GET", "/admin/llm/activity"),
        ("GET", "/admin/llm/config"),
        ("POST", "/admin/llm/config/model"),
        ("POST", "/admin/llm/config/model/delete"),
    ],
)
def test_non_admin_gets_404(unconfigured: TestClient, method: str, path: str) -> None:
    resp = unconfigured.request(method, path, headers=_headers(STRANGER), json={})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


# ── Honest degradation with no scoped admin key ──────────────────────────────
def test_unmatched_path_returns_enveloped_404(unconfigured: TestClient) -> None:
    # An unmatched route must return the SAME NOT_FOUND envelope a gated route does, so a non-admin
    # can't distinguish "route exists but gated" from "route absent" (invisible-admin posture).
    resp = unconfigured.get("/admin/llm/does-not-exist", headers=_headers(ADMIN))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_reads_degrade_without_admin_key(unconfigured: TestClient) -> None:
    for path in ("/admin/llm/stats", "/admin/llm/activity", "/admin/llm/config"):
        r = unconfigured.get(path, headers=_headers(ADMIN))
        assert r.status_code == 200, path
        assert r.json()["adminConfigured"] is False, path


def test_writes_503_without_admin_key(unconfigured: TestClient) -> None:
    add = unconfigured.post(
        "/admin/llm/config/model", headers=_headers(ADMIN), json={"upstream_model": "openrouter/x"}
    )
    assert add.status_code == 503
    assert add.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    dele = unconfigured.post(
        "/admin/llm/config/model/delete", headers=_headers(ADMIN), json={"id": "abc"}
    )
    assert dele.status_code == 503


# ── Configured path: scrubbing, guardrail, audit ─────────────────────────────
def test_config_and_stats_scrub_key_material(
    configured: Callable[[list[str]], TestClient], audit: _FakeAudit
) -> None:
    client = configured(["dep-a", "dep-b"])
    cfg = client.get("/admin/llm/config", headers=_headers(ADMIN))
    assert cfg.status_code == 200
    body = cfg.json()
    assert body["adminConfigured"] is True
    assert {d["id"] for d in body["deployments"]} == {"dep-a", "dep-b"}
    assert "api_key" not in repr(body) and "sk-should-be-scrubbed" not in repr(body)

    stats = client.get("/admin/llm/stats", headers=_headers(ADMIN))
    assert stats.status_code == 200
    assert stats.json()["total_spend"] == 1.2345
    assert "sk-secret" not in repr(stats.json())


def test_activity_masks_user_and_omits_content(
    configured: Callable[[list[str]], TestClient],
) -> None:
    client = configured(["dep-a", "dep-b"])
    r = client.get("/admin/llm/activity", headers=_headers(ADMIN))
    assert r.status_code == 200
    entries = r.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["user"] == f"{ADMIN[:6]}…{ADMIN[-4:]}"  # masked, not the full wallet
    assert ADMIN not in repr(r.json())


def test_delete_last_deployment_blocked(
    configured: Callable[[list[str]], TestClient], audit: _FakeAudit
) -> None:
    client = configured(["only-one"])  # single alias backend
    r = client.post(
        "/admin/llm/config/model/delete", headers=_headers(ADMIN), json={"id": "only-one"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert audit.rows == []  # nothing deleted ⇒ nothing logged


def test_delete_fails_closed_when_model_info_unreadable(
    monkeypatch: pytest.MonkeyPatch, audit: _FakeAudit
) -> None:
    # If the pre-delete /model/info read fails, the guardrail must REFUSE (503) — never fall through
    # and delete, which could strand the alias with zero backends.
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.setenv("LITELLM_BASE_URL", "http://gw/v1")
    monkeypatch.setenv("LITELLM_ADMIN_KEY", "sk-admin-scoped-test")
    monkeypatch.setenv("LITELLM_MODEL", ALIAS)
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/model/info":
            return httpx.Response(503, json={"error": "gateway busy"})  # read fails
        if request.url.path == "/model/delete":
            return httpx.Response(200, json={"deleted": True})  # would succeed if reached
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        admin_llm.httpx, "AsyncClient", lambda *a, **kw: real_client(transport=transport)
    )
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        client = TestClient(app)
        r = client.post(
            "/admin/llm/config/model/delete", headers=_headers(ADMIN), json={"id": "whatever"}
        )
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
        assert audit.rows == []  # nothing deleted ⇒ nothing logged
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_delete_fails_closed_when_target_not_found(
    monkeypatch: pytest.MonkeyPatch, audit: _FakeAudit
) -> None:
    # A delete whose target id isn't among the gateway's deployments (renamed/gone/parse gap) must
    # REFUSE — not delete blind (B5). The guardrail is now per-alias, so an unknown target fails
    # closed on "couldn't find it" rather than "couldn't confirm the chat backends".
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.setenv("LITELLM_BASE_URL", "http://gw/v1")
    monkeypatch.setenv("LITELLM_ADMIN_KEY", "sk-admin-scoped-test")
    monkeypatch.setenv("LITELLM_MODEL", ALIAS)
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/model/info":
            other = {"model_name": "some-other-alias", "model_info": {"id": "x"},
                     "litellm_params": {}}
            return httpx.Response(200, json={"data": [other]})
        if request.url.path == "/model/delete":
            return httpx.Response(200, json={"deleted": True})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        admin_llm.httpx, "AsyncClient", lambda *a, **kw: real_client(transport=transport)
    )
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        client = TestClient(app)
        # "ghost" isn't in /model/info (only "x" is) → target-not-found → refuse, no audit.
        r = client.post(
            "/admin/llm/config/model/delete", headers=_headers(ADMIN), json={"id": "ghost"}
        )
        assert r.status_code == 503
        assert audit.rows == []
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_delete_non_last_succeeds_and_audits(
    configured: Callable[[list[str]], TestClient], audit: _FakeAudit
) -> None:
    client = configured(["dep-a", "dep-b"])
    r = client.post("/admin/llm/config/model/delete", headers=_headers(ADMIN), json={"id": "dep-a"})
    assert r.status_code == 200
    assert r.json()["deleted"] == "dep-a"
    assert audit.rows and audit.rows[0][0] == "model_delete"
    assert audit.rows[0][1] == "dep-a"


def test_add_model_audits_and_scrubs_result(
    configured: Callable[[list[str]], TestClient], audit: _FakeAudit
) -> None:
    client = configured(["dep-a", "dep-b"])
    r = client.post(
        "/admin/llm/config/model",
        headers=_headers(ADMIN),
        json={"upstream_model": "openrouter/google/gemma-4-31b-it:free", "rpm": 60},
    )
    assert r.status_code == 200
    assert "sk-leak" not in repr(r.json())  # /model/new's api_key echo is scrubbed
    assert audit.rows and audit.rows[0][0] == "model_add"
