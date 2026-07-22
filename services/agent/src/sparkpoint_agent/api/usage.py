"""Self-scoped usage read (feature 008, US6).

``GET /usage/self`` returns the CALLER's own allowance usage this period (tier + per-metric
used/limit/remaining + reset), keyed on the verified ``X-Owner``. NOT admin-gated — a wallet may
always read its OWN usage (mirrors ``GET /allowlist/status``); it can never read another wallet's.

Advisory-compute telemetry only; never a signable artifact, never the withdraw path (N2).
Honest-degrade: if the limits source is unavailable (0015 not applied), it reports the free
defaults with ``configured: false`` rather than erroring.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends

from ..db import LimitsStore
from .quota import get_limits_store, window_start
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["usage"])

_METRICS: dict[str, str] = {
    "chat": "chatDailyLimit",
    "recs": "recsDailyLimit",
    "onboarding": "onboardingDailyLimit",
}


@router.get("/usage/self")
async def usage_self(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """The caller's own allowance usage this period (tier + per-metric used/limit/remaining)."""
    owner = account.owner
    try:
        tier = await store.resolve_tier(owner)
        tier_def = await store.get_tier(tier)
        ws = window_start()
        expiry = await store.resolve_expiry(owner)
        metrics = []
        for metric, field in _METRICS.items():
            limit = int(tier_def[field]) if tier_def else 0
            used = await store.get_usage(owner, metric, ws)
            metrics.append(
                {"metric": metric, "used": used, "limit": limit, "remaining": max(0, limit - used)}
            )
        return {
            "configured": tier_def is not None,
            "tier": tier,
            "expiresAt": expiry.isoformat() if expiry else None,
            "resetAt": (ws + timedelta(days=1)).isoformat(),
            "metrics": metrics,
        }
    except Exception:
        return {"configured": False, "tier": "free", "metrics": []}
