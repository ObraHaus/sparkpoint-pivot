"""Admin user-analytics — REAL cohort aggregates computed live from the app's own tables.

Sources (no fabricated numbers; a sparse testnet yields honest zeros, never a made-up figure):
  * ``users`` / ``onboarding_state``      → total users + the onboarding funnel
  * ``mandates`` (latest confirmed / user) → risk-tier mix
  * ``onchain_events`` (deposit/withdraw)  → per-owner net deposited (leaderboard + activation)
  * ``usage_counters``                     → DAU / MAU (distinct active wallets)
  * ``subscriptions``                      → active premium wallets
  * ``recommendations`` (acted/executed)   → recs accepted per user

Wallets are pseudonymized in the leaderboard (``user_<4hex>``) — no full address, no PII, no message
content. Admin-gated at the router (404 to a non-admin). Honest-degrade: any DB error surfaces as
``{"configured": False}`` rather than a fabricated figure (mirrors ``admin_usage``). Advisory
telemetry only — never a signable artifact, never the withdraw path (N2).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

USDC_DECIMALS = 6

# The onboarding funnel, in order. Each step's count is CUMULATIVE (everyone at a later state also
# passed the earlier ones). ``suspended`` counts as having reached 'mandated', not 'active'.
_FUNNEL_STEPS: list[tuple[str, int]] = [
    ("Prospective", 0),
    ("Wallet connected", 1),
    ("Account ready", 2),
    ("Mandated", 3),
    ("Active", 4),
]
_STATE_RANK: dict[str, int] = {
    "prospective": 0,
    "wallet_connected": 1,
    "account_ready": 2,
    "mandated": 3,
    "active": 4,
    "suspended": 3,
}

_TOTAL_USERS_SQL = "SELECT count(*) FROM users"
_STATE_COUNTS_SQL = (
    "SELECT onboarding_state::text AS state, count(*) AS cnt FROM users GROUP BY onboarding_state"
)
_DEPOSITORS_SQL = (
    "SELECT count(DISTINCT lower(decoded->>'owner')) FROM onchain_events "
    "WHERE decoded->>'kind' = 'deposit'"
)
_RISK_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (user_id) user_id, risk_tier
  FROM mandates WHERE status = 'confirmed'
  ORDER BY user_id, version DESC
)
SELECT risk_tier::text AS tier, count(*) AS cnt FROM latest GROUP BY risk_tier
""".strip()
_ACTIVITY_SQL = """
SELECT
  count(DISTINCT address) FILTER (WHERE window_start >= now() - interval '24 hours') AS dau,
  count(DISTINCT address) FILTER (WHERE window_start >= now() - interval '30 days') AS mau
FROM usage_counters
""".strip()
_PREMIUM_SQL = "SELECT count(DISTINCT wallet) FROM subscriptions WHERE expires_at > now()"
_LEADERBOARD_SQL = """
SELECT owner, net FROM (
  SELECT lower(decoded->>'owner') AS owner,
    COALESCE(SUM((decoded->>'assets')::numeric) FILTER (WHERE decoded->>'kind' = 'deposit'), 0)
    - COALESCE(SUM((decoded->>'assets')::numeric) FILTER (WHERE decoded->>'kind' = 'withdraw'), 0)
      AS net
  FROM onchain_events
  WHERE decoded->>'kind' IN ('deposit', 'withdraw')
  GROUP BY lower(decoded->>'owner')
) t
WHERE net > 0
ORDER BY net DESC
LIMIT $1
""".strip()
_RECS_BY_USER_SQL = """
SELECT lower(u.eoa_address) AS eoa,
       lower(u.smart_account_address) AS sa,
       count(r.*) FILTER (WHERE r.status IN ('acted', 'executed')) AS accepted
FROM users u
LEFT JOIN recommendations r ON lower(r.wallet) = lower(u.eoa_address)
GROUP BY u.eoa_address, u.smart_account_address
""".strip()


def pseudonymize(addr: str | None) -> str:
    """`0xAbc1…` → `user_abc1` — a stable, non-reversible label. Never the full address."""
    a = (addr or "").lower()
    return f"user_{a[2:6]}" if a.startswith("0x") and len(a) >= 6 else "user_????"


def build_funnel(state_counts: dict[str, int]) -> list[dict[str, Any]]:
    """Cumulative funnel: step N's count = users whose state rank >= N. Pure + unit-tested."""
    ranked: dict[int, int] = {}
    for state, cnt in state_counts.items():
        rnk = _STATE_RANK.get(state, 0)
        ranked[rnk] = ranked.get(rnk, 0) + cnt
    return [
        {"step": step, "count": sum(c for r, c in ranked.items() if r >= rnk)}
        for step, rnk in _FUNNEL_STEPS
    ]


@dataclass
class AnalyticsStore:
    """asyncpg-backed real cohort analytics for the admin Users + Stakeholder views."""

    db: Database

    async def user_analytics(self, *, leaderboard_limit: int = 5) -> dict[str, Any]:
        try:
            total = int(await self.db.fetchval(_TOTAL_USERS_SQL) or 0)
            state_rows = await self.db.fetch(_STATE_COUNTS_SQL)
            state_counts = {str(r["state"]): int(r["cnt"]) for r in state_rows}
            depositors = int(await self.db.fetchval(_DEPOSITORS_SQL) or 0)
            risk_rows = await self.db.fetch(_RISK_SQL)
            act = await self.db.fetchrow(_ACTIVITY_SQL)
            premium = int(await self.db.fetchval(_PREMIUM_SQL) or 0)
            board_rows = await self.db.fetch(_LEADERBOARD_SQL, leaderboard_limit)
            recs_rows = await self.db.fetch(_RECS_BY_USER_SQL)
        except Exception:
            return {"configured": False}

        dau = int(act["dau"] or 0) if act else 0
        mau = int(act["mau"] or 0) if act else 0

        recs_by_addr: dict[str, int] = {}
        for r in recs_rows:
            n = int(r["accepted"] or 0)
            for key in (r["eoa"], r["sa"]):
                if key:
                    recs_by_addr[str(key).lower()] = n

        risk_total = sum(int(r["cnt"]) for r in risk_rows)
        risk_tiers = [
            {
                "tier": str(r["tier"]),
                "count": int(r["cnt"]),
                "pct": round(int(r["cnt"]) / risk_total * 100, 1) if risk_total else 0.0,
            }
            for r in risk_rows
        ]

        mandated = sum(state_counts.get(s, 0) for s in ("mandated", "active", "suspended"))
        top_users = [
            {
                "ref": pseudonymize(row["owner"]),
                "netDepositedUsdc": round(int(row["net"] or 0) / 10**USDC_DECIMALS, 2),
                "recsAccepted": recs_by_addr.get(str(row["owner"] or "").lower(), 0),
            }
            for row in board_rows
        ]

        return {
            "configured": True,
            "totalUsers": total,
            "funnel": build_funnel(state_counts),
            "activation": {
                "deposited": depositors,
                "pct": round(depositors / total * 100, 1) if total else 0.0,
            },
            "onboardingCompletionPct": round(mandated / total * 100, 1) if total else 0.0,
            "activity": {
                "dau": dau,
                "mau": mau,
                "stickinessPct": round(dau / mau * 100, 1) if mau else 0.0,
            },
            "premiumActive": premium,
            "riskTiers": risk_tiers,
            "topUsers": top_users,
        }
