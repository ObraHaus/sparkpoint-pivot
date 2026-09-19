"""Feature 049 — wrapper deploy requests (admin) + the deploy runner's work queue (S2S).

Two surfaces, split by caller exactly like the curator:

  * ``/admin/vaults/wrappers*``       — ADMIN: request a wrapper deployment, list, cancel.
  * ``/curator/wrapper-jobs*``        — the DEPLOY RUNNER (machine, S2S): poll pending work and
                                        report the result. No admin gate; it grants nothing.

⚠️ The agent is KEYLESS and this module keeps it that way: it never signs, never deploys, never
touches the factory. The runner holds the scoped deploy-only hot key; the on-chain factory enforces
the allowlist, the deployer role, the fee cap and the caps bounds. A row here is a request and a
record, never an authority.

⚠️ Registration order: this router owns literal ``/admin/vaults/wrappers*`` routes and MUST be
included BEFORE ``admin_vaults_router`` (whose ``GET /admin/vaults/{vault}`` would otherwise
swallow them), same rule as ``api/curated_vaults.py``.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..db.wrapper_deployments import (
    MAX_FEE_BPS,
    MAX_UINT256,
    PgDeploymentStore,
    WrapperDeployment,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(tags=["wrapper-deployments"])

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def get_deployment_store() -> PgDeploymentStore:
    """The asyncpg-backed deploy-request store (production). Overridden with a fake in tests."""
    return PgDeploymentStore(get_database())


def _require_uuid(value: str) -> str:
    candidate = value.strip()
    if not _UUID_RE.match(candidate):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "id must be a UUID")
    return candidate.lower()


class WrapperRequest(BaseModel):
    """``POST /admin/vaults/wrappers/request`` body — mirrors the factory's CreateVaultParams."""

    childAddress: str
    feeBps: int = Field(ge=0, le=MAX_FEE_BPS)
    perUserCap: int = Field(ge=0, le=MAX_UINT256)
    totalCap: int = Field(ge=0, le=MAX_UINT256)
    vaultCap: int = Field(ge=0, le=MAX_UINT256)
    name: str = Field(min_length=1, max_length=80)
    symbol: str = Field(min_length=1, max_length=20)
    label: str = Field(min_length=1, max_length=200)

    @field_validator("childAddress")
    @classmethod
    def _addr(cls, value: str) -> str:
        candidate = value.strip()
        if not _ADDRESS_RE.match(candidate):
            raise ValueError("childAddress must be a 20-byte 0x address")
        return candidate.lower()


class DeploymentId(BaseModel):
    id: str

    @field_validator("id")
    @classmethod
    def _id(cls, value: str) -> str:
        candidate = value.strip()
        if not _UUID_RE.match(candidate):
            raise ValueError("id must be a UUID")
        return candidate.lower()


class DeploymentReport(BaseModel):
    """``POST /curator/wrapper-jobs/report`` body — the runner's account of one attempt."""

    id: str
    ok: bool
    txHash: str | None = Field(default=None, max_length=80)
    proxyAddress: str | None = None
    capRegistry: str | None = None
    error: str | None = Field(default=None, max_length=1000)
    runnerCommit: str | None = Field(default=None, max_length=80)

    @field_validator("id")
    @classmethod
    def _id(cls, value: str) -> str:
        candidate = value.strip()
        if not _UUID_RE.match(candidate):
            raise ValueError("id must be a UUID")
        return candidate.lower()

    @field_validator("proxyAddress", "capRegistry")
    @classmethod
    def _optional_addr(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not _ADDRESS_RE.match(candidate):
            raise ValueError("must be a 20-byte 0x address")
        return candidate.lower()


def _wire_many(rows: list[WrapperDeployment]) -> list[dict[str, Any]]:
    return [row.to_wire() for row in rows]


# ── admin surface ────────────────────────────────────────────────────────────────────────────────


@router.get("/admin/vaults/wrappers")
async def admin_list_wrappers(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgDeploymentStore, Depends(get_deployment_store)],
) -> dict[str, Any]:
    """Every wrapper deploy request/result on this chain, newest first."""
    rows = await store.list_deployments(admin.chain_id, limit=200)
    return {
        "deployments": _wire_many(rows),
        "pending": sum(1 for r in rows if r.status == "requested"),
    }


@router.post("/admin/vaults/wrappers/request")
async def admin_request_wrapper(
    body: WrapperRequest,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgDeploymentStore, Depends(get_deployment_store)],
) -> dict[str, Any]:
    """Queue a wrapper deployment for an allowlisted child.

    The request is not authority: the runner still checks the on-chain allowlist + bounds, and the
    factory enforces them. This only asks a human-signed decision to be executed by the scoped key.
    """
    created = await store.request(
        admin.chain_id,
        child_address=body.childAddress,
        fee_bps=body.feeBps,
        per_user_cap=body.perUserCap,
        total_cap=body.totalCap,
        vault_cap=body.vaultCap,
        name=body.name,
        symbol=body.symbol,
        label=body.label,
        actor=admin.owner,
    )
    return {"ok": True, "deployment": created.to_wire()}


@router.post("/admin/vaults/wrappers/cancel")
async def admin_cancel_wrapper(
    body: DeploymentId,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgDeploymentStore, Depends(get_deployment_store)],
) -> dict[str, Any]:
    """Cancel a still-pending request. A deployed/failed row is history, not cancellable."""
    cancelled = await store.cancel(admin.chain_id, deployment_id=body.id, actor=admin.owner)
    if not cancelled:
        raise ApiError(
            ErrorCode.NOT_FOUND, "no pending wrapper deployment with that id on this chain"
        )
    return {"ok": True, "id": body.id, "status": "cancelled"}


# ── deploy-runner surface (machine, S2S, no admin) ───────────────────────────────────────────────


@router.get("/curator/wrapper-jobs")
async def runner_pending_jobs(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[PgDeploymentStore, Depends(get_deployment_store)],
) -> dict[str, Any]:
    """Pending wrapper deploy requests for this chain, oldest first.

    S2S-authenticated, NOT admin-gated: the caller is a machine and this grants nothing. The runner
    owns its cadence; this only tells it what a human has asked for.
    """
    rows = await store.pending(account.chain_id, limit=20)
    return {"jobs": _wire_many(rows)}


@router.post("/curator/wrapper-jobs/report")
async def runner_report_job(
    body: DeploymentReport,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[PgDeploymentStore, Depends(get_deployment_store)],
) -> dict[str, Any]:
    """Record the runner's result for one deploy request.

    Idempotent on the row's state: only a `requested` row can be resolved, so a retried report is a
    no-op rather than a rewrite. A failure is recorded as loudly as a success (status `failed` +
    `error`), which is what makes a silent deploy runner impossible.
    """
    updated = await store.report(
        account.chain_id,
        deployment_id=body.id,
        ok=body.ok,
        tx_hash=body.txHash,
        proxy_address=body.proxyAddress,
        cap_registry=body.capRegistry,
        error=body.error,
        runner_commit=body.runnerCommit,
    )
    if not updated:
        # Already resolved or unknown: tell the caller plainly instead of pretending.
        existing = await store.get(account.chain_id, body.id)
        if existing is None:
            raise ApiError(ErrorCode.NOT_FOUND, "no wrapper deployment with that id on this chain")
        return {"ok": True, "updated": False, "status": existing.status}
    return {"ok": True, "updated": True, "status": "deployed" if body.ok else "failed"}
