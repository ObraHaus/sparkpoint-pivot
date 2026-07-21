# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Admin tier-limits config endpoints (api/admin_limits.py, feature 008 US2) — stores MOCKED.

Assert the config contract through the app + middleware:
  - a NON-admin gets 404 (never 403) on every /admin/limits route (must not learn it exists);
  - an admin can list tiers and update inclusion values (effective on the next read, audited);
  - a zero chat allowance on the DEFAULT tier is rejected 400 (never strand the assistant, FR-008);
  - an unknown tier is 404; grant/revoke work and are audited; an unknown tier on grant is 400.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.quota import get_limits_store

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"
USER = "0x1111111111111111111111111111111111111111"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


def _tier(name: str, *, default: bool, chat: int) -> dict[str, Any]:
    return {
        "tier": name,
        "displayName": name.title(),
        "chatDailyLimit": chat,
        "recsDailyLimit": 10,
        "onboardingDailyLimit": 20,
        "concurrency": 1,
        "priorityWeight": 1,
        "modelAlias": "sparkpoint-chat",
        "isDefault": default,
    }


class _FakeAdmin:
    def __init__(self, admins: set[str]) -> None:
        self.admins = admins

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admins


class _FakeLimits:
    def __init__(self) -> None:
        self.tiers: dict[str, dict[str, Any]] = {
            "free": _tier("free", default=True, chat=40),
            "premium": _tier("premium", default=False, chat=400),
        }
        self.assignments: dict[str, str] = {}
        self.audit: list[tuple[str, str, str | None]] = []

    async def get_tiers(self) -> list[dict[str, Any]]:
        return list(self.tiers.values())

    async def get_tier(self, tier: str) -> dict[str, Any] | None:
        return self.tiers.get(tier.strip().lower())

    async def upsert_tier(
        self,
        tier: str,
        *,
        display_name: str,
        chat_daily_limit: int,
        recs_daily_limit: int,
        onboarding_daily_limit: int,
        concurrency: int,
        priority_weight: int,
        model_alias: str,
        actor: str | None,
    ) -> None:
        t = tier.strip().lower()
        if t not in self.tiers:
            raise KeyError(t)
        if self.tiers[t]["isDefault"] and chat_daily_limit <= 0:
            raise ValueError("The default tier's chat allowance must be greater than 0 (strand).")
        self.tiers[t].update(
            displayName=display_name,
            chatDailyLimit=chat_daily_limit,
            recsDailyLimit=recs_daily_limit,
            onboardingDailyLimit=onboarding_daily_limit,
            concurrency=concurrency,
            priorityWeight=priority_weight,
            modelAlias=model_alias,
        )
        self.audit.append(("tier_update", t, actor))

    async def assign(
        self, address: str, tier: str, *, actor: str | None, source: str = "admin"
    ) -> None:
        self.assignments[address.lower()] = tier.strip().lower()
        self.audit.append(("grant", address.lower(), actor))

    async def revoke(self, address: str, *, actor: str | None) -> None:
        self.assignments.pop(address.lower(), None)
        self.audit.append(("revoke", address.lower(), actor))

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        return [
            {"action": a, "subject": s, "actor": ac, "detail": {}, "at": "2026-01-01T00:00:00Z"}
            for (a, s, ac) in reversed(self.audit)
        ][:limit]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, _FakeLimits]]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    limits = _FakeLimits()
    admin_store = _FakeAdmin({ADMIN.lower()})
    app.dependency_overrides[get_allowlist_store] = lambda: admin_store
    app.dependency_overrides[get_limits_store] = lambda: limits
    try:
        yield TestClient(app), limits
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)
        app.dependency_overrides.pop(get_limits_store, None)


def _valid_update(tier: str, chat: int) -> dict[str, Any]:
    t = _tier(tier, default=False, chat=chat)
    del t["isDefault"]
    return t


def test_non_admin_gets_404_not_403(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, _ = ctx
    assert client.get("/admin/limits/tiers", headers=_headers(STRANGER)).status_code == 404
    r = client.post(
        "/admin/limits/tiers/revoke", headers=_headers(STRANGER), json={"address": USER}
    )
    assert r.status_code == 404


def test_admin_lists_tiers(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, _ = ctx
    r = client.get("/admin/limits/tiers", headers=_headers(ADMIN))
    assert r.status_code == 200
    assert {t["tier"] for t in r.json()["tiers"]} == {"free", "premium"}


def test_admin_updates_tier_and_audits(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, store = ctx
    r = client.post(
        "/admin/limits/tiers", headers=_headers(ADMIN), json=_valid_update("premium", 500)
    )
    assert r.status_code == 200
    assert store.tiers["premium"]["chatDailyLimit"] == 500  # effective for the next read
    assert [a[0] for a in store.audit] == ["tier_update"]


def test_zero_chat_on_default_is_rejected(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, store = ctx
    r = client.post("/admin/limits/tiers", headers=_headers(ADMIN), json=_valid_update("free", 0))
    assert r.status_code == 400
    assert store.tiers["free"]["chatDailyLimit"] == 40  # unchanged
    assert store.audit == []


def test_unknown_tier_is_404(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, _ = ctx
    r = client.post("/admin/limits/tiers", headers=_headers(ADMIN), json=_valid_update("gold", 5))
    assert r.status_code == 404


def test_grant_and_revoke_are_audited(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, store = ctx
    g = client.post(
        "/admin/limits/tiers/assign",
        headers=_headers(ADMIN),
        json={"address": USER, "tier": "premium"},
    )
    assert g.status_code == 200 and store.assignments[USER.lower()] == "premium"
    v = client.post("/admin/limits/tiers/revoke", headers=_headers(ADMIN), json={"address": USER})
    assert v.status_code == 200 and USER.lower() not in store.assignments
    assert [a[0] for a in store.audit] == ["grant", "revoke"]


def test_grant_unknown_tier_is_400(ctx: tuple[TestClient, _FakeLimits]) -> None:
    client, _ = ctx
    r = client.post(
        "/admin/limits/tiers/assign",
        headers=_headers(ADMIN),
        json={"address": USER, "tier": "gold"},
    )
    assert r.status_code == 400
