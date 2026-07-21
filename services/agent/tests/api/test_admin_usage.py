# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Admin usage/limits monitoring (api/admin_usage.py, feature 008 US3) — stores MOCKED.

Assert the monitoring contract:
  - a NON-admin gets 404 (never 403);
  - the summary reports real per-tier turns + a computed throttle/deny rate;
  - top consumers are MASKED (6…4), never full wallets;
  - an unavailable data source honest-degrades to {configured: false} (never fabricated numbers).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.quota import get_limits_store

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"
WALLET = "0xabc0000000000000000000000000000000000001"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeAdmin:
    def __init__(self, admins: set[str]) -> None:
        self.admins = admins

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admins


class _FakeUsage:
    def __init__(self, *, raise_on: str | None = None) -> None:
        self.raise_on = raise_on

    async def usage_by_tier(self, window_start: datetime) -> list[dict[str, Any]]:
        if self.raise_on == "summary":
            raise RuntimeError("db down")
        return [
            {"tier": "free", "wallets": 3, "turns": 30},
            {"tier": "premium", "wallets": 1, "turns": 5},
        ]

    async def event_counts(self, since: datetime) -> dict[str, int]:
        return {"deny": 5}

    async def top_consumers(self, window_start: datetime, limit: int = 10) -> list[dict[str, Any]]:
        return [{"address": WALLET, "tier": "free", "turns": 20}]

    async def recent_events(self, limit: int = 25) -> list[dict[str, Any]]:
        return [
            {"verdict": "deny", "metric": "chat", "tier": "free", "subject": "0xabc0…0001",
             "at": "2026-01-01T00:00:00Z"}
        ]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, _FakeUsage]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    usage = _FakeUsage()
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAdmin({ADMIN.lower()})
    app.dependency_overrides[get_limits_store] = lambda: usage
    try:
        yield TestClient(app), usage
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)
        app.dependency_overrides.pop(get_limits_store, None)


def test_non_admin_gets_404(ctx: tuple[TestClient, _FakeUsage]) -> None:
    client, _ = ctx
    assert client.get("/admin/usage/summary", headers=_headers(STRANGER)).status_code == 404


def test_summary_reports_turns_and_throttle_rate(ctx: tuple[TestClient, _FakeUsage]) -> None:
    client, _ = ctx
    r = client.get("/admin/usage/summary", headers=_headers(ADMIN))
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert body["totals"] == {"turns": 35, "deny": 5, "throttle": 0}
    assert body["throttleRate"] == pytest.approx(5 / 40)  # deny / (turns + deny)


def test_top_consumers_are_masked(ctx: tuple[TestClient, _FakeUsage]) -> None:
    client, _ = ctx
    r = client.get("/admin/usage/top", headers=_headers(ADMIN))
    assert r.status_code == 200
    subject = r.json()["consumers"][0]["subject"]
    assert subject == "0xabc0…0001" and WALLET not in subject  # masked, never the full wallet


def test_summary_honest_degrades_when_source_unavailable(
    ctx: tuple[TestClient, _FakeUsage],
) -> None:
    client, usage = ctx
    usage.raise_on = "summary"
    r = client.get("/admin/usage/summary", headers=_headers(ADMIN))
    assert r.status_code == 200
    assert r.json() == {"configured": False}  # never fabricated numbers
