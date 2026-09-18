"""Feature 048 — AI-curated vaults: the public board, the curator ingest, and the admin panel API.

Three surfaces, deliberately separated by who calls them:

  * ``GET  /vaults/curated``            — the PUBLIC board (beta wallet). Honest empty shape.
  * ``GET  /curator/run-state`` +
    ``POST /curator/ingest``           — the KEYLESS curator runner's control/readback. S2S auth,
                                          machine identity, no admin gate and no authority.
  * ``GET/POST /admin/vaults/curation*`` — the admin review surface (``require_admin`` → 404 to a
                                          non-admin, mirroring ``admin/tips`` / ``admin/access``).

NON-CUSTODY (N1/N2). Nothing here holds a key, signs, or gates a withdrawal. The runner's
"Run now" is a REQUEST marker the runner reads on its own schedule — the agent cannot make a
keyless process act, and it must never grow the ability to (see ``api/admin_bots.py`` for the same
posture stated at length).

⚠️ Registration order matters. ``GET /admin/vaults/{vault}`` (``api/admin_vaults.py``) is a
catch-all path param, so this router MUST be included BEFORE ``admin_vaults_router`` in ``main.py``
— otherwise ``/admin/vaults/curation`` is parsed as a lookup for a vault literally named
"curation". This module owns the literal routes; that one owns the param routes.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..db.curated_vaults import (
    ADMIN_EDITABLE_FIELDS,
    APPROVED,
    CANDIDATE,
    DENIED,
    DEPOSIT_DIRECT,
    DEPOSIT_WRAPPER,
    HIDDEN,
    SOURCE_MORPHO,
    CuratedVault,
    CurationState,
    PgCurationStore,
    Recommendation,
    ScanVault,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

logger = logging.getLogger(__name__)

router = APIRouter(tags=["curated-vaults"])

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

_STATUSES = (CANDIDATE, APPROVED, HIDDEN, DENIED)

#: Reason shown for an admin-pinned pick when the run record does not explain it.
_PIN_REASON = "Pinned by SparkPoint."

#: The public empty-state sentence. Rendered verbatim by /vault; honest, never an empty table
#: pretending to be a market (FR-008).
_NO_VAULTS_NOTE = (
    "No curated vaults on this chain yet — discovery is configured for it and this page will "
    "populate as soon as a vault source reports one."
)


def get_curation_store() -> PgCurationStore:
    """The asyncpg-backed curation store (production). Overridden with a fake in tests."""
    return PgCurationStore(get_database())


def _norm_address(value: str) -> str:
    candidate = value.strip()
    if not _ADDRESS_RE.match(candidate):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "address must be a 20-byte 0x address")
    return candidate.lower()


# ── public board ─────────────────────────────────────────────────────────────────────────────────


def _hydrate(vault: CuratedVault, *, reason: str, as_of: str | None) -> dict[str, Any]:
    """A vault wire with the recommendation context merged in (one object the UI can render)."""
    wire = vault.to_wire()
    wire["reason"] = reason
    wire["asOf"] = as_of
    return wire


def _public_alternates(
    rec: Recommendation | None, vaults: dict[str, CuratedVault], pick_address: str | None
) -> list[dict[str, Any]]:
    if rec is None:
        return []
    out: list[dict[str, Any]] = []
    for alt in rec.alternates:
        address = str(alt.get("address", "")).lower()
        vault = vaults.get(address)
        if vault is None or address == pick_address:
            continue
        out.append(_hydrate(vault, reason=str(alt.get("reason", "")), as_of=rec.as_of))
    return out


def public_board(
    chain_id: int,
    vaults: list[CuratedVault],
    rec: Recommendation | None,
    state: CurationState,
) -> dict[str, Any]:
    """Compose the public ``/vaults/curated`` payload. Pure — unit-testable without a store.

    Pick precedence: an admin PIN wins (FR-007), otherwise the latest PUBLISHED recommendation
    (only written when auto-publish was on or an admin approved/pinned). A recommendation whose
    vault was later hidden or denied does not surface.
    """
    approved = {v.vault_address: v for v in vaults if v.status == APPROVED}
    pinned = next((v for v in approved.values() if v.pinned_at), None)

    pick: dict[str, Any] | None = None
    if pinned is not None:
        reason = _PIN_REASON
        as_of = pinned.pinned_at
        if rec is not None and rec.pick_address == pinned.vault_address:
            reason = rec.pick_reason
            as_of = rec.as_of
        pick = _hydrate(pinned, reason=reason, as_of=as_of)
    elif rec is not None and rec.pick_address in approved:
        vault = approved[rec.pick_address]
        pick = _hydrate(vault, reason=rec.pick_reason, as_of=rec.as_of)

    pick_address = pick["address"] if pick is not None else None

    return {
        "chainId": chain_id,
        "source": SOURCE_MORPHO,
        "lastRunAt": state.last_run_at,
        "lastRunOk": state.last_run_ok,
        "autoPublish": state.auto_publish,
        "pick": pick,
        "alternates": _public_alternates(rec, approved, pick_address),
        "vaults": [v.to_wire() for v in approved.values()],
        # Present only when it would otherwise look like a broken table: an empty board must say
        # WHY it is empty, and it must never imply a market that isn't there.
        "note": None if approved else _NO_VAULTS_NOTE,
    }


@router.get("/vaults/curated")
async def list_curated(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """The curated board for the caller's chain: pick + alternates + approved vaults + as-of.

    Beta-gated by the BFF like every other read; the agent additionally scopes by ``X-Chain-Id``.
    Returns the honest empty shape when discovery has found nothing (4663 today)."""
    chain_id = account.chain_id
    vaults = await store.list_vaults(chain_id, statuses=(APPROVED,))
    state = await store.get_state(chain_id)
    rec = await store.latest_recommendation(chain_id, published_only=True)
    return public_board(chain_id, vaults, rec, state)


# ── curator runner control + ingest (machine, S2S, no admin) ─────────────────────────────────────


class IngestVault(BaseModel):
    """One screened discovery result. Lengths are capped because the source is a third party."""

    address: str
    label: str = Field(min_length=1, max_length=200)
    screened: bool
    score: int | None = Field(default=None, ge=0, le=100)
    scoreInputs: dict[str, Any] = Field(default_factory=dict)
    screening: list[Any] = Field(default_factory=list)
    assetAddress: str | None = None
    assetSymbol: str | None = Field(default=None, max_length=40)
    assetDecimals: int | None = Field(default=None, ge=0, le=36)
    curator: str | None = Field(default=None, max_length=200)
    curatorVerified: bool = False
    listed: bool = False
    netApyBps: int | None = Field(default=None, ge=-100_000, le=100_000)
    tvlUsd: float | None = Field(default=None, ge=0)
    liquidityUsd: float | None = Field(default=None, ge=0)
    ageSeconds: int | None = Field(default=None, ge=0)

    @field_validator("address")
    @classmethod
    def _addr(cls, value: str) -> str:
        return _norm_address(value)

    @field_validator("assetAddress")
    @classmethod
    def _asset(cls, value: str | None) -> str | None:
        return _norm_address(value) if value else None

    @field_validator("curator")
    @classmethod
    def _curator(cls, value: str | None) -> str | None:
        return _norm_address(value) if value and _ADDRESS_RE.match(value) else value


class RecommendationItem(BaseModel):
    address: str
    reason: str = Field(min_length=1, max_length=500)
    score: int | None = Field(default=None, ge=0, le=100)

    @field_validator("address")
    @classmethod
    def _addr(cls, value: str) -> str:
        return _norm_address(value)


class RejectedItem(BaseModel):
    """A discovered vault that FAILED screening. Stored on the run detail only — never a row.

    FR-002: only screened vaults may enter the curated list. Keeping the rejects in the run detail
    is what lets the panel answer "why is the board empty when discovery saw 12 vaults?".
    """

    address: str
    reasons: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("address")
    @classmethod
    def _addr(cls, value: str) -> str:
        return _norm_address(value)


class CuratorIngest(BaseModel):
    """The runner's report of one discovery run. ``ok=False`` records the failure ONLY."""

    runKey: str = Field(min_length=8, max_length=200)
    asOf: datetime
    source: str = Field(default=SOURCE_MORPHO, max_length=40)
    ok: bool = True
    error: str | None = Field(default=None, max_length=1000)
    vaults: list[IngestVault] = Field(default_factory=list)
    #: What discovery saw and screening rejected (cap 200 so a hostile source cannot balloon it).
    rejected: list[RejectedItem] = Field(default_factory=list, max_length=200)
    pick: RecommendationItem | None = None
    alternates: list[RecommendationItem] = Field(default_factory=list)


