"""Feature 049 v4.1.0 — AI/admin admission queue (admin) + the runner's candidate/report surface.

Two surfaces, split by caller exactly like the curator:

  * ``/admin/vaults/whitelist*``         — ADMIN: the admission queue (entries + candidates), and
                                            recording an instant on-chain action the admin's wallet
                                            already executed (whitelist / deploy / unwhitelist /
                                            failed). The panel signs; the agent only records.
  * ``/curator/wrapper-whitelist*``      — the AI RUNNER (machine, S2S): poll unwrapped curated
                                            candidates with their wrapper params, and report the
                                            whitelist/deploy result. No admin gate beyond the
                                            operator assertion; it grants nothing.

⚠️ The agent is KEYLESS and this module keeps it that way: it never signs, never deploys, never
touches the factory. The AI runner holds the scoped `DEPLOYER_ROLE` key; the factory enforces the
cooldown, the fee cap, the child validation and one-wrapper-per-child. A row here is a record,
never an authority.

⚠️ Registration order: this router owns literal ``/admin/vaults/whitelist*`` routes and MUST be
included BEFORE ``admin_vaults_router`` (whose ``GET /admin/vaults/{vault}`` would otherwise
swallow them), same rule as ``api/curated_vaults.py`` and ``api/wrapper_deployments.py``.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..db.curated_vaults import CuratedVault, PgCurationStore
from ..db.wrapper_whitelist import (
    DEPLOYED,
    MAX_FEE_BPS,
    MAX_UINT256,
    PENDING,
    PgWhitelistStore,
    WrapperWhitelistEntry,
    default_wrapper_params,
)
from .allowlist import require_admin
from .curated_vaults import get_curation_store
from .errors import ApiError, ErrorCode
from .security import AccountContext

router = APIRouter(tags=["wrapper-whitelist"])

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def get_whitelist_store() -> PgWhitelistStore:
    """The asyncpg-backed admission mirror (production). Overridden with a fake in tests."""
    return PgWhitelistStore(get_database())


def _lower_address(value: str, field: str = "address") -> str:
    candidate = value.strip()
    if not _ADDRESS_RE.match(candidate):
        raise ValueError(f"{field} must be a 20-byte 0x address")
    return candidate.lower()


class WhitelistReport(BaseModel):
    """``POST /curator/wrapper-whitelist/report`` — the AI runner's account of one attempt."""

    childAddress: str
    action: Literal["whitelist", "deploy"]
    ok: bool
    txHash: str | None = Field(default=None, max_length=80)
    proxyAddress: str | None = None
    capRegistry: str | None = None
    readyAt: int | None = Field(default=None, ge=0, le=(1 << 63) - 1)
    byAddress: str | None = None
    error: str | None = Field(default=None, max_length=1000)
    runnerCommit: str | None = Field(default=None, max_length=80)

    @field_validator("childAddress")
    @classmethod
    def _child(cls, value: str) -> str:
        return _lower_address(value, "childAddress")

    @field_validator("proxyAddress", "capRegistry", "byAddress")
    @classmethod
    def _optional_addr(cls, value: str | None) -> str | None:
        return None if value is None else _lower_address(value)


class AdminRecord(BaseModel):
    """``POST /admin/vaults/whitelist/record`` — an instant action the admin's wallet executed.

    Params are optional: when omitted, the existing pending row's params (or the curated defaults)
    are kept, so recording a whitelist tx can never silently change what the runner deploys.
    """

    childAddress: str
    action: Literal["whitelist", "deploy", "unwhitelist", "release", "fail"]
    txHash: str | None = Field(default=None, max_length=80)
    readyAt: int | None = Field(default=None, ge=0, le=(1 << 63) - 1)
    proxyAddress: str | None = None
    capRegistry: str | None = None
    feeBps: int | None = Field(default=None, ge=0, le=MAX_FEE_BPS)
    perUserCap: int | None = Field(default=None, ge=0, le=MAX_UINT256)
    totalCap: int | None = Field(default=None, ge=0, le=MAX_UINT256)
    vaultCap: int | None = Field(default=None, ge=0, le=MAX_UINT256)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    symbol: str | None = Field(default=None, min_length=1, max_length=20)
    label: str | None = Field(default=None, min_length=1, max_length=200)
    error: str | None = Field(default=None, max_length=1000)

    @field_validator("childAddress")
    @classmethod
    def _child(cls, value: str) -> str:
        return _lower_address(value, "childAddress")

    @field_validator("proxyAddress", "capRegistry")
    @classmethod
    def _optional_addr(cls, value: str | None) -> str | None:
        return None if value is None else _lower_address(value)


def _params_from_row(row: Any) -> dict[str, Any]:
    return {
        "fee_bps": row.fee_bps,
        "per_user_cap": row.per_user_cap,
        "total_cap": row.total_cap,
        "vault_cap": row.vault_cap,
        "name": row.name,
        "symbol": row.symbol,
        "label": row.label,
    }


