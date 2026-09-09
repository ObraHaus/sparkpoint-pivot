# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Self-scoped usage read (api/usage.py, feature 008 US6) — store MOCKED.

  - GET /usage/self returns the caller's own tier + used/limit/remaining (self-scoped, not admin);
  - an unavailable data source honest-degrades to {configured: false} with free defaults.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.quota import get_limits_store

TOKEN = "test-web-tier-token"
USER = "0x1111111111111111111111111111111111111111"


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


class _FakeLimits:
    def __init__(self, *, tier_def: dict[str, Any] | None, usage: int, raise_on: str | None = None):
        self.tier_def = tier_def
        self.usage = usage
        self.raise_on = raise_on

    async def resolve_tier(self, owner: str) -> str:
        if self.raise_on == "resolve":
            raise RuntimeError("db down")
        return "premium" if self.tier_def and self.tier_def.get("premium") else "free"

    async def resolve_expiry(self, owner: str) -> object | None:
        return None

    async def resolve_tier_source(self, owner: str) -> dict[str, Any]:
        """043 — mirrors the real store: the tier AND which source is paying for it."""
        if self.raise_on == "resolve":
            raise RuntimeError("db down")
        tier = "premium" if self.tier_def and self.tier_def.get("premium") else "free"
        return {
            "tier": tier,
            "source": "stored" if tier == "premium" else None,
            "expiresAt": None,
            "tokenId": None,
        }

    async def get_tier(self, tier: str) -> dict[str, Any] | None:
        return self.tier_def

    async def get_usage(self, owner: str, metric: str, window: datetime) -> int:
        return self.usage


def _override(fake: _FakeLimits) -> Iterator[TestClient]:
    app.dependency_overrides[get_limits_store] = lambda: fake
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_limits_store, None)


@pytest.fixture(autouse=True)
def _token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)


def test_self_usage_reports_own_used_limit_remaining() -> None:
    fake = _FakeLimits(
        tier_def={"chatDailyLimit": 40, "recsDailyLimit": 10, "onboardingDailyLimit": 20},
        usage=7,
    )
    for client in _override(fake):
        r = client.get("/usage/self", headers=_headers(USER))
        assert r.status_code == 200
        body = r.json()
        assert body["configured"] is True and body["tier"] == "free"
        chat = next(m for m in body["metrics"] if m["metric"] == "chat")
        assert chat == {"metric": "chat", "used": 7, "limit": 40, "remaining": 33}
        assert "resetAt" in body


def test_self_usage_honest_degrades_when_source_unavailable() -> None:
    fake = _FakeLimits(tier_def=None, usage=0, raise_on="resolve")
    for client in _override(fake):
        r = client.get("/usage/self", headers=_headers(USER))
        assert r.status_code == 200
        assert r.json() == {"configured": False, "tier": "free", "metrics": []}


def test_self_usage_names_which_source_is_paying_for_premium() -> None:
    """043 FR-005 — the Premium page has to be able to say WHY access is on, and what ends it.

    The failure mode this prevents is a holder whose access stops and who cannot tell whether a
    subscription lapsed or a broker was transferred.
    """
    fake = _FakeLimits(
        tier_def={"premium": True, "chatDailyLimit": 400, "recsDailyLimit": 100,
                  "onboardingDailyLimit": 100},
        usage=0,
    )
    for client in _override(fake):
        body = client.get("/usage/self", headers=_headers(USER)).json()
        assert body["tier"] == "premium"
        assert body["premiumSource"] == "stored"
        assert body["brokerTokenId"] is None


def test_a_broker_sourced_premium_reports_the_token_and_no_expiry() -> None:
    """A broker-derived tier ends on TRANSFER, not on a date — so it must never carry one."""

    class _BrokerLimits(_FakeLimits):
        async def resolve_tier_source(self, owner: str) -> dict[str, Any]:
            return {"tier": "premium", "source": "broker", "expiresAt": None, "tokenId": 4}

    fake = _BrokerLimits(
        tier_def={"premium": True, "chatDailyLimit": 400, "recsDailyLimit": 100,
                  "onboardingDailyLimit": 100},
        usage=0,
    )
    for client in _override(fake):
        body = client.get("/usage/self", headers=_headers(USER)).json()
        assert body["premiumSource"] == "broker"
        assert body["brokerTokenId"] == 4
        assert body["expiresAt"] is None, "no fabricated expiry for something that ends on transfer"