@router.get("/curator/run-state")
async def curator_run_state(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """What the runner needs to decide whether to run: last success, and any pending request.

    S2S-authenticated, NOT admin-gated: the caller is a machine and this grants nothing. The
    runner owns its cadence; this only tells it what the agent already knows.
    """
    state = await store.get_state(account.chain_id)
    return {"source": SOURCE_MORPHO, **state.to_wire()}


@router.post("/curator/ingest")
async def curator_ingest(
    body: CuratorIngest,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Accept one discovery run, and publish it only under the agent's policy.

    Publish policy lives HERE, not in the runner: with ``autoPublish`` on, the run's pick and
    alternates are auto-approved (AI candidates only — never an admin's hidden/denied decision)
    and the recommendation is written ``published=true``. With it off (the default), the same
    recommendation is stored ``published=false`` for the panel, and public reads ignore it.

    ``ok=False`` stores NOTHING but the failure on the state row: the last good list and pick stay
    untouched and keep serving (FR-011). The ingest is idempotent on ``runKey``.
    """
    chain_id = account.chain_id

    if not body.ok:
        await store.record_run(
            chain_id,
            run_key=body.runKey,
            as_of=body.asOf,
            ok=False,
            detail={"error": body.error or "run reported failure"},
        )
        # A failed attempt is an observation, not a write: the caller gets 200 so it does not
        # retry forever, and the public board keeps the last good record.
        return {"ok": True, "stored": 0, "published": False, "approved": 0}

    # FR-002 last line of defense: only vaults that PASSED screening may be stored. The runner
    # already sends only those, but a bug (or a forged report) must not be able to put an unscreened
    # vault on the board by marking it screened=true at the edge — so this stores the screen verdict
    # and filters on it here, in the agent.
    scan_vaults = [
        ScanVault(
            address=v.address,
            label=v.label,
            screened=v.screened,
            score=v.score,
            score_inputs=v.scoreInputs,
            screening=v.screening,
            asset_address=v.assetAddress,
            asset_symbol=v.assetSymbol,
            asset_decimals=v.assetDecimals,
            curator=v.curator,
            curator_verified=v.curatorVerified,
            listed=v.listed,
            net_apy_bps=v.netApyBps,
            tvl_usd=v.tvlUsd,
            liquidity_usd=v.liquidityUsd,
            vault_age_seconds=v.ageSeconds,
        )
        for v in body.vaults
        if v.screened
    ]
    screened_out = [{"address": r.address, "reasons": r.reasons} for r in body.rejected[:50]]
    stored = await store.upsert_scan_vaults(
        chain_id, scan_vaults, source=body.source, as_of=body.asOf
    )

    state = await store.get_state(chain_id)
    published = False
    approved = 0
    if body.pick is not None:
        if state.auto_publish:
            candidates = [body.pick.address] + [a.address for a in body.alternates]
            approved = await store.approve_recommended(chain_id, candidates)
            pick_vault = await store.get_vault(chain_id, body.pick.address)
            # A pick an admin hid or denied stays suppressed; auto-publish can only promote
            # candidates, never overturn a decision.
            published = pick_vault is not None and pick_vault.status == APPROVED
        await store.record_recommendation(
            chain_id,
            run_key=body.runKey,
            as_of=body.asOf,
            source=body.source,
            pick_address=body.pick.address,
            pick_reason=body.pick.reason,
            alternates=[a.model_dump() for a in body.alternates],
            published=published,
        )
        if published:
            await store.record_run(
                chain_id,
                run_key=body.runKey,
                as_of=body.asOf,
                ok=True,
                detail={
                    "stored": stored,
                    "pick": body.pick.address,
                    "approved": approved,
                    "screenedOut": screened_out,
                },
            )
            return {"ok": True, "stored": stored, "published": True, "approved": approved}

    await store.record_run(
        chain_id,
        run_key=body.runKey,
        as_of=body.asOf,
        ok=True,
        detail={
            "stored": stored,
            "pick": body.pick.address if body.pick else None,
            "published": False,
            "autoPublish": state.auto_publish,
            "screenedOut": screened_out,
        },
    )
    return {"ok": True, "stored": stored, "published": False, "approved": approved}


# ── admin curation panel ─────────────────────────────────────────────────────────────────────────


class AddressBody(BaseModel):
    address: str
    note: str | None = Field(default=None, max_length=500)

    @field_validator("address")
    @classmethod
    def _addr(cls, value: str) -> str:
        return _norm_address(value)


class PinBody(AddressBody):
    pinned: bool = True


class EditBody(AddressBody):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    curator: str | None = Field(default=None, max_length=200)
    curator_verified: bool | None = None
    asset_address: str | None = None
    asset_symbol: str | None = Field(default=None, max_length=40)
    asset_decimals: int | None = Field(default=None, ge=0, le=36)
    wrapped: bool | None = None
    wrapper_address: str | None = None
    deposit_mode: str | None = None
    admin_note: str | None = Field(default=None, max_length=1000)

    # ⚠️ Named differently from AddressBody._addr on purpose: a same-named method would REPLACE the
    # parent's decorator metadata and silently drop the `address` validator (mypy catches the return
    # type clash, but the consequence is a real missing validation).
    @field_validator("asset_address", "wrapper_address")
    @classmethod
    def _optional_addr(cls, value: str | None) -> str | None:
        return _norm_address(value) if value else None

    @field_validator("deposit_mode")
    @classmethod
    def _mode(cls, value: str | None) -> str | None:
        if value is not None and value not in (DEPOSIT_DIRECT, DEPOSIT_WRAPPER):
            raise ValueError("deposit_mode must be 'direct' or 'wrapper'")
        return value


class AddBody(BaseModel):
    address: str
    label: str = Field(min_length=1, max_length=200)
    asset_address: str | None = None
    asset_symbol: str | None = Field(default=None, max_length=40)
    asset_decimals: int | None = Field(default=None, ge=0, le=36)
    wrapped: bool = False
    wrapper_address: str | None = None
    deposit_mode: str = DEPOSIT_DIRECT
    admin_note: str | None = Field(default=None, max_length=1000)

    @field_validator("address", "asset_address", "wrapper_address")
    @classmethod
    def _addr_fields(cls, value: str | None) -> str | None:
        return _norm_address(value) if value else None

    @field_validator("deposit_mode")
    @classmethod
    def _mode(cls, value: str) -> str:
        if value not in (DEPOSIT_DIRECT, DEPOSIT_WRAPPER):
            raise ValueError("deposit_mode must be 'direct' or 'wrapper'")
        return value


class AutoPublishBody(BaseModel):
    enabled: bool


def _validate_rail(
    *, wrapped: bool, wrapper_address: str | None, deposit_mode: str
) -> None:
    """The wrapped/direct invariants, enforced at the edge (the DB CHECK repeats them)."""
    if wrapped and not wrapper_address:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "a wrapped vault requires wrapper_address"
        )
    if not wrapped and wrapper_address:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "wrapper_address is set but wrapped=false — set wrapped=true or clear the address",
        )
    if wrapped != (deposit_mode == DEPOSIT_WRAPPER):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "deposit_mode must be 'wrapper' iff wrapped=true"
        )


def _admin_payload(
    chain_id: int,
    vaults: list[CuratedVault],
    rec: Recommendation | None,
    state: CurationState,
    audit: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "chainId": chain_id,
        "source": SOURCE_MORPHO,
        "autoPublish": state.auto_publish,
        "lastRunAt": state.last_run_at,
        "lastRunOk": state.last_run_ok,
        "lastRunKey": state.last_run_key,
        "lastFailedAt": state.last_failed_at,
        "lastFailedDetail": state.last_failed_detail,
        "runRequestedAt": state.run_requested_at,
        "runRequestedBy": state.run_requested_by,
        # The newest proposal regardless of publication: the admin reviews what the AI proposed,
        # including runs that did not auto-publish.
        "recommendation": rec.to_wire() if rec is not None else None,
        "vaults": [v.to_wire() for v in vaults],
        "audit": audit,
        "statuses": list(_STATUSES),
    }


@router.get("/admin/vaults/curation")
async def admin_list_curation(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Everything the panel renders: all statuses, newest proposal, state, recent audit."""
    vaults = await store.list_vaults(admin.chain_id)
    rec = await store.latest_recommendation(admin.chain_id, published_only=False)
    state = await store.get_state(admin.chain_id)
    audit = await store.list_audit(admin.chain_id, limit=50)
    return _admin_payload(admin.chain_id, vaults, rec, state, audit)


@router.get("/admin/vaults/curation/audit")
async def admin_curation_audit(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
    limit: int = 100,
) -> dict[str, Any]:
    """The audit trail alone, for paging past the 50 embedded in the main panel read."""
    return {"audit": await store.list_audit(admin.chain_id, limit=limit)}


@router.post("/admin/vaults/curation/approve")
async def admin_approve(
    body: AddressBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Publish a vault to the public board (AI proposes, admin publishes)."""
    ok = await store.decide(
        admin.chain_id, address=body.address, status=APPROVED, actor=admin.owner, note=body.note
    )
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    return {"ok": True, "address": body.address, "status": APPROVED}


@router.post("/admin/vaults/curation/deny")
async def admin_deny(
    body: AddressBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Reject a candidate. Durable: a later scan may refresh facts but not the denial."""
    ok = await store.decide(
        admin.chain_id, address=body.address, status=DENIED, actor=admin.owner, note=body.note
    )
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    return {"ok": True, "address": body.address, "status": DENIED}


@router.post("/admin/vaults/curation/hide")
async def admin_hide(
    body: AddressBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Suppress a vault from the public board. Reversible with approve."""
    ok = await store.decide(
        admin.chain_id, address=body.address, status=HIDDEN, actor=admin.owner, note=body.note
    )
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    return {"ok": True, "address": body.address, "status": HIDDEN}


@router.post("/admin/vaults/curation/pin")
async def admin_pin(
    body: PinBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Pin/unpin the hero pick. Pinning approves; at most one vault stays pinned per chain."""
    ok = await store.set_pinned(
        admin.chain_id, address=body.address, pinned=body.pinned, actor=admin.owner
    )
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    return {"ok": True, "address": body.address, "pinned": body.pinned}


@router.post("/admin/vaults/curation/edit")
async def admin_edit(
    body: EditBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Edit metadata. Writes ``provenance='admin'``, which freezes the fields against scans.

    ``exclude_unset`` is load-bearing: it distinguishes an omitted field from an explicit ``null``.
    Without it an admin could never CLEAR a wrapper address or an admin note (both would read as
    "not provided" forever).
    """
    raw = body.model_dump(exclude_unset=True)
    # Explicit null CLEARS a nullable field, but a NOT NULL column cannot be cleared — dropping the
    # null there turns "clear my label" into a no-op rather than a constraint violation. (The
    # store's own allowlist guard is the second line of defense.)
    clearable = {
        "curator",
        "asset_address",
        "asset_symbol",
        "asset_decimals",
        "wrapper_address",
        "admin_note",
    }
    fields: dict[str, Any] = {
        key: value
        for key, value in raw.items()
        if key in ADMIN_EDITABLE_FIELDS and (value is not None or key in clearable)
    }
    if not fields:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "no fields to edit")

    existing = await store.get_vault(admin.chain_id, body.address)
    if existing is None:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    wrapped = bool(fields.get("wrapped", existing.wrapped))
    wrapper_address = fields.get("wrapper_address", existing.wrapper_address)
    deposit_mode = str(fields.get("deposit_mode", existing.deposit_mode))
    _validate_rail(
        wrapped=wrapped, wrapper_address=wrapper_address, deposit_mode=deposit_mode
    )
    if wrapped and deposit_mode != DEPOSIT_WRAPPER:
        fields["deposit_mode"] = DEPOSIT_WRAPPER
    if not wrapped and deposit_mode == DEPOSIT_WRAPPER:
        fields["deposit_mode"] = DEPOSIT_DIRECT

    updated = await store.update_metadata(
        admin.chain_id, address=body.address, fields=fields, actor=admin.owner
    )
    if updated is None:
        raise ApiError(ErrorCode.NOT_FOUND, f"no curated vault {body.address} on this chain")
    return {"ok": True, "vault": updated.to_wire()}


@router.post("/admin/vaults/curation/add")
async def admin_add(
    body: AddBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Add a vault by address, approved and admin-owned from the start (FR-006: list-as-data)."""
    _validate_rail(
        wrapped=body.wrapped,
        wrapper_address=body.wrapper_address,
        deposit_mode=body.deposit_mode,
    )
    created = await store.upsert_admin_vault(
        admin.chain_id,
        address=body.address,
        label=body.label,
        actor=admin.owner,
        asset_address=body.asset_address,
        asset_symbol=body.asset_symbol,
        asset_decimals=body.asset_decimals,
        wrapped=body.wrapped,
        wrapper_address=body.wrapper_address,
        deposit_mode=body.deposit_mode,
        admin_note=body.admin_note,
    )
    return {"ok": True, "address": body.address, "created": created, "status": APPROVED}


@router.post("/admin/vaults/curation/run-now")
async def admin_run_now(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Request a discovery run. The RUNNER picks this up on its next poll — this cannot run it.

    Deliberately asynchronous: the curator is a keyless process with its own schedule, and the
    agent must not grow a way to command it (the same line ``admin_bots.py`` holds).
    """
    await store.request_run(admin.chain_id, actor=admin.owner)
    return {
        "ok": True,
        "requested": True,
        "note": "The curator runner will pick this up on its next poll.",
    }


@router.post("/admin/vaults/curation/auto-publish")
async def admin_auto_publish(
    body: AutoPublishBody,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Toggle auto-publish. OFF (the default) means AI proposes and an admin publishes."""
    await store.set_auto_publish(admin.chain_id, enabled=body.enabled, actor=admin.owner)
    return {"ok": True, "autoPublish": body.enabled}
