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
from ..config import AgentConfig
from ..db import get_database
from ..db.vault_flows import (
    BasisResult,
    FlowRow,
    OutcomeReplay,
    VaultFlowReader,
    replay_basis,
    replay_outcomes,
)
from .errors import ApiError, ErrorCode, ErrorReason
from .recommendations import _network_id, get_agent_config
from .security import AccountContext
from .vault import get_account, get_vault_reader


def get_vault_flow_reader() -> VaultFlowReader:
    """The indexed vault-flow reader (cost basis for PnL). Overridden in tests."""
    return VaultFlowReader(get_database())


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
    realizedPnlUsd: str | None = None
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


class OnchainEvent(BaseModel):
    """One indexed Deposit/Withdraw for the transaction history (§tx). ``blockNumber``/``txHash``
    are EXACT + verifiable on-chain; ``tsApprox`` is an APPROXIMATE age derived from block height
    (Base ~2s blocks) — the frontend labels it an estimate (``onchain_events`` carries no time)."""

    kind: str  # 'deposit' | 'withdraw'
    amountUsd: str  # USDC value moved (2 dp, $1 par)
    shares: str  # vault shares moved (6-dp base units)
    blockNumber: int
    txHash: str
    tsApprox: str


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
    # §B3 — the wallet's NATIVE coin balance on the request chain (wei, string for uint precision).
    # Read independently of the vault so it surfaces even where the vault isn't deployed (e.g.
    # Robinhood 46630). NOT USD-valued (no oracle wired) → never folded into netWorthUsd. null on a
    # native-read outage (honest, never fabricated).
    nativeBalanceWei: str | None = None
    nativeSymbol: str = "ETH"
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
    onchainEvents: list[OnchainEvent]
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


def _usd_signed(base_units: int) -> str:
    """Signed USD (2 dp) from USDC base units — PnL/cost-basis can be negative (net withdrawn)."""
    sign = "-" if base_units < 0 else ""
    return f"{sign}{_usd_from_usdc(abs(base_units))}"


def _bps_of(part: int, whole: int) -> int:
    """``part`` as basis points of ``whole`` (0 when ``whole`` is 0). Exact integer math."""
    return (part * 10_000) // whole if whole > 0 else 0


def _now_iso() -> str:
    """A UTC ISO-8601 ``asOf`` timestamp for the response envelope."""
    return datetime.now(UTC).isoformat()


_BASE_BLOCK_SECONDS = 2  # Base (mainnet + Sepolia) ~2s blocks — APPROX event age from height only
# The value series reconstructs cumulative shares from zero, so it must fetch the WHOLE flow
# history. One vault position per user ⇒ this bound is effectively "all" (a guard, not a real cap).
_SERIES_MAX_FLOWS = 10_000


def _approx_ts_iso(head_block: int, block: int) -> str:
    """An APPROXIMATE ISO timestamp for an indexed event, from block height vs the current head
    (``onchain_events`` stores no time). Base's ~2s blocks make this a close estimate; the frontend
    labels it as approximate. Never used for money — only to date a transaction row."""
    delta_s = max(0, head_block - block) * _BASE_BLOCK_SECONDS
    return datetime.fromtimestamp(datetime.now(UTC).timestamp() - delta_s, UTC).isoformat()


def _to_event(flow: FlowRow, head_block: int) -> OnchainEvent:
    """Map an indexed :class:`FlowRow` to the §tx wire event."""
    return OnchainEvent(
        kind=flow.kind,
        amountUsd=_usd_from_usdc(flow.assets),
        shares=str(flow.shares),
        blockNumber=flow.block_number,
        txHash=flow.tx_hash,
        tsApprox=_approx_ts_iso(head_block, flow.block_number),
    )


