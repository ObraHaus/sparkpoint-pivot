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

import calendar
import os
from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db import get_database
from ..db.gateway_audit import GatewayAuditStore
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .security import AccountContext

router = APIRouter(tags=["admin-llm"])

_TIMEOUT_S = 4.0
_WRITE_TIMEOUT_S = 8.0
DEFAULT_ALIAS = "sparkpoint-chat"

# Field names (any case, anywhere in a nested payload) that carry secret/key material. These are
# DROPPED from anything the gateway returns before it reaches the admin panel or the audit log
# (VR-A3: no key material ever leaves the agent boundary or lands in Postgres).
_SECRET_KEYS = frozenset(
    {
        "api_key",
        "key",
        "master_key",
        "litellm_master_key",
        "token",
        "authorization",
        "aws_secret_access_key",
        "aws_access_key_id",
        "vertex_credentials",
        "openai_api_key",
        "hashed_token",
        "secret",
        "password",
        # URL-shaped fields can carry userinfo/query credentials — drop them from echoed data too.
        "api_base",
        "base_url",
        "url",
    }
)


def _scrub(value: Any) -> Any:
    """Recursively DROP any secret/key-shaped field from a gateway payload (VR-A3).

    Applied to every upstream response before it reaches the panel or the audit log. A key in the
    denylist — or one that merely contains ``secret``/``password``/``token``/``api_key`` — is
    removed entirely rather than masked, so no partial material leaks.
    """
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            lk = str(k).lower()
            fuzzy = any(s in lk for s in ("secret", "password", "token", "api_key"))
            if lk in _SECRET_KEYS or fuzzy:
                continue
            out[k] = _scrub(v)
        return out
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _gateway() -> tuple[str, str | None] | None:
    """Return ``(base_root, api_key)`` for the configured gateway, or ``None`` if unconfigured."""
    base = os.getenv("LITELLM_BASE_URL")
    if not base:
        return None
    root = base.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3].rstrip("/")
    return root, os.getenv("LITELLM_API_KEY")


def _admin_gateway() -> tuple[str, str] | None:
    """Return ``(base_root, admin_key)`` for admin/management calls, or ``None`` if not provisioned.

    Uses the SCOPED ``LITELLM_ADMIN_KEY`` (never the master key — that lives only on the gateway
    container). When it is unset every admin-management route degrades honestly (``adminConfigured:
    false``) instead of falling back to the low-privilege virtual key or 500-ing.
    """
    gw = _gateway()
    admin_key = (os.getenv("LITELLM_ADMIN_KEY") or "").strip()
    if gw is None or not admin_key:
        return None
    return gw[0], admin_key


def _audit_store() -> GatewayAuditStore:
    return GatewayAuditStore(get_database())


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


# ─────────────────────────────────────────────────────────────────────────────
# R3 — configurable gateway: stats / activity / config (view + guarded writes).
# Every route is admin-gated (non-admin → 404), degrades honestly when the scoped admin key is
# unset (``adminConfigured: false``, never 500), and SCRUBS all key material from upstream data.
# ─────────────────────────────────────────────────────────────────────────────


def _alias() -> str:
    return os.getenv("LITELLM_MODEL", DEFAULT_ALIAS)


async def _admin_get(client: httpx.AsyncClient, root: str, path: str, key: str) -> Any | None:
    """Best-effort admin GET (scrubbed). ``None`` on any non-200 / error — the panel degrades."""
    data = await _get_json(client, f"{root}{path}", {"authorization": f"Bearer {key}"})
    return _scrub(data) if data is not None else None


def _unconfigured() -> dict[str, Any]:
    """Shared degrade body when neither the gateway nor the scoped admin key is provisioned."""
    return {"configured": _gateway() is not None, "adminConfigured": False}


def _as_rows(payload: Any) -> list[Any]:
    """A list payload, or its ``data`` list, or ``[]`` — LiteLLM list endpoints vary over both."""
    if isinstance(payload, list):
        return list(payload)
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return list(data)
    return []


