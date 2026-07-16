"""§B admin LLM-gateway view — models / virtual-key spend + limits, admin-gated.

Backs the admin panel's "LLM gateway" page. Reads the LiteLLM proxy using the VIRTUAL key the
agent already holds (``LITELLM_API_KEY``) — no master key is placed here:
  * ``GET {base}/health/liveliness`` — reachability;
  * ``GET {base}/model/info``        — the configured models;
  * ``GET {base}/key/info``          — the virtual key's spend / budget / rpm+tpm limits.

Every upstream call is best-effort (wrapped, short timeout): a field the gateway version doesn't
expose degrades to ``null`` rather than 500-ing the panel. Admin-gated (caller's X-Owner ∈ admin);
a non-admin gets 404 (same invisible posture as the allowlist admin routes). Read-only — this
never mutates gateway config and never touches custody.
"""

from __future__ import annotations

import os
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends

from .allowlist import require_admin
from .security import AccountContext

router = APIRouter(tags=["admin-llm"])

_TIMEOUT_S = 4.0
DEFAULT_ALIAS = "sparkpoint-chat"


def _gateway() -> tuple[str, str | None] | None:
    """Return ``(base_root, api_key)`` for the configured gateway, or ``None`` if unconfigured."""
    base = os.getenv("LITELLM_BASE_URL")
    if not base:
        return None
    root = base.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3].rstrip("/")
    return root, os.getenv("LITELLM_API_KEY")


async def _get_json(client: httpx.AsyncClient, url: str, headers: dict[str, str]) -> Any | None:
    try:
        resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


def _parse_models(payload: Any) -> list[dict[str, str]]:
    """Best-effort extraction of ``[{name, upstream}]`` from a /model/info response."""
    models: list[dict[str, str]] = []
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return models
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("model_name") or "")
        params = item.get("litellm_params") if isinstance(item.get("litellm_params"), dict) else {}
        upstream = str(params.get("model") or "") if isinstance(params, dict) else ""
        if name:
            models.append({"name": name, "upstream": upstream})
    return models


def _parse_key_info(payload: Any) -> dict[str, Any] | None:
    """Best-effort extraction of the virtual key's spend/budget/limits from /key/info."""
    if not isinstance(payload, dict):
        return None
    info = payload.get("info") if isinstance(payload.get("info"), dict) else payload
    if not isinstance(info, dict):
        return None
    keys = ("spend", "max_budget", "tpm_limit", "rpm_limit", "budget_duration", "budget_reset_at")
    picked = {k: info.get(k) for k in keys if k in info}
    return picked or None


@router.get("/admin/llm/status")
async def admin_llm_status(
    admin: Annotated[AccountContext, Depends(require_admin)],
) -> dict[str, Any]:
    """Admin-gated LLM-gateway status: reachability, models, and virtual-key spend/limits."""
    gw = _gateway()
    if gw is None:
        return {"configured": False, "reachable": False, "models": [], "key": None}
    root, api_key = gw
    headers = {"accept": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        live = await _get_json(client, f"{root}/health/liveliness", {})
        model_info = await _get_json(client, f"{root}/model/info", headers)
        key_info = await _get_json(client, f"{root}/key/info", headers)

    return {
        "configured": True,
        "base": root,
        "reachable": live is not None,
        "modelAlias": os.getenv("LITELLM_MODEL", DEFAULT_ALIAS),
        "models": _parse_models(model_info),
        "key": _parse_key_info(key_info),
    }
