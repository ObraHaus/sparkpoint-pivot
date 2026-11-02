"""Feature 072 — ``GET /portfolio/multichain`` (read-only, session wallet only).

The wallet is ALWAYS the signed-in session wallet from :func:`get_account` (``X-Owner`` asserted by
the middleware). There is deliberately no wallet/address query or body parameter: passing one is
rejected rather than ignored, so the production surface can never be pointed at an arbitrary
address. The existing ``GET /portfolio`` (the SparkPoint vault view) is untouched.

Nothing here signs, submits or holds a key. Each source is read-only and degrades to a status on its
own section; the endpoint returns 200 with honest ``unavailable``/``not_linked`` entries rather than
failing the whole response.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from ..portfolio.models import PortfolioOverview
from ..portfolio.service import MultichainPortfolioService, build_service_from_env
from ..portfolio.text import render_text
from .errors import ApiError, ErrorCode
from .rate_limit import SlidingWindowLimiter
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["portfolio"])

PORTFOLIO_RATE_LIMIT_PER_HOUR = 120

#: Parameters that would try to re-point a session-scoped read at another wallet. None of these
#: exists in the route signature; seeing one is an explicit rejection, not a silently ignored value.
_FORBIDDEN_PARAMS = ("wallet", "address", "owner", "account", "user", "eoa")

_SERVICE: MultichainPortfolioService | None = None
_LIMITER = SlidingWindowLimiter(limit=PORTFOLIO_RATE_LIMIT_PER_HOUR, window_s=3600)


def get_portfolio_service() -> MultichainPortfolioService:
    """The process-wide read-only portfolio service (overridden in tests)."""
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = build_service_from_env()
    return _SERVICE


def get_portfolio_limiter() -> SlidingWindowLimiter:
    return _LIMITER


def _check_limit(limiter: SlidingWindowLimiter, account: AccountContext) -> None:
    if not limiter.allow(account.owner):
        raise ApiError(
            ErrorCode.RATE_LIMITED,
            "Too many portfolio requests — please try again later.",
            headers={"Retry-After": str(PORTFOLIO_RATE_LIMIT_PER_HOUR * 60)},
        )


@router.get("/portfolio/multichain")
async def get_multichain_portfolio(
    request: Request,
    account: Annotated[AccountContext, Depends(get_account)],
    service: Annotated[MultichainPortfolioService, Depends(get_portfolio_service)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_portfolio_limiter)],
) -> dict[str, Any]:
    """Read the signed-in wallet's multi-chain portfolio (session wallet only)."""
    for name in _FORBIDDEN_PARAMS:
        if name in request.query_params:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "This endpoint is scoped to the signed-in wallet; wallet parameters are not "
                "accepted.",
            )
    _check_limit(limiter, account)
    overview: PortfolioOverview = await service.read(account.owner, focus="all")
    wire = overview.to_wire()
    wire["text"] = render_text(overview, "all")
    return wire


__all__ = [
    "PORTFOLIO_RATE_LIMIT_PER_HOUR",
    "get_portfolio_limiter",
    "get_portfolio_service",
    "router",
]