def _all_deployments(model_info: Any) -> list[dict[str, Any]]:
    """Every deployment the gateway serves, across ALL aliases (id, name, upstream, rpm, cost).

    Scrubbed. Powers the read view + the per-alias delete guardrail, so every alias — e.g. a premium
    alias — is visible and independently protected from being stranded."""
    out: list[dict[str, Any]] = []
    for item in _as_rows(model_info):
        if not isinstance(item, dict):
            continue
        name = str(item.get("model_name") or "")
        if not name:
            continue
        raw_info = item.get("model_info")
        info = raw_info if isinstance(raw_info, dict) else {}
        raw_params = item.get("litellm_params")
        params = raw_params if isinstance(raw_params, dict) else {}
        out.append(
            {
                "id": str(info.get("id") or item.get("id") or ""),
                "model_name": name,
                "upstream": str(params.get("model") or ""),
                "rpm": params.get("rpm"),
                "inputCostPerM": _cost_per_m(
                    info.get("input_cost_per_token") or params.get("input_cost_per_token")
                ),
                "outputCostPerM": _cost_per_m(
                    info.get("output_cost_per_token") or params.get("output_cost_per_token")
                ),
            }
        )
    return out


def _cost_per_m(raw: Any) -> float | None:
    """A per-token cost (USD) as USD per 1M tokens, or ``None`` (0 stays 0 = free/unknown)."""
    if raw is None:
        return None
    try:
        return round(float(raw) * 1_000_000, 6)
    except (TypeError, ValueError):
        return None


@router.get("/admin/llm/stats")
async def admin_llm_stats(
    admin: Annotated[AccountContext, Depends(require_admin)],
) -> dict[str, Any]:
    """Spend/usage aggregates (admin-key required). Degrades to ``adminConfigured:false``.

    By-model + monthly figures are aggregated from ``/spend/logs`` (the non-Enterprise per-call
    feed; ``/global/spend/report`` is Enterprise-gated), so they reflect a recent window of calls.
    The all-time total is ``/global/spend``; the current key spend/budget is ``/key/info``.
    """
    admin_gw = _admin_gateway()
    if admin_gw is None:
        return _unconfigured()
    root, key = admin_gw
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        spend = await _admin_get(client, root, "/global/spend", key)
        logs = await _admin_get(client, root, "/spend/logs?limit=1000", key)
        key_info = await _admin_get(client, root, "/key/info", key)
    total = spend.get("spend") if isinstance(spend, dict) else None
    month_to_date, by_model = _aggregate_logs(logs, month_start)
    day = now.day
    projected = round(month_to_date / day * days_in_month, 4) if day and month_to_date else None
    key_parsed = _parse_key_info(key_info)
    budget_used_pct = None
    if key_parsed:
        mb, sp = key_parsed.get("max_budget"), key_parsed.get("spend")
        if isinstance(mb, int | float) and mb > 0 and isinstance(sp, int | float):
            budget_used_pct = round(sp / mb * 100, 1)
    return {
        "configured": True,
        "adminConfigured": True,
        "total_spend": total,
        "by_model": by_model,
        "monthToDate": round(month_to_date, 4),
        "projectedMonthly": projected,
        "spendPerDay": round(month_to_date / day, 4) if day and month_to_date else None,
        "budgetUsedPct": budget_used_pct,
        "key": key_parsed,
    }


