# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Admin user-analytics (api/admin_analytics.py + db/analytics.py) — DB mocked.

Assert the contract:
  - the onboarding funnel is CUMULATIVE (a later state counts toward every earlier step);
  - real cohort aggregates (total, activation, DAU/MAU, risk mix, leaderboard) are computed, and the
    leaderboard is pseudonymized (`user_<4hex>`, never a full wallet) with recs-accepted joined;
  - a NON-admin gets 404 (never 403);
  - an unavailable DB honest-degrades to {configured: false} (never fabricated numbers).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.admin_analytics import get_analytics_store
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.db.analytics import AnalyticsStore, build_funnel, pseudonymize

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


class _FakeAdmin:
    def __init__(self, admins: set[str]) -> None:
        self.admins = admins

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admins


class _FakeDb:
    """Dispatches by query fragment — a tiny stand-in for the real asyncpg Database."""

    def __init__(self, *, raise_all: bool = False) -> None:
        self.raise_all = raise_all

    async def fetchval(self, query: str, *args: Any) -> Any:
        if self.raise_all:
            raise RuntimeError("db down")
        if "count(*) FROM users" in query:
            return 3
        if "count(DISTINCT lower(decoded->>'owner'))" in query:
            return 1
        if "FROM subscriptions" in query:
            return 1
        return 0

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if self.raise_all:
            raise RuntimeError("db down")
        if "GROUP BY onboarding_state" in query:
            return [
                {"state": "active", "cnt": 1},
                {"state": "mandated", "cnt": 1},
                {"state": "wallet_connected", "cnt": 1},
            ]
        if "FROM mandates" in query:
            return [{"tier": "conservative", "cnt": 2}, {"tier": "growth", "cnt": 1}]
        if "GROUP BY lower(decoded->>'owner')" in query:
            return [{"owner": "0xabcd000000000000000000000000000000000001", "net": 5_000000}]
        if "LEFT JOIN recommendations" in query:
            return [
                {
                    "eoa": "0xeoa0000000000000000000000000000000000001",
                    "sa": "0xabcd000000000000000000000000000000000001",
                    "accepted": 2,
                }
            ]
        return []

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if self.raise_all:
            raise RuntimeError("db down")
        if "usage_counters" in query:
            return {"dau": 1, "mau": 2}
        return None


# ── pure funnel logic ────────────────────────────────────────────────────────


def test_build_funnel_is_cumulative() -> None:
    # 1 user at each of wallet_connected / mandated / active.
    funnel = build_funnel({"active": 1, "mandated": 1, "wallet_connected": 1})
    counts = {f["step"]: f["count"] for f in funnel}
    assert counts == {
        "Prospective": 3,       # everyone is at least prospective
        "Wallet connected": 3,  # all three reached >= wallet_connected
        "Account ready": 2,     # only mandated + active
        "Mandated": 2,
        "Active": 1,
    }


def test_pseudonymize_never_leaks_full_address() -> None:
    ref = pseudonymize("0xABCD000000000000000000000000000000000001")
    assert ref == "user_abcd"
    assert "0xABCD" not in ref and pseudonymize(None) == "user_????"


# ── store aggregation ────────────────────────────────────────────────────────


async def test_user_analytics_computes_real_aggregates() -> None:
    body = await AnalyticsStore(_FakeDb()).user_analytics()  # type: ignore[arg-type]
    assert body["configured"] is True
    assert body["totalUsers"] == 3
    assert [f["count"] for f in body["funnel"]] == [3, 3, 2, 2, 1]
    assert body["activation"] == {"deposited": 1, "pct": 33.3}
    assert body["onboardingCompletionPct"] == 66.7
    assert body["activity"] == {"dau": 1, "mau": 2, "stickinessPct": 50.0}
    assert body["premiumActive"] == 1
    tiers = {t["tier"]: t["pct"] for t in body["riskTiers"]}
    assert tiers == {"conservative": 66.7, "growth": 33.3}
    # leaderboard: pseudonymized, net in USDC, recs joined via the smart-account address
    top = body["topUsers"][0]
    assert top == {"ref": "user_abcd", "netDepositedUsdc": 5.0, "recsAccepted": 2}


async def test_user_analytics_honest_degrades_on_db_error() -> None:
    body = await AnalyticsStore(_FakeDb(raise_all=True)).user_analytics()  # type: ignore[arg-type]
    assert body == {"configured": False}  # never fabricated numbers


# ── router admin-gating ──────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    app.dependency_overrides[get_allowlist_store] = lambda: _FakeAdmin({ADMIN.lower()})
    app.dependency_overrides[get_analytics_store] = lambda: AnalyticsStore(_FakeDb())  # type: ignore[arg-type]
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_allowlist_store, None)
        app.dependency_overrides.pop(get_analytics_store, None)


def test_non_admin_gets_404(client: TestClient) -> None:
    assert client.get("/admin/users/analytics", headers=_headers(STRANGER)).status_code == 404


def test_admin_gets_real_analytics(client: TestClient) -> None:
    r = client.get("/admin/users/analytics", headers=_headers(ADMIN))
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True and body["totalUsers"] == 3
    assert body["topUsers"][0]["ref"] == "user_abcd"  # pseudonymized in the wire response
