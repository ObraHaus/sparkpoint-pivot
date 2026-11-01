"""Feature 068 — cross-chain swap quotes, confirmation and live status (1Click).

Three endpoints, all behind the same S2S bearer + account scoping the rest of the agent uses:

  GET  /crosschain/assets         — the config-driven enabled/disabled asset table (no secrets)
  POST /crosschain/quote          — ``dry=true`` (default) is a preview; ``dry=false`` is a live
                                    quote, returns the 1Click deposit address and persists the row
  POST /crosschain/deposit/submit — forward the user's origin tx hash for one OWNED deposit
  GET  /crosschain/status         — live status for one OWNED deposit address

Non-custody: the app never signs, holds a key, or sends funds. A live quote tells the user where
to deposit; they broadcast the origin transaction from their own wallet. Every ownership check is
a query keyed by ``(X-Owner, depositAddress)`` — a caller cannot read or submit another wallet's
quote. 1Click is never called with ``dry=false`` in tests.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..crosschain.addresses import (
    expected_address_description,
    is_valid_address,
    placeholder_for,
)
from ..crosschain.config import CrossChainAsset, CrossChainConfig, default_config
from ..crosschain.oneclick import (
    CrossChainError,
    CrossChainTransportError,
    QuoteResult,
    QuoteUnavailable,
)
from ..crosschain.service import (
    CrossChainService,
    amount_from_human,
    build_service_from_env,
    format_raw_units,
)
from ..db import CrossChainQuoteStore, get_database
from .errors import ApiError, ErrorCode
from .rate_limit import SlidingWindowLimiter
from .security import AccountContext
from .vault import get_account

logger = logging.getLogger(__name__)

router = APIRouter(tags=["crosschain"])

#: A generous per-wallet cap on quote/submit calls. Advisory abuse control only — the real
#: guard is 1Click's own limits and the fact that a quote cannot move funds.
CROSSCHAIN_RATE_LIMIT_PER_HOUR = 120


def get_crosschain_config() -> CrossChainConfig:
    return default_config()


def get_crosschain_service() -> CrossChainService | None:
    return build_service_from_env()


def get_crosschain_store() -> CrossChainQuoteStore:
    return CrossChainQuoteStore(get_database())


def get_crosschain_limiter() -> SlidingWindowLimiter:
    return _LIMITER


_LIMITER = SlidingWindowLimiter(
    limit=CROSSCHAIN_RATE_LIMIT_PER_HOUR,
    window_s=3600,
)


class QuoteBody(BaseModel):
    originKey: str = Field(min_length=1, max_length=80)
    destinationKey: str = Field(min_length=1, max_length=80)
    amount: str = Field(min_length=1, max_length=40)
    recipient: str | None = Field(default=None, max_length=120)
    refundTo: str | None = Field(default=None, max_length=120)
    dry: bool = True


class DepositSubmitBody(BaseModel):
    depositAddress: str = Field(min_length=8, max_length=120)
    txHash: str = Field(min_length=8, max_length=160)


def _require_service(service: CrossChainService | None) -> CrossChainService:
    if service is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Cross-chain swaps are temporarily unavailable.",
        )
    return service


def _asset_pair(
    config: CrossChainConfig, origin_key: str, destination_key: str
) -> tuple[CrossChainAsset, CrossChainAsset]:
    origin = config.asset(origin_key)
    destination = config.asset(destination_key)
    if origin is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown origin asset {origin_key!r}")
    if destination is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown destination asset {destination_key!r}")
    return origin, destination


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _human(amount: Any) -> str:
    text = format(amount, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _disabled_reason(origin: CrossChainAsset, destination: CrossChainAsset) -> str | None:
    for asset in (origin, destination):
        if not asset.enabled:
            return (
                asset.unavailable_reason
                or f"1Click is not quoting {asset.chain_label} payouts right now"
            )
    return None


def _quote_wire(
    *,
    state: str,
    origin: CrossChainAsset,
    destination: CrossChainAsset,
    amount_human: str,
    slippage_bps: int,
    quote: QuoteResult | None = None,
    fee_note: str | None = None,
    expires_hint: str | None = None,
) -> dict[str, Any]:
    wire: dict[str, Any] = {
        "state": state,
        "origin": origin.origin_wire(amount_human),
        "destination": destination.destination_wire(),
        "slippageBps": slippage_bps,
        "quotedAt": _now_iso(),
    }
    if quote is not None:
        wire["amountOut"] = quote.amount_out_formatted
        wire["minAmountOut"] = format_raw_units(quote.min_amount_out, destination.decimals)
        for key, value in (
            ("amountOutUsd", quote.amount_out_usd),
            ("amountInUsd", quote.amount_in_usd),
            ("timeEstimateSec", quote.time_estimate_sec),
            ("depositAddress", quote.deposit_address),
            ("deadline", quote.deadline),
        ):
            if value is not None:
                wire[key] = value
    if fee_note is not None:
        wire["feeNote"] = fee_note
    if expires_hint is not None:
        wire["expiresHint"] = expires_hint
    return wire


def _unavailable_wire(
    origin: CrossChainAsset,
    destination: CrossChainAsset,
    amount_human: str,
    reason: str,
    slippage_bps: int,
) -> dict[str, Any]:
    wire = _quote_wire(
        state="unavailable",
        origin=origin,
        destination=destination,
        amount_human=amount_human,
        slippage_bps=slippage_bps,
    )
    wire["unavailableReason"] = reason
    return wire


def _check_limit(limiter: SlidingWindowLimiter, account: AccountContext) -> None:
    if not limiter.allow(account.owner):
        raise ApiError(
            ErrorCode.RATE_LIMITED,
            "Too many cross-chain requests — please try again later.",
            headers={"Retry-After": str(CROSSCHAIN_RATE_LIMIT_PER_HOUR * 60)},
        )


@router.get("/crosschain/assets")
async def crosschain_assets(
    account: Annotated[AccountContext, Depends(get_account)],
    config: Annotated[CrossChainConfig, Depends(get_crosschain_config)],
) -> dict[str, Any]:
    """Enabled/disabled routes from config. Keyless and secret-free."""
    return {
        "featureEnabled": config.feature_enabled,
        "slippageBps": config.slippage_bps,
        "deadlineMinutes": config.deadline_minutes,
        "assets": config.public_assets(),
    }


@router.post("/crosschain/quote")
async def crosschain_quote(
    body: QuoteBody,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[CrossChainService | None, Depends(get_crosschain_service)],
    store: Annotated[CrossChainQuoteStore, Depends(get_crosschain_store)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_crosschain_limiter)],
) -> dict[str, Any]:
    """Preview (``dry=true``, the default) or a live quote that returns a deposit address.

    A disabled route (Tron today) is an ordinary 200 ``state=unavailable`` answer, never a 500.
    ``dry=false`` validates the destination/refund addresses, persists the quote for its owner,
    and returns the 1Click deposit address and deadline.
    """
    _check_limit(limiter, account)
    svc = _require_service(service)
    origin, destination = _asset_pair(svc.config, body.originKey, body.destinationKey)
    parsed = amount_from_human(body.amount, origin.decimals)
    if parsed is None:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"amount must be a positive number with at most {origin.decimals} decimal places",
        )
    amount, amount_raw = parsed
    amount_human = _human(amount)

    disabled = _disabled_reason(origin, destination)
    if disabled is not None:
        return _unavailable_wire(
            origin, destination, amount_human, disabled, svc.config.slippage_bps
        )

    recipient = body.recipient
    refund_to = body.refundTo
    if body.dry:
        recipient = recipient or _placeholder(destination)
        refund_to = refund_to or _placeholder(origin)
    else:
        if not recipient:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "recipient is required to confirm a cross-chain quote",
            )
        if not is_valid_address(recipient, destination.address_kind):
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                f"recipient must be {expected_address_description(destination.address_kind)}",
            )
        if not refund_to:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "refundTo is required to confirm a cross-chain quote",
            )
        if not is_valid_address(refund_to, origin.address_kind):
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                f"refundTo must be {expected_address_description(origin.address_kind)}",
            )

    try:
        quote = await svc.request_quote(
            origin_key=origin.key,
            destination_key=destination.key,
            amount_raw=amount_raw,
            dry=body.dry,
            recipient=recipient,
            refund_to=refund_to,
        )
    except QuoteUnavailable as exc:
        return _unavailable_wire(
            origin, destination, amount_human, exc.reason, svc.config.slippage_bps
        )
    except CrossChainError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The cross-chain routing service is unavailable right now.",
        ) from exc

    fee_note = None if svc.client.has_api_key else "Includes 1Click's 0.25% keyless routing fee."
    expires_hint = f"Quote expires in about {svc.config.deadline_minutes} minutes."
    wire = _quote_wire(
        state="preview" if body.dry else "live",
        origin=origin,
        destination=destination,
        amount_human=amount_human,
        slippage_bps=svc.config.slippage_bps,
        quote=quote,
        fee_note=fee_note,
        expires_hint=expires_hint,
    )

    if body.dry:
        return wire

    if not quote.deposit_address:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "1Click did not return a deposit address; nothing was persisted.",
        )
    try:
        stored = await store.record(
            owner_eoa=account.owner,
            origin_key=origin.key,
            destination_key=destination.key,
            amount_in=amount_human,
            deposit_address=quote.deposit_address,
            deadline=quote.deadline,
            quote_response=quote.raw,
            last_status=None,
        )
    except Exception as exc:  # noqa: BLE001 — cannot bind the address to its owner ⇒ fail closed
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The cross-chain quote was created but could not be recorded; please retry.",
        ) from exc
    wire["quoteId"] = stored.get("id")
    return wire


def _placeholder(asset: CrossChainAsset) -> str:
    return placeholder_for(asset.address_kind)


@router.post("/crosschain/deposit/submit")
async def crosschain_submit_deposit(
    body: DepositSubmitBody,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[CrossChainService | None, Depends(get_crosschain_service)],
    store: Annotated[CrossChainQuoteStore, Depends(get_crosschain_store)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_crosschain_limiter)],
) -> dict[str, Any]:
    """Forward an origin tx hash for a deposit the CALLER owns (optional speed-up)."""
    _check_limit(limiter, account)
    svc = _require_service(service)
    owned = await store.get_owned(account.owner, body.depositAddress)
    if owned is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No cross-chain quote for that deposit address.")
    try:
        result = await svc.submit_deposit(deposit_address=body.depositAddress, tx_hash=body.txHash)
    except CrossChainTransportError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The cross-chain routing service is unavailable right now.",
        ) from exc
    except CrossChainError as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    return {"ok": True, "depositAddress": body.depositAddress, "result": result}


@router.get("/crosschain/status")
async def crosschain_status(
    depositAddress: str,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[CrossChainService | None, Depends(get_crosschain_service)],
    store: Annotated[CrossChainQuoteStore, Depends(get_crosschain_store)],
) -> dict[str, Any]:
    """Live 1Click status for an OWNED deposit address (and remember it on the row)."""
    svc = _require_service(service)
    owned = await store.get_owned(account.owner, depositAddress)
    if owned is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No cross-chain quote for that deposit address.")
    try:
        payload = await svc.status(deposit_address=depositAddress)
    except CrossChainTransportError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The cross-chain routing service is unavailable right now.",
        ) from exc
    except CrossChainError as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    status = str(payload.get("status", "UNKNOWN"))
    try:
        await store.update_status(depositAddress, status)
    except Exception:  # noqa: BLE001 — status is the answer; the cache write is best-effort
        logger.info("crosschain_status_cache_write_failed")
    return {
        "status": status,
        "depositAddress": depositAddress,
        "swapDetails": payload.get("swapDetails"),
    }