def _value_series(flows: list[FlowRow], position: _VaultPosition) -> list[PnlSeriesPoint]:
    """The vault position VALUE over time (§history) — REAL, from the indexed flows' implied pps
    (assets/shares) + the live value. Denser but never fabricated: at each flow we emit TWO real
    marks — (1) the shares held BEFORE the flow, valued at THIS block's implied pps (mark-to-market
    of the standing position), then (2) the post-flow value at the same pps. The pair makes a
    deposit/withdraw render as a STEP (honest) rather than a diagonal that reads as gradual growth,
    and (1) captures any yield drift since the previous flow. No sampler/interpolation/oracle;
    timestamps are APPROX from block height.
    """
    if not flows:
        return []
    # Ascending on-chain order — (block, log_index) so same-block flows replay in execution order
    # (a withdraw never runs before the same-block deposit that funded it).
    ordered = sorted(flows, key=lambda f: (f.block_number, f.log_index))
    cumulative = 0
    points: list[PnlSeriesPoint] = []
    for f in ordered:
        ts = _approx_ts_iso(position.block, f.block_number)
        # (1) PRE-event re-mark of the standing position at this block's pps (skip the first flow —
        #     nothing is held yet). Real: held shares × on-chain-implied assets/share.
        if cumulative > 0 and f.shares > 0:
            pre = cumulative * f.assets // f.shares
            points.append(PnlSeriesPoint(ts=ts, valueUsd=_usd_from_usdc(max(0, pre))))
        # (2) apply the flow, then the POST-event value at the same implied pps.
        cumulative += f.shares if f.kind == "deposit" else -f.shares
        value = cumulative * f.assets // f.shares if f.shares > 0 and cumulative > 0 else 0
        points.append(PnlSeriesPoint(ts=ts, valueUsd=_usd_from_usdc(max(0, value))))
    # The live on-chain value now (convertToAssets of the current shares).
    points.append(PnlSeriesPoint(ts=_now_iso(), valueUsd=_usd_from_usdc(position.underlying)))
    return points


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


def _pnl_usd(
    position: _VaultPosition, basis: BasisResult | None
) -> tuple[str | None, str | None, str | None]:
    """(costBasisUsd, unrealizedPnlUsd, realizedUsd) from the COMPLETE indexed flows, else all None
    (honest — never fabricated, and never a partial-history guess). costBasis = average cost of the
    shares HELD NOW; unrealized = current value − that basis; realized = Σ realized gains on past
    withdrawals. realized + unrealized == the position's lifetime PnL. Surfaced ONLY when the
    reconstructed share count reconciles to the on-chain balance (a complete, untransferred set).
    """
    if basis is None or not basis.reconciles:
        return None, None, None
    cost = basis.remaining_cost_basis
    return _usd_signed(cost), _usd_signed(position.underlying - cost), _usd_signed(basis.realized)