def _fallback_params(child_address: str) -> dict[str, Any]:
    return default_wrapper_params(
        label=f"Curated vault {child_address[:10]}…", asset_symbol="USDG", asset_decimals=6
    )


def _params_to_wire(params: dict[str, Any]) -> dict[str, Any]:
    return {
        "feeBps": params["fee_bps"],
        "perUserCap": str(params["per_user_cap"]),
        "totalCap": str(params["total_cap"]),
        "vaultCap": str(params["vault_cap"]),
        "name": params["name"],
        "symbol": params["symbol"],
        "label": params["label"],
    }


async def _resolve_params(
    *,
    chain_id: int,
    child_address: str,
    store: PgWhitelistStore,
    curation: PgCurationStore,
    body: AdminRecord | WhitelistReport | None = None,
) -> dict[str, Any]:
    """Body params (admin only) → existing pending row → curated defaults → generic fallback."""
    if isinstance(body, AdminRecord):
        explicit = [
            body.feeBps,
            body.perUserCap,
            body.totalCap,
            body.vaultCap,
            body.name,
            body.symbol,
            body.label,
        ]
        if all(value is not None for value in explicit):
            return {
                "fee_bps": body.feeBps,
                "per_user_cap": body.perUserCap,
                "total_cap": body.totalCap,
                "vault_cap": body.vaultCap,
                "name": body.name,
                "symbol": body.symbol,
                "label": body.label,
            }

    existing = await store.get_latest(chain_id, child_address)
    if existing is not None and existing.status == PENDING:
        return _params_from_row(existing)

    vault: CuratedVault | None = await curation.get_vault(chain_id, child_address)
    if vault is not None:
        return default_wrapper_params(
            label=vault.label,
            asset_symbol=vault.asset_symbol,
            asset_decimals=vault.asset_decimals,
        )
    return _fallback_params(child_address)


async def _candidates(
    chain_id: int, store: PgWhitelistStore, curation: PgCurationStore
) -> list[dict[str, Any]]:
    """Approved, unwrapped curated vaults with deterministic params + the mirrored state.

    A candidate is offered because the CURATED row is approved and unwrapped — never because a
    whitelist row says so. Rows only decorate the candidate (pending/readyAt/by) for display and
    to reuse the params chosen at admission time.
    """
    vaults = await curation.list_vaults(chain_id, statuses=("approved",))
    latest = await store.latest_by_child(chain_id)
    candidates: list[dict[str, Any]] = []
    for vault in vaults:
        if vault.wrapped:
            continue
        row = latest.get(vault.vault_address)
        if row is not None and row.status == DEPLOYED:
            continue
        params = (
            _params_from_row(row)
            if row is not None and row.status == PENDING
            else default_wrapper_params(
                label=vault.label,
                asset_symbol=vault.asset_symbol,
                asset_decimals=vault.asset_decimals,
            )
        )
        candidates.append(
            {
                "childAddress": vault.vault_address,
                "vaultLabel": vault.label,
                "assetSymbol": vault.asset_symbol,
                "assetDecimals": vault.asset_decimals,
                "status": row.status if row is not None else "none",
                "byAddress": row.by_address if row is not None else None,
                "readyAt": row.ready_at if row is not None else None,
                **_params_to_wire(params),
            }
        )
    return candidates


# ── admin surface ────────────────────────────────────────────────────────────────────────────────


@router.get("/admin/vaults/whitelist")
async def admin_list_whitelist(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgWhitelistStore, Depends(get_whitelist_store)],
    curation: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """The admission queue: every mirrored entry, plus every unwrapped candidate."""
    entries = await store.list_entries(admin.chain_id, limit=200)
    return {
        "entries": [entry.to_wire() for entry in entries],
        "pending": sum(1 for entry in entries if entry.status == PENDING),
        "candidates": await _candidates(admin.chain_id, store, curation),
    }


