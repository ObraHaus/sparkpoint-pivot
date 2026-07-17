"""§B4 admin uptime view — the SparkPoint develop monitors from Uptime Kuma, admin-gated.

A LAN Kuma iframe is impossible (the browser can't reach the LAN Kuma, and its admin UI is
websocket-based), so — mirroring ``admin_llm`` — the agent reads Kuma's PUBLIC status-page JSON
(server-side, ``KUMA_URL`` in the agent env ONLY) and the web renders it in an admin tab. Every
route is admin-gated (non-admin → 404). Read-only telemetry; no custody (N2). Degrades honestly to
``configured:false`` when ``KUMA_URL`` is unset or Kuma is unreachable — never 500s the panel.
"""

from __future__ import annotations

import os
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends

from .allowlist import require_admin
from .security import AccountContext

router = APIRouter(tags=["admin-uptime"])

_TIMEOUT_S = 4.0
_STATUS = {0: "down", 1: "up", 2: "pending", 3: "maintenance"}


def _kuma() -> tuple[str, str] | None:
    base = (os.getenv("KUMA_URL") or "").strip().rstrip("/")
    if not base:
        return None
    return base, (os.getenv("KUMA_STATUS_SLUG") or "sparkpoint").strip()


async def _get_json(client: httpx.AsyncClient, url: str) -> Any | None:
    try:
        resp = await client.get(url)
        return resp.json() if resp.status_code == 200 else None
    except Exception:
        return None


def _monitors_from(page: Any, beats: Any) -> list[dict[str, Any]]:
    """Merge the status-page config (names/ids) with the heartbeat feed (status/uptime)."""
    groups = page.get("publicGroupList") if isinstance(page, dict) else None
    hb = beats.get("heartbeatList") if isinstance(beats, dict) else {}
    up = beats.get("uptimeList") if isinstance(beats, dict) else {}
    hb = hb if isinstance(hb, dict) else {}
    up = up if isinstance(up, dict) else {}
    out: list[dict[str, Any]] = []
    if not isinstance(groups, list):
        return out
    for group in groups:
        for mon in (group.get("monitorList") or []) if isinstance(group, dict) else []:
            if not isinstance(mon, dict):
                continue
            mid = mon.get("id")
            recent = hb.get(str(mid)) or hb.get(mid) or []
            last = recent[-1] if isinstance(recent, list) and recent else {}
            raw_status = last.get("status") if isinstance(last, dict) else None
            status_code = raw_status if isinstance(raw_status, int) else -1
            out.append(
                {
                    "name": str(mon.get("name") or f"monitor {mid}"),
                    "status": _STATUS.get(status_code, "unknown"),
                    "up": status_code == 1,
                    "ping": (last.get("ping") if isinstance(last, dict) else None),
                    "message": (last.get("msg") if isinstance(last, dict) else None),
                    "uptime24h": up.get(f"{mid}_24"),
                }
            )
    return out


@router.get("/admin/uptime")
async def admin_uptime(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """The 5 develop monitors' live status + 24h uptime, read from Kuma's public status page."""
    kuma = _kuma()
    if kuma is None:
        return {"configured": False, "monitors": [], "statusPageUrl": None}
    base, slug = kuma
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        page = await _get_json(client, f"{base}/api/status-page/{slug}")
        beats = await _get_json(client, f"{base}/api/status-page/heartbeat/{slug}")
    monitors = _monitors_from(page, beats)
    return {
        "configured": True,
        "reachable": page is not None or beats is not None,
        "monitors": monitors,
        # LAN-only convenience link (only reachable from the ops network).
        "statusPageUrl": f"{base}/status/{slug}",
    }
