"""SIWE network-gate diagnostics — ingest (web-tier S2S) + admin list (migration 0020).

The ``/verify`` gate's beacon posts a client-reported wallet/network snapshot to the web tier's
``/api/debug/network`` route, which forwards it here over S2S. We persist it so ops can review an
otherwise-unreproducible "wrong network" report at ``/admin/diagnostics``.

NON-CUSTODY (N2): the wallet address is CLIENT-REPORTED and UNVERIFIED — the capture happens BEFORE
the user signs in (they are stuck at the network step), so there is no SIWE proof. Nothing here
grants any authority, moves funds, or is read on the withdraw/exit path. The ingest is LENIENT (a
partial/garbled beacon still records something useful); the read surface is admin-only (404 to
everyone else, like the rest of ``/admin/*``).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..db import get_database
from ..db.network_diagnostics import (
    DiagnosticCapture,
    NetworkDiagnostic,
    PgNetworkDiagnosticStore,
)
from .allowlist import require_admin
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["diagnostics"])

_ADDR_LEN = 42  # "0x" + 40 hex


def get_diagnostics_store() -> PgNetworkDiagnosticStore:
    """Injectable store (overridden in tests)."""
    return PgNetworkDiagnosticStore(get_database())


def _norm_addr(value: str | None) -> str | None:
    """Lowercase a 0x-address; None for anything that isn't 20-byte-shaped."""
    if not value or not isinstance(value, str):
        return None
    v = value.strip().lower()
    return v if len(v) == _ADDR_LEN and v.startswith("0x") else None


class _WagmiSnap(BaseModel):
    model_config = ConfigDict(extra="ignore")
    chainId: int | None = None
    status: str | None = None
    isConnected: bool | None = None
    connectorId: str | None = None
    connectorName: str | None = None
    address: str | None = None


class _WalletInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    isMetaMask: bool | None = None
    legacyProvidersCount: int | None = None


class _Eip6963(BaseModel):
    model_config = ConfigDict(extra="ignore")
    count: int | None = None
    names: list[str] = Field(default_factory=list)


class DiagnosticBeacon(BaseModel):
    """The beacon payload the web tier forwards. Lenient: unknown fields are ignored, every field
    is optional, so a partial capture from a wedged wallet still records."""

    model_config = ConfigDict(extra="ignore")
    reason: str = "unknown"
    wagmi: _WagmiSnap = Field(default_factory=_WagmiSnap)
    walletChainId: int | None = None
    wallet: _WalletInfo = Field(default_factory=_WalletInfo)
    eip6963: _Eip6963 = Field(default_factory=_Eip6963)
    buildId: str | None = None
    userAgent: str | None = None


@router.post("/diagnostics/ingest")
async def ingest(
    beacon: DiagnosticBeacon,
    account: Annotated[AccountContext, Depends(get_account)],  # noqa: ARG001 — pins the S2S scope
    store: Annotated[PgNetworkDiagnosticStore, Depends(get_diagnostics_store)],
) -> dict[str, Any]:
    """Record one network-gate capture forwarded by the web tier (S2S)."""
    wagmi_cid = beacon.wagmi.chainId
    wallet_cid = beacon.walletChainId
    # The decisive signal: the wallet's OWN chain vs the chainId wagmi surfaced. A wagmi value of
    # None (undefined mid-reconnect) vs a real wallet chain is itself a mismatch worth flagging.
    mismatch = (wallet_cid != wagmi_cid) if wallet_cid is not None else None

    cap = DiagnosticCapture(
        reason=beacon.reason[:64] or "unknown",
        address=_norm_addr(beacon.wagmi.address),
        wagmi_chain_id=wagmi_cid,
        wallet_chain_id=wallet_cid,
        chain_mismatch=mismatch,
        wagmi_status=beacon.wagmi.status,
        connector_id=beacon.wagmi.connectorId,
        connector_name=beacon.wagmi.connectorName,
        is_metamask=beacon.wallet.isMetaMask,
        injected_count=beacon.eip6963.count,
        injected_names=tuple(str(n) for n in beacon.eip6963.names[:20]),
        user_agent=(beacon.userAgent or None),
        build_id=beacon.buildId,
        raw=beacon.model_dump(),
    )
    new_id = await store.record(cap)
    return {"ok": True, "id": new_id}


@router.get("/admin/diagnostics")
async def admin_list(
    admin: Annotated[AccountContext, Depends(require_admin)],  # noqa: ARG001 — admin gate (404 otherwise)
    store: Annotated[PgNetworkDiagnosticStore, Depends(get_diagnostics_store)],
    limit: int = 100,
    address: str | None = None,
    mismatch: bool = False,
) -> dict[str, Any]:
    """List recent captures (admin-only). Optional filter by wallet + mismatch-only."""
    rows = await store.list(limit=limit, address=_norm_addr(address), mismatch_only=mismatch)
    return {"entries": [_to_json(r) for r in rows]}


def _to_json(r: NetworkDiagnostic) -> dict[str, Any]:
    """camelCase view model for the admin web page."""
    return {
        "id": r.id,
        "at": r.created_at.isoformat(),
        "reason": r.reason,
        "address": r.address,
        "wagmiChainId": r.wagmi_chain_id,
        "walletChainId": r.wallet_chain_id,
        "chainMismatch": r.chain_mismatch,
        "status": r.wagmi_status,
        "connectorId": r.connector_id,
        "connectorName": r.connector_name,
        "isMetaMask": r.is_metamask,
        "injectedCount": r.injected_count,
        "injectedNames": list(r.injected_names),
        "userAgent": r.user_agent,
        "buildId": r.build_id,
    }
