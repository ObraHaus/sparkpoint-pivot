"""Feature 012 - POST /subscription/verify: verify an SRK Premium payment on-chain, then grant it.

Buyer = the server-scoped owner (``account.owner``), NEVER a body field: the only client-supplied
fact is a tx hash. Chain-pinned to Base Sepolia (84532) where the test SRK lives. Every material
fact is read from chain; the grant is idempotent on the payment tx hash (the ``payments`` UNIQUE
key), so a replayed hash grants Premium zero additional times.

NON-CUSTODY (N1/N2): the payment is user-signed, this endpoint holds no key and signs nothing, and
the entitlement is advisory-compute only - it never gates the vault or the withdraw/exit path.
"""

from __future__ import annotations

import os
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..chain.payment_verifier import PaymentInvalid, PaymentVerifier, Pending
from ..config import AgentConfig
from ..data.log_source import HttpxLogsRpc
from ..db import Database, get_database
from ..db.subscriptions import PaymentAlreadyRecorded, SubscriptionStore
from .errors import ApiError, ErrorCode
from .security import AccountContext
from .vault import get_account

#: SRK is Base-Sepolia-only; verification always runs against 84532, whatever chain is asserted.
SRK_CHAIN_ID = 84532
#: The canonical Premium price in SRK BASE UNITS (18 dp) - client-decided 2026-08-02, 500 -> 10,000.
#:
#: ``PREMIUM_PRICE_SRK`` is compared directly against an ERC-20 ``Transfer`` value, so it is BASE
#: UNITS, not whole tokens: the deployed env value must be ``10000000000000000000000``. A bare
#: ``10000`` would be 1e-14 SRK and would accept a dust payment. This constant is the fallback when
#: the env is unset, and MUST stay equal to the web's ``PREMIUM_PRICE_SRK_WHOLE`` * 1e18
#: (``apps/web/src/lib/chain/premiumPay.ts``) - the verifier accepts ``value >= price``, so a web
#: price BELOW the agent's is what breaks a purchase.
PREMIUM_PRICE_SRK_DEFAULT_RAW = 10_000 * 10**18
#: The seeded logical network id (`networks` seeds only 'base'; develop points it at Base Sepolia).
_NETWORK_ID = "base"

router = APIRouter(tags=["subscription"])


class PurchaseSubmit(BaseModel):
    """The ONLY client-supplied fact. The buyer is NEVER from the body (it is account.owner)."""

    txHash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


def _env_int(name: str) -> int | None:
    raw = os.getenv(name)
    return int(raw) if raw and raw.strip() else None


def get_subscription_store() -> SubscriptionStore:
    """The subscription store over the shared asyncpg pool (mirrors ``get_limits_store``)."""
    try:
        return SubscriptionStore(get_database())
    except Exception:
        return SubscriptionStore(cast(Database, None))


def get_payment_verifier(
    account: Annotated[AccountContext, Depends(get_account)],  # noqa: ARG001 (pins the auth scope)
) -> PaymentVerifier:
    """Build the keyless verifier from the billing constants + the 84532 RPC.

    Fails CLOSED (never a fabricated "invalid") when Premium is not configured on this deployment or
    no RPC is available. Constants are read directly (like ``PREMIUM_ALLOWLIST``), kept out of the
    keyless ``AgentConfig``.
    """
    srk = os.getenv("SRK_ADDRESS_84532")
    treasury = os.getenv("PREMIUM_TREASURY_ADDRESS")
    # The price falls back to the canonical constant so a missing env can never under-charge; the
    # SRK address + treasury stay REQUIRED, so an unconfigured deployment still fails closed.
    price = _env_int("PREMIUM_PRICE_SRK") or PREMIUM_PRICE_SRK_DEFAULT_RAW
    if not srk or not treasury:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "Premium purchase is not available on this deployment."
        )
    rpc_url = AgentConfig.from_env().for_chain(SRK_CHAIN_ID).rpc_url
    if not rpc_url:
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, "No RPC is configured for the SRK network.")
    return PaymentVerifier(
        rpc=HttpxLogsRpc(rpc_url),
        srk_address=srk,
        treasury=treasury,
        price_raw=price,
        min_confirmations=_env_int("PREMIUM_MIN_CONFIRMATIONS") or 3,
    )


@router.post("/subscription/verify")
async def verify_purchase(
    body: PurchaseSubmit,
    account: Annotated[AccountContext, Depends(get_account)],
    verifier: Annotated[PaymentVerifier, Depends(get_payment_verifier)],
    subs: Annotated[SubscriptionStore, Depends(get_subscription_store)],
) -> dict[str, Any]:
    """Verify the SRK payment for the scoped buyer, then grant Premium (idempotent on tx hash)."""
    try:
        result = await verifier.verify(tx_hash=body.txHash, buyer=account.owner)
    except PaymentInvalid as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    except RuntimeError as exc:  # RPC/transport outage - retryable, not a false "invalid"
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE, "Could not reach the network to verify the payment."
        ) from exc

    if isinstance(result, Pending):
        return {"status": "pending", "reason": result.reason}

    try:
        expires_at = await subs.record_and_grant(
            buyer=result.buyer,
            tx_hash=result.tx_hash,
            network_id=_NETWORK_ID,
            token=result.token,
            amount_raw=result.amount_raw,
            block_number=result.block_number,
        )
    except PaymentAlreadyRecorded:
        # A replay of an already-banked payment: no second grant, but not an error for the user.
        return {"status": "already_granted"}
    return {"status": "granted", "tier": "premium", "expiresAt": expires_at.isoformat()}
