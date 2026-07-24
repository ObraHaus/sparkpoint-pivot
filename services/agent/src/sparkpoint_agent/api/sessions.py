"""Session-key grant / revoke / list endpoints (feature 022 US6; agent-service-api §3.9).

  POST /session-keys/grant/build   — validate a SessionScope (§6) + build the UNSIGNED owner tx that
                                      authorizes the scoped key; returns the scope echoed verbatim.
  POST /session-keys/revoke/build  — build the UNSIGNED owner revoke tx (a SACRED EXIT: always
                                      buildable, never gated, N2).
  GET  /session-keys               — list the account's session keys (the on-chain-mirror store).

NON-CUSTODY (N1/N3/N4): the service builds UNSIGNED transactions only — it never signs and never
holds a session private key (the owner signs the grant/revoke in their own wallet). The scope is
validated by the deterministic `SessionScope` §6 grammar BEFORE a signable tx is produced (an
out-of-policy grant yields reasons, never a tx). Revoke is a sacred exit: always built, never gated
(N2). The chain is the source of truth; the store is an advisory mirror.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Annotated

import eth_abi
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..config import AgentConfig
from ..db import SessionKeyStore, get_database
from ..policy import (
    POLICY_VERSION,
    PolicyContext,
    SessionScope,
    SessionScopePair,
    evaluate_session_grant,
)
from .security import AccountContext
from .vault import get_account, get_sim_config

logger = logging.getLogger("sparkpoint_agent.api.sessions")
router = APIRouter(tags=["sessions"])

# selector: authorizeSessionKey(Policy, address[], bytes4[]) — Policy tuple = _POLICY_TYPE below
_AUTHORIZE_SELECTOR = "0xbc3cabbb"
_REVOKE_SELECTOR = "0x84f4fc6a"  # revokeSessionKey(address)
_POLICY_TYPE = "(address,uint48,uint48,uint128,uint128,uint128,uint16,bool)"


def get_session_store() -> SessionKeyStore:
    """The session-key mirror store (overridable in tests)."""
    return SessionKeyStore(get_database())


# ── Wire models ──────────────────────────────────────────────────────────────


class AllowlistPair(BaseModel):
    target: str
    selector: str  # 0x-prefixed 4-byte selector


class GrantBuildRequest(BaseModel):
    sessionPubkey: str
    validUntil: int  # unix seconds (hard expiry, required)
    validAfter: int = 0  # unix seconds (0 = active now)
    perTxCap: int  # USDC base units
    cumulativeCap: int
    maxSlippageBps: int = 0
    allowlist: list[AllowlistPair] = Field(default_factory=list)


class RevokeBuildRequest(BaseModel):
    sessionPubkey: str


class UnsignedTx(BaseModel):
    to: str
    data: str
    value: str = "0x0"
    chainId: int


class ScopeEcho(BaseModel):
    """The normalized on-chain Policy shape displayed verbatim to the user (FR-029)."""

    sessionKey: str
    validAfter: int
    validUntil: int
    perTxCap: str  # base-unit string (exact, no float)
    cumulativeCap: str
    maxSlippageBps: int
    allowlist: list[AllowlistPair]
    recipientPin: str = "user_account"
    revocable: bool = True
    spent: str = "0"


class GrantBuildResponse(BaseModel):
    ok: bool
    policyVersion: str
    reasons: list[str]
    scopeEcho: ScopeEcho | None = None
    tx: UnsignedTx | None = None


class RevokeBuildResponse(BaseModel):
    tx: UnsignedTx


class SessionKeyItem(BaseModel):
    sessionKey: str
    status: str
    allowlist: list[AllowlistPair]
    perTxCap: str
    cumulativeCap: str
    spent: str
    maxSlippageBps: int
    validUntil: int
    validAfter: int | None
    registeredTxHash: str | None
    revokedTxHash: str | None


class SessionKeysResponse(BaseModel):
    account: str
    sessionKeys: list[SessionKeyItem]


# ── Encoding helpers (keccak-free; the selectors are pinned constants) ─────────


def _encode_authorize(scope: SessionScope) -> str:
    policy = (
        scope.session_key,
        scope.valid_after,
        scope.valid_until,
        scope.per_tx_cap,
        scope.cumulative_cap,
        0,  # spent — ignored on-chain (preserved), sent as 0
        scope.max_slippage_bps,
        False,  # revoked
    )
    targets = [p.target for p in scope.allowlist]
    selectors = [bytes.fromhex(p.selector[2:]) for p in scope.allowlist]
    encoded = eth_abi.encode([_POLICY_TYPE, "address[]", "bytes4[]"], [policy, targets, selectors])
    return _AUTHORIZE_SELECTOR + encoded.hex()


def _encode_revoke(session_pubkey: str) -> str:
    return _REVOKE_SELECTOR + eth_abi.encode(["address"], [session_pubkey]).hex()


def _to_pairs(allowlist: list[AllowlistPair]) -> tuple[SessionScopePair, ...]:
    return tuple(SessionScopePair(target=p.target, selector=p.selector) for p in allowlist)


def _effective_status(
    status: str, valid_until: datetime, spent: int, cap: int, now: datetime
) -> str:
    """Chain-truth status derivation: revoked stays revoked; else expired/exhausted/active."""
    if status == "revoked":
        return "revoked"
    if now >= valid_until:
        return "expired"
    if spent >= cap:
        return "exhausted"
    return "active"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/session-keys/grant/build", response_model=GrantBuildResponse)
async def grant_build(
    body: GrantBuildRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    store: Annotated[SessionKeyStore, Depends(get_session_store)],
) -> GrantBuildResponse:
    """Validate the SessionScope (§6); build the unsigned owner authorize tx, or return reasons."""
    scope = SessionScope(
        session_key=body.sessionPubkey,
        valid_after=body.validAfter,
        valid_until=body.validUntil,
        per_tx_cap=body.perTxCap,
        cumulative_cap=body.cumulativeCap,
        max_slippage_bps=body.maxSlippageBps,
        allowlist=_to_pairs(body.allowlist),
    )
    resolved: dict[str, str] = {}
    if config.vault_address is not None:
        resolved["sparkpoint_vault"] = config.vault_address
    ctx = PolicyContext(
        chain_id=account.chain_id,
        user_account=account.account,
        owner=account.owner,
        resolved_targets=resolved,
    )
    result = evaluate_session_grant(scope, ctx, now_ts=int(time.time()))
    if not result.verdict.approved or result.scope is None:
        return GrantBuildResponse(
            ok=False,
            policyVersion=POLICY_VERSION,
            reasons=[c.value for c in result.verdict.reasons],
        )

    echo = ScopeEcho(
        sessionKey=scope.session_key,
        validAfter=scope.valid_after,
        validUntil=scope.valid_until,
        perTxCap=str(scope.per_tx_cap),
        cumulativeCap=str(scope.cumulative_cap),
        maxSlippageBps=scope.max_slippage_bps,
        allowlist=body.allowlist,
    )
    # Mirror the intended grant (best-effort; the chain is authoritative). Never blocks the build.
    try:
        await store.upsert_grant(
            smart_account_address=account.account,
            owner_address=account.owner,
            chain_id=account.chain_id,
            session_pubkey=scope.session_key,
            allowlisted_targets=[p.target for p in scope.allowlist],
            allowlisted_selectors=[p.selector for p in scope.allowlist],
            per_tx_cap_raw=scope.per_tx_cap,
            cumulative_cap_raw=scope.cumulative_cap,
            max_slippage_bps=scope.max_slippage_bps,
            valid_until=datetime.fromtimestamp(scope.valid_until, tz=UTC),
            valid_after=(
                datetime.fromtimestamp(scope.valid_after, tz=UTC) if scope.valid_after else None
            ),
        )
    except Exception:  # noqa: BLE001 — the mirror is advisory; never fail the (keyless) build on it
        logger.debug("session_key grant mirror write skipped", exc_info=True)

    return GrantBuildResponse(
        ok=True,
        policyVersion=POLICY_VERSION,
        reasons=["OK"],
        scopeEcho=echo,
        tx=UnsignedTx(to=account.account, data=_encode_authorize(scope), chainId=account.chain_id),
    )


@router.post("/session-keys/revoke/build", response_model=RevokeBuildResponse)
async def revoke_build(
    body: RevokeBuildRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[SessionKeyStore, Depends(get_session_store)],
) -> RevokeBuildResponse:
    """Build the unsigned owner revoke tx — a SACRED EXIT: always buildable, never gated (N2)."""
    try:
        await store.mark_revoked(
            smart_account_address=account.account, session_pubkey=body.sessionPubkey
        )
    except Exception:  # noqa: BLE001 — the mirror is advisory; revoke is never blocked on it
        logger.debug("session_key revoke mirror write skipped", exc_info=True)
    return RevokeBuildResponse(
        tx=UnsignedTx(
            to=account.account, data=_encode_revoke(body.sessionPubkey), chainId=account.chain_id
        )
    )


@router.get("/session-keys", response_model=SessionKeysResponse)
async def list_session_keys(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[SessionKeyStore, Depends(get_session_store)],
) -> SessionKeysResponse:
    """List the account's session keys from the on-chain-mirror store (fail-open to empty)."""
    now = datetime.now(tz=UTC)
    items: list[SessionKeyItem] = []
    try:
        rows = await store.list_by_account(account.account)
    except Exception:  # noqa: BLE001 — advisory list; never 500 (fail-open)
        rows = []
    for r in rows:
        pairs = [
            AllowlistPair(target=t, selector=s)
            for t, s in zip(r.allowlisted_targets, r.allowlisted_selectors, strict=False)
        ]
        items.append(
            SessionKeyItem(
                sessionKey=r.session_pubkey,
                status=_effective_status(
                    r.status, r.valid_until, r.spent_raw, r.cumulative_cap_raw, now
                ),
                allowlist=pairs,
                perTxCap=str(r.per_tx_cap_raw),
                cumulativeCap=str(r.cumulative_cap_raw),
                spent=str(r.spent_raw),
                maxSlippageBps=r.max_slippage_bps,
                validUntil=int(r.valid_until.timestamp()),
                validAfter=(int(r.valid_after.timestamp()) if r.valid_after else None),
                registeredTxHash=r.registered_tx_hash,
                revokedTxHash=r.revoked_tx_hash,
            )
        )
    return SessionKeysResponse(account=account.account, sessionKeys=items)
