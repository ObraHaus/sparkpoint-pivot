"""The §3.3 portfolio endpoints — enriched, derived, stale-markable (READ only).

agent-service-api.md §3.3 — ``GET /portfolio`` returns the derived/enriched portfolio
(positions, allocation, PnL, risk) and ``GET /portfolio/positions/{positionId}`` returns
one enriched position + its history. Neither endpoint holds a key, moves funds, or returns
a signature; both are advisory reads over the on-chain vault.

Custody-critical, stale-markable posture (§3.3, SC-011)
-------------------------------------------------------
The FRONTEND reads custody-critical balances via **direct RPC** and reconciles them
against this endpoint, so this endpoint is *allowed* to be ``stale`` / degraded without
blocking deposit or withdraw. Accordingly — and unlike the §3.7 quote surface, which
fails closed to a 503 — a chain outage here DEGRADES to ``200 + stale:true`` with
best-effort (zeroed) derived figures rather than a hard error (``DATA_STALE`` /
``UPSTREAM_UNAVAILABLE`` are surfaced as ``stale:true``, per §3.3). The
:class:`~sparkpoint_agent.chain.VaultUnavailable` raised by the reader is caught HERE so
it never reaches the app-level 503 handler.

Honesty (never a fabricated number)
-----------------------------------
- Custody balances come straight from the vault reader (``balanceOf`` →
  ``convertToAssets``); the underlying is USDC, valued at **$1 par** (the vault's stable
  underlying needs no oracle), with ``priceSource = "onchain"``.
- Cost basis / realized+unrealized PnL / a PnL time-series need the derived cost-basis
  index (owned by the fee indexer, not yet built) → exposed as ``null`` / ``[]``
  (best-effort), never fabricated — mirroring the §3.7 withdraw quote.
- ``concentrationBps`` is derivable from the live allocation and is populated; a risk
  ``score`` / ``drift`` need the risk model (not yet wired) → ``null``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..chain import VaultReader, VaultUnavailable
from .errors import ApiError, ErrorCode, ErrorReason
from .security import AccountContext
from .vault import get_account, get_vault_reader

router = APIRouter(tags=["portfolio"])

# The single vault position is addressed by this stable id (one ERC-4626 position per
# user). ``GET /portfolio/positions/vault`` resolves it; any other id is NOT_FOUND.
_VAULT_POSITION_ID = "vault"

# The vault is SparkPoint's conservative Aave-USDC yield strategy — a known static tier,
# not a derived/fabricated figure.
_VAULT_RISK_TIER = "conservative"
_VAULT_STRATEGY = "vault"

# §3.3 ``?include=`` sections.
_ALL_SECTIONS: frozenset[str] = frozenset({"positions", "pnl", "allocation", "risk"})

# The derived-index data source that backs the enriched figures. Its status flips to
# ``stale`` when the on-chain read degrades (custody balances still reconcile via the
# frontend's direct RPC, §3.3).
_DATA_SOURCE = "vault_rpc"


# ─────────────────────────────────────────────────────────────────────────────
# Response models (camelCase field names = the exact §3.3 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class PositionDetail(BaseModel):
    """§3.3 enriched position. Cost-basis/PnL are ``null`` until the fee indexer lands."""

    positionId: str
    venue: str
    asset: str  # 0x token address (USDC)
    shares: str
    underlying: str
    valueUsd: str
    priceSource: str
    costBasisUsd: str | None = None
    unrealizedPnlUsd: str | None = None
    riskTier: str | None = None


class AllocationSlice(BaseModel):
    """One allocation row — the share of net worth in a bucket (bps of 10000)."""

    key: str
    valueUsd: str
    bps: int


class Allocation(BaseModel):
    """§3.3 ``allocation`` — by asset / strategy / risk tier."""

    byAsset: list[AllocationSlice]
    byStrategy: list[AllocationSlice]
    byRiskTier: list[AllocationSlice]


class PnlSeriesPoint(BaseModel):
    """One point on the PnL time-series (needs the derived index → empty for now)."""

    ts: str
    valueUsd: str


class Pnl(BaseModel):
    """§3.3 ``pnl`` — realized/unrealized + a time-series (null/empty until indexed)."""

    series: list[PnlSeriesPoint]
    realizedUsd: str | None = None
    unrealizedUsd: str | None = None


class RiskSummary(BaseModel):
    """§3.3 ``risk`` — ``concentrationBps`` is derivable; ``score``/``drift`` need the model."""

    score: int | None = None
    concentrationBps: int | None = None
    drift: str | None = None


class DataSource(BaseModel):
    """§3.3 ``dataSources[]`` — provenance + freshness of the derived figures."""

    source: str
    status: str  # "ok" | "stale"
    lastBlock: int | None = None


class PortfolioResponse(BaseModel):
    """§3.3 ``GET /portfolio`` 200 body (stale-markable — prefer 200+stale over an error)."""

    asOfBlock: int
    asOf: str
    stale: bool
    netWorthUsd: str
    idleUsdc: str  # spare wallet USDC available to deposit ("idle cash" line), $1 par
    positions: list[PositionDetail]
    allocation: Allocation | None = None
    pnl: Pnl | None = None
    risk: RiskSummary | None = None
    dataSources: list[DataSource]


class PositionEventsResponse(BaseModel):
    """§3.3 ``GET /portfolio/positions/{positionId}`` 200 body.

    One enriched position + its ``onchainEvents`` history + a per-position PnL series.
    The event history + series need the on-chain event index (not yet built) → ``[]``.
    """

    asOfBlock: int
    asOf: str
    stale: bool
    position: PositionDetail
    onchainEvents: list[dict[str, str]]
    pnlSeries: list[PnlSeriesPoint]


# ─────────────────────────────────────────────────────────────────────────────
# Formatting + derivation helpers (exact integer math — never a lossy float).
# ─────────────────────────────────────────────────────────────────────────────


def _usd_from_usdc(base_units: int) -> str:
    """Render USDC base units (6 dp) as a USD (2 dp) string at $1 par (exact int math).

    ``100_250_000`` → ``"100.25"``. USDC is the vault's stable underlying, so par ($1)
    valuation is faithful (no oracle) — not a fabricated price.
    """
    cents = base_units // 10_000  # 6dp base units → 2dp cents (truncates sub-cent dust)
    return f"{cents // 100}.{cents % 100:02d}"


def _bps_of(part: int, whole: int) -> int:
    """``part`` as basis points of ``whole`` (0 when ``whole`` is 0). Exact integer math."""
    return (part * 10_000) // whole if whole > 0 else 0


def _now_iso() -> str:
    """A UTC ISO-8601 ``asOf`` timestamp for the response envelope."""
    return datetime.now(UTC).isoformat()


def _parse_include(include: str | None) -> frozenset[str]:
    """Parse the §3.3 ``?include=`` comma list; default (or all-invalid) → every section."""
    if not include:
        return _ALL_SECTIONS
    requested = {section.strip() for section in include.split(",") if section.strip()}
    valid = requested & _ALL_SECTIONS
    return frozenset(valid) if valid else _ALL_SECTIONS


@dataclass(frozen=True)
class _VaultPosition:
    """The live on-chain vault position (fresh reads), or a degraded/empty stand-in."""

    shares: int
    underlying: int  # USDC base units (6 dp) — the VALUE of the held vault shares
    asset_address: str
    block: int
    stale: bool
    idle: int = 0  # spare underlying USDC in the wallet (not in the vault), 6 dp

    @property
    def held(self) -> bool:
        """True iff the user actually holds vault shares (a real position exists)."""
        return self.shares > 0 and not self.stale


async def _read_vault_position(reader: VaultReader, account: AccountContext) -> _VaultPosition:
    """Read the user's vault position, DEGRADING to a stale/empty stand-in on outage (§3.3).

    A :class:`VaultUnavailable` (undeployed vault / unreachable RPC) is caught here and
    turned into ``stale=True`` with zeroed figures — never a hard error and never a
    fabricated balance. The frontend reconciles the true balance via direct RPC (SC-011).
    """
    try:
        shares = await reader.balance_of(account.account)
        underlying = await reader.convert_to_assets(shares) if shares else 0
        asset_address = await reader.asset()
        # Idle cash = the owner's spare underlying-USDC balance (available to deposit).
        idle = await reader.token_balance_of(asset_address, account.account)
        block = await reader.block_number()
    except VaultUnavailable:
        return _VaultPosition(shares=0, underlying=0, asset_address="", block=0, stale=True)
    return _VaultPosition(
        shares=shares,
        underlying=underlying,
        asset_address=asset_address,
        block=block,
        stale=False,
        idle=idle,
    )


def _position_detail(position: _VaultPosition) -> PositionDetail:
    """Map a held vault position to the §3.3 ``PositionDetail`` (cost-basis/PnL still null)."""
    return PositionDetail(
        positionId=_VAULT_POSITION_ID,
        venue="vault",
        asset=position.asset_address,
        shares=str(position.shares),
        underlying=str(position.underlying),
        valueUsd=_usd_from_usdc(position.underlying),
        # convertToAssets is the on-chain source; USDC is valued at $1 par (stable underlying).
        priceSource="onchain",
        # Cost basis + unrealized PnL need the derived index (fee indexer) → null, never faked.
        costBasisUsd=None,
        unrealizedPnlUsd=None,
        riskTier=_VAULT_RISK_TIER,
    )


def _allocation(position: _VaultPosition) -> Allocation:
    """Derive the §3.3 allocation from the live position (single asset ⇒ 100% in one slice)."""
    if not position.held:
        return Allocation(byAsset=[], byStrategy=[], byRiskTier=[])
    value = _usd_from_usdc(position.underlying)
    full = _bps_of(position.underlying, position.underlying)  # 10000 for the sole holding
    return Allocation(
        byAsset=[AllocationSlice(key=position.asset_address, valueUsd=value, bps=full)],
        byStrategy=[AllocationSlice(key=_VAULT_STRATEGY, valueUsd=value, bps=full)],
        byRiskTier=[AllocationSlice(key=_VAULT_RISK_TIER, valueUsd=value, bps=full)],
    )


def _risk(position: _VaultPosition) -> RiskSummary:
    """Derive the §3.3 risk summary — ``concentrationBps`` derivable; score/drift need the model."""
    # A single holding is maximally concentrated (100% = 10000 bps); no holding ⇒ 0.
    concentration = 10_000 if position.held else 0
    return RiskSummary(score=None, concentrationBps=concentration, drift=None)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/portfolio", response_model=PortfolioResponse)
async def get_portfolio(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    include: Annotated[str | None, Query()] = None,
) -> PortfolioResponse:
    """Enriched, derived portfolio — stale-markable (agent-service-api.md §3.3).

    Reads the user's vault position from chain, values USDC at $1 par, and derives
    allocation/concentration from it. Derived history (cost basis, PnL series, risk score)
    needs the fee indexer → surfaced as ``null`` / ``[]``, never fabricated. A chain outage
    DEGRADES to ``200 + stale:true`` (the frontend reconciles custody balances via direct
    RPC) rather than erroring, per §3.3 / SC-011.
    """
    sections = _parse_include(include)
    position = await _read_vault_position(reader, account)

    positions: list[PositionDetail] = []
    if "positions" in sections and position.held:
        positions.append(_position_detail(position))

    # Net worth = vault value + idle wallet USDC (both USDC at $1 par). A degraded read → "0.00".
    vault_value = position.underlying if position.held else 0
    net_worth = "0.00" if position.stale else _usd_from_usdc(vault_value + position.idle)
    idle_usdc = "0.00" if position.stale else _usd_from_usdc(position.idle)
    status = "stale" if position.stale else "ok"

    return PortfolioResponse(
        asOfBlock=position.block,
        asOf=_now_iso(),
        stale=position.stale,
        netWorthUsd=net_worth,
        idleUsdc=idle_usdc,
        positions=positions,
        allocation=_allocation(position) if "allocation" in sections else None,
        pnl=Pnl(series=[], realizedUsd=None, unrealizedUsd=None) if "pnl" in sections else None,
        risk=_risk(position) if "risk" in sections else None,
        dataSources=[
            DataSource(
                source=_DATA_SOURCE,
                status=status,
                lastBlock=position.block if not position.stale else None,
            )
        ],
    )


@router.get("/portfolio/positions/{position_id}", response_model=PositionEventsResponse)
async def get_position(
    position_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
) -> PositionEventsResponse:
    """One enriched position + its on-chain event history + per-position PnL series (§3.3).

    Only the single vault position (id ``"vault"``) exists; any other id — or a request for
    the vault position when the user holds no shares — is ``NOT_FOUND``. A chain outage
    DEGRADES to a ``stale`` position shell (never a hard error). The event history + PnL
    series need the on-chain event index (not yet built) → ``[]``.
    """
    if position_id != _VAULT_POSITION_ID:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            f"No position {position_id!r}.",
            reasons=[ErrorReason("NOT_FOUND", "unknown positionId")],
        )

    position = await _read_vault_position(reader, account)

    # A degraded read cannot confirm the position; return a stale shell so the frontend
    # reconciles via direct RPC (§3.3), rather than a misleading NOT_FOUND.
    if not position.stale and position.shares == 0:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "You hold no vault position.",
            reasons=[ErrorReason("NOT_FOUND", "zero vault shares")],
        )

    detail = (
        _position_detail(position)
        if position.held
        else PositionDetail(
            positionId=_VAULT_POSITION_ID,
            venue="vault",
            asset=position.asset_address,
            shares="0",
            underlying="0",
            valueUsd="0.00",
            priceSource="onchain",
            riskTier=_VAULT_RISK_TIER,
        )
    )
    return PositionEventsResponse(
        asOfBlock=position.block,
        asOf=_now_iso(),
        stale=position.stale,
        position=detail,
        # On-chain event history + per-position PnL need the event index → empty for now.
        onchainEvents=[],
        pnlSeries=[],
    )