def _parse_ts(raw: Any) -> datetime | None:
    """Parse a LiteLLM ISO timestamp (``…Z`` or offset) into an aware datetime, or ``None``."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _aggregate_logs(logs: Any, since: datetime) -> tuple[float, list[dict[str, Any]]]:
    """Sum ``/spend/logs`` spend since ``since``, grouped by model (desc). NO prompt content."""
    by_model: dict[str, float] = defaultdict(float)
    total = 0.0
    for r in _as_rows(logs):
        if not isinstance(r, dict):
            continue
        ts = _parse_ts(r.get("startTime") or r.get("startedAt"))
        if ts is not None and ts < since:
            continue
        raw_spend = r.get("spend")
        if not isinstance(raw_spend, int | float):
            continue
        model = str(r.get("model") or "unknown")
        by_model[model] += float(raw_spend)
        total += float(raw_spend)
    ranked = [
        {"model": m, "spend": round(s, 6)}
        for m, s in sorted(by_model.items(), key=lambda kv: -kv[1])
    ]
    return total, ranked


@router.get("/admin/llm/activity")
async def admin_llm_activity(
    admin: Annotated[AccountContext, Depends(require_admin)],
    limit: int = 25,
) -> dict[str, Any]:
    """Recent request activity — SCRUBBED (model/status/tokens/spend/time only; NO prompt content,
    the caller wallet is masked). Admin-key required; degrades to ``adminConfigured:false``."""
    admin_gw = _admin_gateway()
    if admin_gw is None:
        return {**_unconfigured(), "entries": []}
    root, key = admin_gw
    cap = max(1, min(limit, 200))
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        logs = await _admin_get(client, root, f"/spend/logs?limit={cap}", key)
    return {"configured": True, "adminConfigured": True, "entries": _parse_activity(logs, cap)}


def _mask_user(user: Any) -> str | None:
    """Mask a caller identifier (usually a wallet) so the activity feed never prints it in full."""
    s = str(user or "").strip()
    if not s:
        return None
    return f"{s[:6]}…{s[-4:]}" if len(s) > 12 else s


def _parse_activity(logs: Any, cap: int) -> list[dict[str, Any]]:
    """Normalise /spend/logs rows to scrubbed, content-free activity entries."""
    out: list[dict[str, Any]] = []
    for r in _as_rows(logs)[:cap]:
        if not isinstance(r, dict):
            continue
        out.append(
            {
                "model": str(r.get("model") or ""),
                "user": _mask_user(r.get("user") or r.get("end_user")),
                "total_tokens": r.get("total_tokens"),
                "spend": r.get("spend"),
                "status": r.get("status") or r.get("call_type"),
                "at": r.get("startTime") or r.get("created_at") or r.get("request_time"),
            }
        )
    return out


@router.get("/admin/llm/config")
async def admin_llm_config(
    admin: Annotated[AccountContext, Depends(require_admin)],
) -> dict[str, Any]:
    """The deployments behind the chat alias + recent config audit. Admin-key required."""
    admin_gw = _admin_gateway()
    if admin_gw is None:
        return {**_unconfigured(), "alias": _alias(), "deployments": [], "audit": []}
    root, key = admin_gw
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        model_info = await _admin_get(client, root, "/model/info", key)
    audit = await _audit_store().recent(25)
    return {
        "configured": True,
        "adminConfigured": True,
        "alias": _alias(),  # the primary chat alias (the add-model target + delete guardrail scope)
        "deployments": _all_deployments(model_info),  # ALL aliases so a premium alias is visible
        "audit": audit,
    }


class ModelAdd(BaseModel):
    """``POST /admin/llm/config/model`` — add a deployment to a chat alias group.

    ``alias`` targets which model group the deployment joins (default: the primary chat alias), so
    a premium alias is managed just like the default. Optional per-M costs set LiteLLM's own
    accounting so spend + projections are accurate for models it doesn't price itself.
    """

    upstream_model: str = Field(min_length=1)  # e.g. "openrouter/google/gemma-4-31b-it:free"
    alias: str | None = None  # target model group; defaults to the primary chat alias
    api_base: str | None = None
    rpm: int | None = Field(default=None, ge=1)
    input_cost_per_m: float | None = Field(default=None, ge=0)  # USD per 1M input tokens
    output_cost_per_m: float | None = Field(default=None, ge=0)  # USD per 1M output tokens


class ModelDelete(BaseModel):
    """``POST /admin/llm/config/model/delete`` — remove a deployment by its LiteLLM id."""

    id: str = Field(min_length=1)


def _require_admin_gateway() -> tuple[str, str]:
    admin_gw = _admin_gateway()
    if admin_gw is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The gateway admin key isn't provisioned; config changes are unavailable.",
        )
    return admin_gw


@router.post("/admin/llm/config/model")
async def admin_llm_add_model(
    body: ModelAdd, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Add a deployment behind the chat alias (config write). Audit-logged. POST, not PUT, because
    the same-origin BFF proxies only GET/POST. Requires the gateway to persist model config."""
    root, key = _require_admin_gateway()
    alias = (body.alias or _alias()).strip()
    params: dict[str, Any] = {"model": body.upstream_model.strip()}
    if body.api_base:
        params["api_base"] = body.api_base.strip()
    if body.rpm is not None:
        params["rpm"] = body.rpm
    if body.input_cost_per_m is not None:
        params["input_cost_per_token"] = body.input_cost_per_m / 1_000_000
    if body.output_cost_per_m is not None:
        params["output_cost_per_token"] = body.output_cost_per_m / 1_000_000
    payload: dict[str, Any] = {"model_name": alias, "litellm_params": params}
    async with httpx.AsyncClient(timeout=_WRITE_TIMEOUT_S) as client:
        status, resp = await _admin_post(client, root, "/model/new", key, payload)
    if status is None or status >= 300:
        default_msg = "The gateway rejected the model add (is model-config persistence enabled?)."
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, _persist_hint(resp) or default_msg)
    await _audit_store().record(
        "model_add",
        alias,
        admin.owner,
        {"upstream": body.upstream_model.strip(), "rpm": body.rpm, "alias": alias},
    )
    # Allow-listed response (not a raw upstream echo): only the known-clean, admin-supplied fields.
    # This avoids leaking any credential-bearing field the upstream might echo that the deny-list
    # scrub didn't anticipate (e.g. userinfo/query embedded in api_base).
    return {
        "ok": True,
        "alias": alias,
        "deployment": {
            "upstream": body.upstream_model.strip(),
            "rpm": body.rpm,
            "inputCostPerM": body.input_cost_per_m,
            "outputCostPerM": body.output_cost_per_m,
        },
    }