@router.post("/admin/vaults/whitelist/record")
async def admin_record_whitelist(
    body: AdminRecord,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgWhitelistStore, Depends(get_whitelist_store)],
    curation: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Record an instant admission action the admin's wallet already executed on-chain.

    ⚠️ This route never signs and never sends: the panel signs `whitelistVault` / `unwhitelist` /
    `createVault` from the admin EOA and reports the confirmed tx here. The agent stores what the
    chain did, so the queue (and the runner) see the admin's entry.
    """
    entry: WrapperWhitelistEntry | None
    if body.action == "whitelist":
        params = await _resolve_params(
            chain_id=admin.chain_id,
            child_address=body.childAddress,
            store=store,
            curation=curation,
            body=body,
        )
        entry = await store.record_whitelist(
            admin.chain_id,
            child_address=body.childAddress,
            by_address=admin.owner,
            ready_at=body.readyAt or 0,
            tx_hash=body.txHash,
            actor=admin.owner,
            **params,
        )
        return {"ok": True, "updated": True, "entry": entry.to_wire()}

    if body.action == "deploy":
        entry = await store.record_deploy(
            admin.chain_id,
            child_address=body.childAddress,
            tx_hash=body.txHash,
            proxy_address=body.proxyAddress,
            cap_registry=body.capRegistry,
            actor=admin.owner,
        )
        if body.proxyAddress:
            await curation.set_wrapper(
                admin.chain_id,
                child_address=body.childAddress,
                wrapper_address=body.proxyAddress,
            )
        return {
            "ok": True,
            "updated": entry is not None,
            "entry": entry.to_wire() if entry is not None else None,
        }

    if body.action == "unwhitelist":
        entry = await store.record_cancel(
            admin.chain_id, child_address=body.childAddress, actor=admin.owner
        )
        if entry is None:
            raise ApiError(
                ErrorCode.NOT_FOUND, "no pending admission for that child on this chain"
            )
        return {"ok": True, "updated": True, "entry": entry.to_wire()}

    if body.action == "release":
        entry = await store.record_release(
            admin.chain_id, child_address=body.childAddress, actor=admin.owner
        )
        if entry is None:
            raise ApiError(
                ErrorCode.NOT_FOUND, "no pending admission for that child on this chain"
            )
        return {"ok": True, "updated": True, "entry": entry.to_wire()}

    entry = await store.record_failure(
        admin.chain_id,
        child_address=body.childAddress,
        error=body.error,
        tx_hash=body.txHash,
        actor=admin.owner,
    )
    return {
        "ok": True,
        "updated": entry is not None,
        "entry": entry.to_wire() if entry is not None else None,
    }


# ── AI-runner surface (machine, S2S, operator-asserted) ──────────────────────────────────────────


@router.get("/curator/wrapper-whitelist")
async def runner_candidates(
    # ⚠️ Admin/service identity, not a bare S2S call: the BFF proxies EVERY alpha session to these
    # paths, so "any signed-in user could poll the queue". The runner asserts the operator (admin)
    # wallet, so this still works for the machine and 404s for everyone else.
    account: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgWhitelistStore, Depends(get_whitelist_store)],
    curation: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Unwrapped approved candidates with the params the runner should deploy with.

    It grants nothing on-chain — the factory's cooldown, RBAC, bounds and one-wrapper-per-child
    are Solidity-enforced — but the candidate list is operator data.
    """
    return {"candidates": await _candidates(account.chain_id, store, curation)}


@router.post("/curator/wrapper-whitelist/report")
async def runner_report(
    body: WhitelistReport,
    account: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgWhitelistStore, Depends(get_whitelist_store)],
    curation: Annotated[PgCurationStore, Depends(get_curation_store)],
) -> dict[str, Any]:
    """Record the AI runner's result for one whitelist/deploy attempt.

    A failure is recorded as loudly as a success (status `failed` + `error`), which is what makes a
    silent AI runner impossible. A successful deploy also flips the curated row to
    ``wrapped=true, wrapper_address=<proxy>`` so the deposit rail routes through the wrapper.
    """
    entry: WrapperWhitelistEntry | None
    if body.ok and body.action == "whitelist":
        params = await _resolve_params(
            chain_id=account.chain_id,
            child_address=body.childAddress,
            store=store,
            curation=curation,
        )
        entry = await store.record_whitelist(
            account.chain_id,
            child_address=body.childAddress,
            by_address=body.byAddress,
            ready_at=body.readyAt or 0,
            tx_hash=body.txHash,
            actor=None,
            runner_commit=body.runnerCommit,
            **params,
        )
        return {"ok": True, "updated": True, "status": "pending", "entry": entry.to_wire()}

    if body.ok and body.action == "deploy":
        entry = await store.record_deploy(
            account.chain_id,
            child_address=body.childAddress,
            tx_hash=body.txHash,
            proxy_address=body.proxyAddress,
            cap_registry=body.capRegistry,
            actor=None,
            runner_commit=body.runnerCommit,
        )
        if body.proxyAddress:
            await curation.set_wrapper(
                account.chain_id,
                child_address=body.childAddress,
                wrapper_address=body.proxyAddress,
            )
        return {
            "ok": True,
            "updated": entry is not None,
            "status": "deployed",
            "entry": entry.to_wire() if entry is not None else None,
        }

    entry = await store.record_failure(
        account.chain_id,
        child_address=body.childAddress,
        error=body.error,
        tx_hash=body.txHash,
        actor=None,
        runner_commit=body.runnerCommit,
    )
    return {
        "ok": True,
        "updated": entry is not None,
        "status": "failed",
        "entry": entry.to_wire() if entry is not None else None,
    }
