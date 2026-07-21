"""Admin-gated usage & limits monitoring (feature 008, US3).

Surfaces the REAL per-tier consumption, top consumers, and throttle/deny rate the limits engine
produces — from ``usage_counters`` (allow volume) + ``limits_event`` (deny/throttle feed). No
prompt/message content is ever stored or shown; wallets are MASKED (6…4). Admin-gated (404 to a
non-admin). Honest-degrade: if the limits data source is unavailable (0015 not applied), each
route returns ``{configured: false}`` rather than fabricated numbers (mirrors ``admin_uptime``).

Advisory-compute telemetry only; never a signable artifact, never the withdraw path (N2).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..db import LimitsStore
from .allowlist import require_admin
from .quota import get_limits_store, window_start
from .security import AccountContext

router = APIRouter(tags=["admin-usage"])


def _mask(address: str) -> str:
    a = address or ""
    return f"{a[:6]}…{a[-4:]}" if len(a) >= 10 else a


@router.get("/admin/usage/summary")
async def usage_summary(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """Per-tier consumption + throttle/deny rate for the current window (admin-gated)."""
    try:
        ws = window_start()
        by_tier = await store.usage_by_tier(ws)
        counts = await store.event_counts(ws)
        turns = sum(t["turns"] for t in by_tier)
        deny = counts.get("deny", 0)
        throttle = counts.get("throttle", 0)
        total = turns + deny + throttle
        rate = (deny + throttle) / total if total else 0.0
        return {
            "configured": True,
            "window": ws.isoformat(),
            "byTier": by_tier,
            "totals": {"turns": turns, "deny": deny, "throttle": throttle},
            "throttleRate": round(rate, 4),
        }
    except Exception:
        return {"configured": False}


@router.get("/admin/usage/top")
async def usage_top(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
    limit: int = 10,
) -> dict[str, object]:
    """The heaviest consumers this window (masked wallets), admin-gated."""
    try:
        consumers = await store.top_consumers(window_start(), limit)
        return {
            "configured": True,
            "consumers": [
                {"subject": _mask(c["address"]), "tier": c["tier"], "turns": c["turns"]}
                for c in consumers
            ],
        }
    except Exception:
        return {"configured": False}


@router.get("/admin/usage/events")
async def usage_events(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
    limit: int = 25,
) -> dict[str, object]:
    """The most-recent deny/throttle decisions (masked subject, no content), admin-gated."""
    try:
        return {"configured": True, "events": await store.recent_events(limit)}
    except Exception:
        return {"configured": False}