@router.post("/admin/llm/config/model/delete")
async def admin_llm_delete_model(
    body: ModelDelete, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Remove a deployment by id. GUARDRAIL (fail-CLOSED): the delete proceeds only when we can
    positively confirm at least one OTHER deployment survives for the chat alias — so a failed /
    unreadable model_info read refuses rather than risking stranding chat with zero backends.
    Audit-logged. POST (BFF forwards only GET/POST).

    NOTE: the guardrail is best-effort under concurrency — the enumerate-then-delete pair isn't
    atomic, so two simultaneous deletes could each observe a survivor and both proceed. This admin
    surface is single-operator in practice; a hard guarantee would need a gateway-side constraint.
    """
    root, key = _require_admin_gateway()
    target = body.id.strip()
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        model_info = await _admin_get(client, root, "/model/info", key)
    if model_info is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Couldn't read the current deployments; refusing the delete to avoid stranding chat.",
        )
    all_deps = _all_deployments(model_info)
    target_dep = next((d for d in all_deps if d.get("id") == target), None)
    # Fail CLOSED on an unconfirmable state: if we can't find the target (renamed alias / changed
    # shape / parse gap) we refuse rather than delete blind (B5).
    if target_dep is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Couldn't find that deployment in the gateway; refusing the delete.",
        )
    talias = str(target_dep.get("model_name") or "")
    # Per-ALIAS guardrail: require a confirmed surviving backend for THIS deployment's alias — so a
    # premium alias can't be stranded any more than the chat default can.
    sibling_ids = {d["id"] for d in all_deps if d.get("model_name") == talias and d.get("id")}
    if len(sibling_ids - {target}) < 1:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Refusing to delete the last '{talias}' deployment — that alias would have none.",
            http_status=409,
        )
    async with httpx.AsyncClient(timeout=_WRITE_TIMEOUT_S) as client:
        status, _resp = await _admin_post(client, root, "/model/delete", key, {"id": target})
    if status is None or status >= 300:
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, "The gateway rejected the model delete.")
    await _audit_store().record("model_delete", target, admin.owner, {"alias": talias})
    return {"ok": True, "deleted": target}  # allow-listed response — no raw upstream echo


@router.get("/admin/llm/openrouter/price")
async def admin_llm_openrouter_price(
    model: str,
    admin: Annotated[AccountContext, Depends(require_admin)],
) -> dict[str, Any]:
    """Look up a model's CURRENT OpenRouter price (USD per 1M tokens) to pre-fill the add form.

    Admin-gated. Reads OpenRouter's public models list (no key). Best-effort: ``{found: false}`` if
    the model/price can't be resolved (the operator can still type the price manually).
    """
    mid = model.strip()
    if mid.startswith("openrouter/"):
        mid = mid[len("openrouter/") :]
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        data = await _get_json(client, "https://openrouter.ai/api/v1/models", {})
    for m in _as_rows(data):
        if not isinstance(m, dict) or str(m.get("id")) != mid:
            continue
        raw_pricing = m.get("pricing")
        pricing = raw_pricing if isinstance(raw_pricing, dict) else {}
        try:
            pin = float(pricing.get("prompt", 0) or 0) * 1e6
            pout = float(pricing.get("completion", 0) or 0) * 1e6
        except (TypeError, ValueError):
            return {"found": False, "model": mid}
        return {
            "found": True,
            "model": mid,
            "inputCostPerM": round(pin, 6),
            "outputCostPerM": round(pout, 6),
        }
    return {"found": False, "model": mid}


class KeyBudget(BaseModel):
    """``POST /admin/llm/key/config`` — the virtual key's spend budget + rate limits."""

    max_budget: float | None = Field(default=None, ge=0)  # USD ceiling per budget period
    budget_duration: str | None = None  # reset period, e.g. "1d", "7d", "30d"
    rpm_limit: int | None = Field(default=None, ge=0)
    tpm_limit: int | None = Field(default=None, ge=0)


def _virtual_key() -> str | None:
    return (os.getenv("LITELLM_API_KEY") or "").strip() or None


@router.post("/admin/llm/key/config")
async def admin_llm_key_config(
    body: KeyBudget, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Update the virtual key's budget + rate limits via LiteLLM ``/key/update``. Admin-gated,
    audited. This is the gateway abuse-ceiling control: a hard spend cap + rpm/tpm on the one key
    that fronts all inference. NO key material is logged."""
    root, key = _require_admin_gateway()
    vkey = _virtual_key()
    if not vkey:
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, "The virtual key isn't configured.")
    fields = {
        "max_budget": body.max_budget,
        "budget_duration": body.budget_duration,
        "rpm_limit": body.rpm_limit,
        "tpm_limit": body.tpm_limit,
    }
    changes = {k: v for k, v in fields.items() if v is not None}
    if not changes:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "No budget/limit fields provided.")
    async with httpx.AsyncClient(timeout=_WRITE_TIMEOUT_S) as client:
        status, resp = await _admin_post(client, root, "/key/update", key, {"key": vkey, **changes})
    if status is None or status >= 300:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            _persist_hint(resp) or "The gateway rejected the key update.",
        )
    await _audit_store().record("config_update", "virtual-key", admin.owner, changes)
    return {"ok": True, "updated": changes}


async def _admin_post(
    client: httpx.AsyncClient, root: str, path: str, key: str, payload: dict[str, Any]
) -> tuple[int | None, Any]:
    """POST to a gateway management endpoint. Returns ``(status, body|None)``; ``(None, None)`` on
    a transport error (never raises — the caller maps it to a clean envelope)."""
    try:
        resp = await client.post(
            f"{root}{path}", headers={"authorization": f"Bearer {key}"}, json=payload
        )
    except Exception:
        return None, None
    try:
        body = resp.json()
    except Exception:
        body = None
    return resp.status_code, body


def _persist_hint(resp: Any) -> str | None:
    """Map LiteLLM's 'set STORE_MODEL_IN_DB' error into a clear operator message, else None."""
    text = str(resp).lower()
    if "store_model_in_db" in text or "store model in db" in text:
        return (
            "The gateway isn't configured to persist model changes "
            "(set STORE_MODEL_IN_DB=true + a DATABASE_URL on the LiteLLM app)."
        )
    return None