def _position_detail(position: _VaultPosition, basis: BasisResult | None = None) -> PositionDetail:
    """Map a held vault position to the §3.3 ``PositionDetail``, with cost-basis/realized/unrealized
    PnL from the indexed on-chain flows when the history reconciles (else null — never faked)."""
    cost_basis_usd, unrealized_pnl_usd, realized_pnl_usd = _pnl_usd(position, basis)
    return PositionDetail(
        positionId=_VAULT_POSITION_ID,
        venue="vault",
        asset=position.asset_address,
        shares=str(position.shares),
        underlying=str(position.underlying),
        valueUsd=_usd_from_usdc(position.underlying),
        # convertToAssets is the on-chain source; USDC is valued at $1 par (stable underlying).
        priceSource="onchain",
        costBasisUsd=cost_basis_usd,
        unrealizedPnlUsd=unrealized_pnl_usd,
        realizedPnlUsd=realized_pnl_usd,
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
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    include: Annotated[str | None, Query()] = None,
) -> PortfolioResponse:
    """Enriched, derived portfolio — stale-markable (agent-service-api.md §3.3).

    Reads the user's vault position from chain, values USDC at $1 par, and derives
    allocation/concentration from it. Cost basis + unrealized PnL come from the INDEXED on-chain
    Deposit/Withdraw flows (B2) when available, else null (never fabricated). A chain outage
    DEGRADES to ``200 + stale:true`` (the frontend reconciles custody balances via direct RPC).
    """
    sections = _parse_include(include)
    position = await _read_vault_position(reader, account)

    # §B3 native coin balance — read via the request-chain RPC, INDEPENDENT of the vault so it
    # surfaces even where the vault isn't deployed (e.g. Robinhood 46630, vault is Base-only).
    # Fail-open → null (honest, never fabricated). Not USD-valued (no oracle) → never in netWorth.
    native_wei: str | None = None
    try:
        native_wei = str(await reader.native_balance(account.account))
    except Exception:
        # Best-effort wallet display — a native-balance outage must NEVER break the portfolio
        # (non-custody). Fail-open to null, exactly like the cost-basis read below.
        native_wei = None

    # Full indexed flow history (one vault position per user ⇒ effectively "all"), fetched ONCE and
    # reused for BOTH the average-cost PnL and the value series. Fail-open ([] → honest null / []).
    # NB: the replay reconstructs cumulative shares/cost FROM ZERO, so it needs the COMPLETE history
    # (a truncated fetch dropping the oldest deposits would silently understate everything) — hence
    # the high bound (effectively all flows for any real user; one vault position per user).
    basis: BasisResult | None = None
    value_series: list[PnlSeriesPoint] = []
    if not position.stale and position.held and config.vault_address:
        try:
            hist = await flows.list_flows(
                _network_id(account.chain_id),
                config.vault_address,
                account.account,
                limit=_SERIES_MAX_FLOWS,
            )
        except Exception:
            hist = []
        basis = replay_basis(hist, position.shares)
        if "pnl" in sections:
            value_series = _value_series(hist, position)

    positions: list[PositionDetail] = []
    if "positions" in sections and position.held:
        positions.append(_position_detail(position, basis))

    # Net worth = vault value + idle wallet USDC (both USDC at $1 par). A degraded read → "0.00".
    vault_value = position.underlying if position.held else 0
    net_worth = "0.00" if position.stale else _usd_from_usdc(vault_value + position.idle)
    idle_usdc = "0.00" if position.stale else _usd_from_usdc(position.idle)
    status = "stale" if position.stale else "ok"
    _cost, unrealized, realized = _pnl_usd(position, basis) if position.held else (None, None, None)

    return PortfolioResponse(
        asOfBlock=position.block,
        asOf=_now_iso(),
        stale=position.stale,
        netWorthUsd=net_worth,
        idleUsdc=idle_usdc,
        nativeBalanceWei=native_wei,
        positions=positions,
        allocation=_allocation(position) if "allocation" in sections else None,
        pnl=(
            Pnl(series=value_series, realizedUsd=realized, unrealizedUsd=unrealized)
            if "pnl" in sections
            else None
        ),
        risk=_risk(position) if "risk" in sections else None,
        dataSources=[
            DataSource(
                source=_DATA_SOURCE,
                status=status,
                lastBlock=position.block if not position.stale else None,
            )
        ],
    )


class OutcomeRow(BaseModel):
    """§018/US5 — one realized WITHDRAWAL in the outcomes ledger. Every figure is real (from the
    indexed flows' exact average-cost replay); ``txHash`` is the withdrawal's own on-chain proof.
    Position-level: NOT linked to the specific advice that caused it."""

    realizedUsd: str  # signed USD (2dp) realized on this withdrawal
    kind: str  # 'gain' | 'loss' | 'flat' (by the sign of the exact realized integer)
    amountUsd: str  # USDC assets received in this withdrawal ($1 par)
    txHash: str  # the withdrawal transaction — verifiable on-chain proof
    blockNumber: int
    tsApprox: str  # APPROX age from block height (onchain_events carries no time)


class OutcomesResponse(BaseModel):
    """§018/US5 ``GET /outcomes`` 200 body — the realized-outcomes ledger.

    ``outcomes`` is populated ONLY when ``reconciles`` (the reconstructed share history is complete
    and untransferred); otherwise it is ``[]`` with ``reconciles = false`` — an honest empty state,
    never a partial-history guess. Wins and losses are shown equally (no survivorship). Advisory
    read: a chain/index outage degrades to ``stale`` + empty, never a hard error."""

    asOfBlock: int
    asOf: str
    stale: bool
    reconciles: bool
    netRealizedUsd: str | None  # Σ realized (null when not reconciled)
    wins: int
    losses: int
    outcomes: list[OutcomeRow]


