"""Admin-gated tier-limits configuration (feature 008, US2).

Lets an operator edit each tier's inclusion values (daily caps, concurrency, priority, model
alias) and grant/revoke a wallet's premium designation — all effective on the NEXT request (no
redeploy), every mutation audit-logged in the store. Admin-gated on the caller's ``X-Owner``
(``require_admin`` from ``allowlist``); a non-admin gets **404, not 403** (invisible surface).
Mutations are **POST-only** so the web console reaches them through the GET/POST-only BFF proxy.

Non-custody: this configures an ADVISORY-COMPUTE gate only. It never returns a signable artifact
and never touches /exit, /trust, or the on-chain withdraw path (N2).
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from ..db import LimitsStore
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .quota import get_limits_store
from .security import AccountContext

router = APIRouter(tags=["admin-limits"])

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


class TierUpdate(BaseModel):
    """``POST /admin/limits/tiers`` body — the editable inclusion values of one tier."""

    tier: str
    displayName: str
    chatDailyLimit: int
    recsDailyLimit: int
    onboardingDailyLimit: int
    concurrency: int
    priorityWeight: int
    modelAlias: str


class TierAssign(BaseModel):
    """``POST /admin/limits/tiers/assign`` body: ``{ address, tier }``."""

    address: str
    tier: str

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        candidate = value.strip()
        if not _ADDRESS_RE.match(candidate):
            raise ValueError("address must be a 20-byte 0x address")
        return candidate


class TierRevoke(BaseModel):
    """``POST /admin/limits/tiers/revoke`` body: ``{ address }``."""

    address: str

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        candidate = value.strip()
        if not _ADDRESS_RE.match(candidate):
            raise ValueError("address must be a 20-byte 0x address")
        return candidate


@router.get("/admin/limits/tiers")
async def list_tiers(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """List every tier with its current inclusion values (admin-gated)."""
    return {"tiers": await store.get_tiers()}


@router.post("/admin/limits/tiers")
async def update_tier(
    body: TierUpdate,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """Update a tier's inclusion values (admin-gated, audited, effective next request).

    404 for an unknown tier; 400 for a value that would strand the assistant (a zero chat
    allowance on the default tier) or a negative value — the store's fail-safe (FR-008).
    """
    try:
        await store.upsert_tier(
            body.tier,
            display_name=body.displayName,
            chat_daily_limit=body.chatDailyLimit,
            recs_daily_limit=body.recsDailyLimit,
            onboarding_daily_limit=body.onboardingDailyLimit,
            concurrency=body.concurrency,
            priority_weight=body.priorityWeight,
            model_alias=body.modelAlias,
            actor=admin.owner,
        )
    except KeyError as exc:
        raise ApiError(ErrorCode.NOT_FOUND, "Unknown tier.") from exc
    except ValueError as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    return {"ok": True, "tier": await store.get_tier(body.tier)}


@router.post("/admin/limits/tiers/assign")
async def assign_tier(
    body: TierAssign,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """Grant a wallet a tier (admin-gated, audited, effective next request)."""
    if await store.get_tier(body.tier) is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Unknown tier.")
    await store.assign(body.address, body.tier, actor=admin.owner)
    return {"ok": True, "address": body.address.lower(), "tier": body.tier.strip().lower()}


@router.post("/admin/limits/tiers/revoke")
async def revoke_tier(
    body: TierRevoke,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
) -> dict[str, object]:
    """Revoke a wallet's tier assignment (reverts to the default tier on the next request)."""
    await store.revoke(body.address, actor=admin.owner)
    return {"ok": True, "address": body.address.lower()}


@router.get("/admin/limits/audit")
async def limits_audit(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[LimitsStore, Depends(get_limits_store)],
    limit: int = 50,
) -> dict[str, object]:
    """Read the most-recent tier-config audit rows (admin-gated, newest first)."""
    return {"entries": await store.recent_audit(limit)}
