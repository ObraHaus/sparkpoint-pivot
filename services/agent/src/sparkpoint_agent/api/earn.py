"""Features 069/070 — the data-driven earn registry (Morpho + Kamino) HTTP surface.

  GET  /earn/vaults                    — the filtered snapshot + rails + snapshot age
  GET  /earn/vaults/{chain}/{address}  — one vault
  POST /earn/preview                   — a DRY preview only (no live quote in phase A)

Reads never call Morpho: the snapshot is refreshed by a background task. The preview may call
1Click with ``dry=true`` (the same client/route as 068). Nothing here signs, submits or takes
custody; ``dry=false`` is rejected in this phase.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..crosschain.addresses import expected_address_description, is_valid_address
from ..crosschain.config import AddressKind
from ..crosschain.oneclick import CrossChainError
from ..earn.config import EarnConfig, default_config
from ..earn.registry import EarnSnapshot
from ..earn.service import EarnService, build_service_from_env
from .errors import ApiError, ErrorCode
from .rate_limit import SlidingWindowLimiter
from .security import AccountContext
from .vault import get_account

logger = logging.getLogger(__name__)

router = APIRouter(tags=["earn"])

EARN_RATE_LIMIT_PER_HOUR = 120


def get_earn_config() -> EarnConfig:
    return default_config()


def get_earn_service() -> EarnService | None:
    return build_service_from_env()


def get_earn_limiter() -> SlidingWindowLimiter:
    return _LIMITER


def get_rhea_wallet(
    account: Annotated[AccountContext, Depends(get_account)],
) -> str:
    """The signed-in user's EVM wallet — the only identity a Rhea read is scoped to.

    Deliberately NOT a query/body parameter: the production path can never be pointed at an
    arbitrary wallet. Tests override this dependency to inject a wallet.
    """
    return account.owner


_LIMITER = SlidingWindowLimiter(limit=EARN_RATE_LIMIT_PER_HOUR, window_s=3600)


class PreviewBody(BaseModel):
    chain: str = Field(min_length=1, max_length=32)
    vaultAddress: str = Field(min_length=8, max_length=80)
    originKey: str = Field(min_length=1, max_length=80)
    amount: str = Field(min_length=1, max_length=40)
    recipient: str | None = Field(default=None, max_length=80)
    dry: bool = True


def _require_service(service: EarnService | None) -> EarnService:
    if service is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Earn yield is temporarily unavailable on this deployment.",
        )
    return service


def _snapshot_meta(snapshot: EarnSnapshot | None, source: str | None) -> dict[str, Any]:
    if snapshot is None:
        return {"state": "unavailable", "source": None, "ageMinutes": None}
    return {
        "state": "ready",
        "fetchedAt": snapshot.fetched_at.isoformat(),
        "source": source or snapshot.source,
        "ageMinutes": snapshot.age_minutes(),
    }


def _parse_min_tvl(raw: str | None) -> Decimal | None:
    if raw is None or not raw.strip():
        return None
    try:
        value = Decimal(raw.replace(",", "").strip())
    except InvalidOperation as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "minTvl must be a number") from exc
    if not value.is_finite() or value < 0:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "minTvl must be a non-negative number")
    return value


def _check_limit(limiter: SlidingWindowLimiter, account: AccountContext) -> None:
    if not limiter.allow(account.owner):
        raise ApiError(
            ErrorCode.RATE_LIMITED,
            "Too many earn requests — please try again later.",
            headers={"Retry-After": str(EARN_RATE_LIMIT_PER_HOUR * 60)},
        )


@router.get("/earn/vaults")
async def list_earn_vaults(
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[EarnService | None, Depends(get_earn_service)],
    chain: Annotated[str | None, Query(max_length=32)] = None,
    asset: Annotated[str | None, Query(max_length=16)] = None,
    protocol: Annotated[str | None, Query(max_length=16)] = None,
    rail: Annotated[str | None, Query(max_length=32)] = None,
    min_tvl: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    sort: Annotated[Literal["tvl", "apy"], Query()] = "tvl",
) -> dict[str, Any]:
    """The current filtered snapshot. Morpho is never called from this handler."""
    svc = _require_service(service)
    if chain is not None and svc.config.chain(chain) is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown chain {chain!r}")
    if rail is not None and rail not in {
        "direct",
        "oneclick_earn",
        "oneclick_rhea",
        "intents_connect",
    }:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown rail {rail!r}")
    if protocol is not None and protocol.lower() not in {"morpho", "kamino", "rhea"}:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown protocol {protocol!r}")
    vaults, snapshot = svc.list_vaults(
        chain=chain,
        asset=asset,
        rail=rail,
        protocol=protocol,
        min_tvl=_parse_min_tvl(min_tvl),
        limit=limit,
        sort=sort,
    )
    return {
        "featureEnabled": svc.feature_enabled,
        "snapshot": _snapshot_meta(snapshot, svc.registry.loaded_from),
        "count": len(vaults),
        "vaults": vaults,
    }


@router.get("/earn/vaults/{chain}/{address}")
async def get_earn_vault(
    chain: str,
    address: str,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[EarnService | None, Depends(get_earn_service)],
) -> dict[str, Any]:
    svc = _require_service(service)
    found = svc.get_vault(chain, address)
    if found is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No earn vault at that address in the snapshot.")
    vault, snapshot = found
    return {
        "featureEnabled": svc.feature_enabled,
        "snapshot": _snapshot_meta(snapshot, svc.registry.loaded_from),
        "vault": vault,
    }


@router.get("/earn/rhea/positions")
async def get_rhea_positions(
    account: Annotated[AccountContext, Depends(get_account)],
    wallet: Annotated[str, Depends(get_rhea_wallet)],
    service: Annotated[EarnService | None, Depends(get_earn_service)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_earn_limiter)],
) -> dict[str, Any]:
    """Read-only Rhea (Burrow) supply positions for the SIGNED-IN wallet.

    The wallet is the session identity (``X-Owner`` via the middleware), never a caller-supplied
    parameter. Nothing is signed or sent; this is a NEAR view read.
    """
    _check_limit(limiter, account)
    svc = _require_service(service)
    try:
        outcome = await svc.rhea_positions(wallet=wallet)
    except ValueError as exc:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "A signed-in wallet is required to read Rhea positions.",
        ) from exc
    wire = outcome.block.to_wire()
    wire["text"] = outcome.text
    return wire


@router.post("/earn/preview")
async def preview_earn_vault(
    body: PreviewBody,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[EarnService | None, Depends(get_earn_service)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_earn_limiter)],
) -> dict[str, Any]:
    """A DRY preview only. ``dry=false`` is rejected: phase A has no live deposit flow here."""
    _check_limit(limiter, account)
    svc = _require_service(service)
    if not body.dry:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Only dry previews are available for earn in this phase; no live quote was made.",
        )
    if svc.config.chain(body.chain) is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown chain {body.chain!r}")
    origin = svc.crosschain.asset(body.originKey)
    if origin is None:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"unknown origin asset {body.originKey!r}")

    found = svc.get_vault(body.chain, body.vaultAddress)
    if found is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No earn vault at that address.")
    if body.recipient:
        receipt = svc.config.receipt_for_vault(body.vaultAddress)
        if receipt is not None:
            kind: AddressKind = "sol" if receipt.chain == "sol" else "evm"
            if not is_valid_address(body.recipient, kind):
                raise ApiError(
                    ErrorCode.VALIDATION_ERROR,
                    f"recipient must be {expected_address_description(kind)}",
                )

    from ..crosschain.service import amount_from_human

    parsed = amount_from_human(body.amount, origin.decimals)
    if parsed is None:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"amount must be a positive number with at most {origin.decimals} decimal places",
        )
    amount, amount_raw = parsed
    try:
        outcome = await svc.preview_for(
            chain=body.chain,
            address=body.vaultAddress,
            origin_key=body.originKey,
            amount=amount,
            amount_raw=amount_raw,
            recipient=body.recipient,
            wallet=account.owner,
        )
    except ValueError as exc:
        raise ApiError(ErrorCode.NOT_FOUND, "No earn vault at that address.") from exc
    except CrossChainError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The routing service is unavailable right now.",
        ) from exc
    wire = outcome.block.to_wire()
    wire["text"] = outcome.text
    return wire