@router.get("/outcomes", response_model=OutcomesResponse)
async def get_outcomes(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
) -> OutcomesResponse:
    """The realized-outcomes ledger — one real row per withdrawal (§018/US5, agent-service-api §3.3
    family). Reprojects the SAME indexed Deposit/Withdraw flows the portfolio uses (feature 017),
    replaying average cost to realize ``assets − avg-cost of shares redeemed`` per withdrawal, each
    stamped with its own tx as proof. Rows are returned ONLY when the reconstructed shares reconcile
    to the on-chain balance (complete, untransferred history) — else an honest empty ledger. Losses
    are shown as plainly as gains. Pure read/derive: no key, no fund move, no chain write (N1–N5).
    A chain/index outage DEGRADES to ``stale`` + empty (never a hard error, never a fabricated row).
    """
    position = await _read_vault_position(reader, account)

    # Fetch the COMPLETE flow history whenever the vault read is live — INDEPENDENT of whether the
    # user still holds shares (a fully-exited user still has realized outcomes to show). Fail-open
    # ([] → honest empty). The replay reconstructs from zero, so it needs all flows (high bound).
    replay: OutcomeReplay | None = None
    if not position.stale and config.vault_address:
        try:
            hist = await flows.list_flows(
                _network_id(account.chain_id),
                config.vault_address,
                account.account,
                limit=_SERIES_MAX_FLOWS,
            )
        except Exception:
            hist = []
        replay = replay_outcomes(hist, position.shares)

    reconciles = bool(replay and replay.reconciles)
    rows: list[OutcomeRow] = []
    wins = 0
    losses = 0
    net_realized: str | None = None
    if reconciles and replay is not None:
        total = 0
        # Newest-first for display (the ledger reads most-recent-outcome-first).
        for o in sorted(replay.outcomes, key=lambda x: (x.block_number, x.log_index), reverse=True):
            kind = "gain" if o.realized > 0 else "loss" if o.realized < 0 else "flat"
            if o.realized > 0:
                wins += 1
            elif o.realized < 0:
                losses += 1
            rows.append(
                OutcomeRow(
                    realizedUsd=_usd_signed(o.realized),
                    kind=kind,
                    amountUsd=_usd_from_usdc(o.assets_received),
                    txHash=o.tx_hash,
                    blockNumber=o.block_number,
                    tsApprox=_approx_ts_iso(position.block, o.block_number),
                )
            )
            total += o.realized
        net_realized = _usd_signed(total)

    return OutcomesResponse(
        asOfBlock=position.block,
        asOf=_now_iso(),
        stale=position.stale,
        reconciles=reconciles,
        netRealizedUsd=net_realized,
        wins=wins,
        losses=losses,
        outcomes=rows,
    )


@router.get("/portfolio/positions/{position_id}", response_model=PositionEventsResponse)
async def get_position(
    position_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
) -> PositionEventsResponse:
    """One enriched position + its on-chain event history + per-position PnL series (§3.3).

    Only the single vault position (id ``"vault"``) exists; any other id — or a request for
    the vault position when the user holds no shares — is ``NOT_FOUND``. A chain outage
    DEGRADES to a ``stale`` position shell (never a hard error). Cost basis + unrealized PnL
    come from the INDEXED on-chain flows (B2) when available; the raw event/PnL time-series
    still needs a per-block sampler → ``[]``.
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

    # Full indexed flow history (fetched ONCE) → the average-cost basis (needs the COMPLETE history)
    # + the newest rows for the tx list. Fail-open (missing → null PnL / [] history, honest).
    _TX_DISPLAY_LIMIT = 50  # preserve the current tx-list cap (newest-first)
    basis: BasisResult | None = None
    events: list[OnchainEvent] = []
    if not position.stale and position.held and config.vault_address:
        network_id = _network_id(account.chain_id)
        try:
            rows = await flows.list_flows(
                network_id, config.vault_address, account.account, limit=_SERIES_MAX_FLOWS
            )
        except Exception:
            rows = []
        basis = replay_basis(rows, position.shares)
        events = [_to_event(f, position.block) for f in rows[:_TX_DISPLAY_LIMIT]]

    detail = (
        _position_detail(position, basis)
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
        # Real transaction history from the §B2 indexed Deposit/Withdraw flows. The per-position PnL
        # time-series still needs the pps sampler → empty for now.
        onchainEvents=events,
        pnlSeries=[],
    )
