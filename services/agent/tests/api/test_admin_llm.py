# ruff: noqa: S101, S105  (pytest asserts; token is a test fixture)
"""§B admin LLM-gateway status endpoint (api/admin_llm.py) — admin-gated, degrades honestly."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

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


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    monkeypatch.delenv("LITELLM_BASE_URL", raising=False)  # unconfigured → configured:false path
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAllowlist({ADMIN})
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)


def test_non_admin_gets_404(client: TestClient) -> None:
    resp = client.get("/admin/llm/status", headers=_headers(STRANGER))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_admin_unconfigured_gateway_degrades(client: TestClient) -> None:
    resp = client.get("/admin/llm/status", headers=_headers(ADMIN))
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert body["reachable"] is False
    assert body["models"] == []
    assert body["key"] is None


def test_requires_s2s_auth() -> None:
    resp = TestClient(app).get("/admin/llm/status")
    assert resp.status_code in (401, 400)


def test_status_model_list_uses_admin_key_so_every_alias_shows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The virtual chat key is scoped to its own allowlist, so /model/info through it can't see other
    # aliases (e.g. the premium one). /status must fetch the MODEL LIST with the ADMIN key so the
    # Overview shows every alias — while /key/info stays on the VIRTUAL key (the one we meter).
    import sparkpoint_agent.api.admin_llm as m

    monkeypatch.setenv("LITELLM_BASE_URL", "http://gw.local")
    monkeypatch.setenv("LITELLM_API_KEY", "sk-virtual")
    monkeypatch.setenv("LITELLM_ADMIN_KEY", "sk-admin")

    seen: dict[str, str] = {}

    async def fake_get_json(_client: object, url: str, headers: dict[str, str]) -> object:
        auth = headers.get("authorization", "")
        if url.endswith("/model/info"):
            seen["model_info"] = auth
            base = {"model_name": "sparkpoint-chat", "litellm_params": {"model": "openrouter/x"}}
            if auth == "Bearer sk-admin":  # only the admin key can see the premium alias
                return {
                    "data": [
                        base,
                        {
                            "model_name": "sparkpoint-chat-premium",
                            "litellm_params": {"model": "openrouter/deepseek"},
                            "model_info": {"input_cost_per_token": 9.4e-08},
                        },
                    ]
                }
            return {"data": [base]}
        if url.endswith("/key/info"):
            seen["key_info"] = auth
            return {"info": {"spend": 1.0, "max_budget": 5.0}}
        if url.endswith("/health/liveliness"):
            return {}
        return None

    monkeypatch.setattr(m, "_get_json", fake_get_json)

    resp = client.get("/admin/llm/status", headers=_headers(ADMIN))
    assert resp.status_code == 200
    body = resp.json()
    names = {mm["name"] for mm in body["models"]}
    assert "sparkpoint-chat-premium" in names  # admin key used → premium visible in the Overview
    assert seen["model_info"] == "Bearer sk-admin"
    assert seen["key_info"] == "Bearer sk-virtual"  # key spend/limits still from the virtual key
    premium = next(mm for mm in body["models"] if mm["name"] == "sparkpoint-chat-premium")
    assert premium["inputCostPerM"] == 0.094  # per-token cost surfaced as per-1M for the Overview


def test_all_deployments_includes_every_alias() -> None:
    # The Config view must show EVERY alias (not just the chat default) so a premium alias appears;
    # `_all_deployments` is unfiltered, unlike the delete-guardrail's `_alias_deployments`.
    from sparkpoint_agent.api.admin_llm import _all_deployments

    def _dep(alias: str, upstream: str, mid: str) -> dict[str, object]:
        return {
            "model_name": alias,
            "litellm_params": {"model": upstream},
            "model_info": {"id": mid},
        }

    model_info = {
        "data": [
            _dep("sparkpoint-chat", "openrouter/nvidia/x:free", "a"),
            _dep("sparkpoint-chat-premium", "openrouter/deepseek/deepseek-v4-flash", "b"),
            _dep("sparkpoint-chat-premium", "openrouter/qwen/qwen3.5-flash-02-23", "c"),
        ]
    }
    deps = _all_deployments(model_info)
    assert {d["model_name"] for d in deps} == {"sparkpoint-chat", "sparkpoint-chat-premium"}
    premium = [d["upstream"] for d in deps if d["model_name"] == "sparkpoint-chat-premium"]
    assert "openrouter/deepseek/deepseek-v4-flash" in premium


def test_aggregate_logs_sums_by_model_and_filters_window() -> None:
    # Spend stats come from /spend/logs (the report endpoint is Enterprise-gated); this sums the
    # per-call feed by model, dropping calls before `since` and any without a numeric spend.
    from datetime import UTC, datetime

    from sparkpoint_agent.api.admin_llm import _aggregate_logs, _cost_per_m

    since = datetime(2026, 7, 1, tzinfo=UTC)
    logs = [
        {"model": "deepseek", "spend": 0.001, "startTime": "2026-07-10T00:00:00Z"},
        {"model": "deepseek", "spend": 0.002, "startTime": "2026-07-11T00:00:00Z"},
        {"model": "qwen", "spend": 0.0005, "startTime": "2026-07-12T00:00:00Z"},
        {"model": "old", "spend": 9.0, "startTime": "2026-06-30T00:00:00Z"},  # before window
        {"model": "bad", "spend": None, "startTime": "2026-07-12T00:00:00Z"},  # no spend
    ]
    total, by_model = _aggregate_logs(logs, since)
    assert round(total, 4) == 0.0035  # 'old' excluded, 'bad' skipped
    assert by_model[0] == {"model": "deepseek", "spend": 0.003}  # ranked desc
    assert _cost_per_m(1e-07) == 0.1  # per-token -> per-1M
    assert _cost_per_m(None) is None
