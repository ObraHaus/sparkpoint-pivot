"""Admin user-analytics endpoint — REAL cohort metrics for the /admin/users + stakeholder views.

Admin-gated (404 to a non-admin). Every figure is computed live from the app's own tables (see
``db/analytics.py``); an unavailable DB honest-degrades to ``{configured: false}`` rather than a
fabricated number (mirrors ``admin_usage``). Wallets are pseudonymized. Advisory telemetry only —
never a signable artifact, never the withdraw path (N2).
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends

from ..db import AnalyticsStore, Database, get_database
from .allowlist import require_admin
from .security import AccountContext

router = APIRouter(tags=["admin-analytics"])


def get_analytics_store() -> AnalyticsStore:
    """Resolve the analytics store; if the DB isn't configured, hand back a store whose reads
    honest-degrade to ``{configured: false}`` rather than raising."""
    try:
        return AnalyticsStore(get_database())
    except Exception:
        return AnalyticsStore(cast(Database, None))


@router.get("/admin/users/analytics")
async def users_analytics(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AnalyticsStore, Depends(get_analytics_store)],
) -> dict[str, object]:
    """Real cohort analytics: total users, onboarding funnel, activation, DAU/MAU, risk-tier mix,
    active premium, and a pseudonymized top-depositors leaderboard."""
    return await store.user_analytics()
