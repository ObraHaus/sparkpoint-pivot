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
- Cost basis, realized + unrealized PnL and the value series are **REAL** (018/020): an
  average-cost replay over the indexed vault flows (``db.vault_flows.replay_basis``).
  They are surfaced ONLY when the share history ``reconciles`` — an incomplete or
  disagreeing history yields ``null`` rather than a partial-history guess, so a number
  here is always reconstructable from chain.
- ``concentrationBps`` is derivable from the live allocation and is populated; a risk
  ``score`` / ``drift`` need the risk model (not yet wired) → ``null``.
- Still honestly absent: the per-position ``onchainEvents`` history and per-position
  series (they need the per-position event index) → ``[]``.

(023 note: this section previously said cost basis and PnL were ``null`` "until the fee
indexer lands". That stopped being true when 018/020 shipped; the docstrings that carry
this service's invariants have to match what it does, or an auditor is reading fiction.)
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..chain import VaultReader, VaultUnavailable
from ..config import AgentConfig
from ..db import RecommendationStore, get_database
from ..db.vault_flows import (
    BasisResult,
    FlowRow,
    Lot,
    LotReplay,
    OutcomeReplay,
    VaultFlowReader,
    replay_basis,
    replay_lots,
    replay_outcomes,
)
from ..db.wrapper_whitelist import DEPLOYED, PgWhitelistStore
from .errors import ApiError, ErrorCode, ErrorReason
from .recommendations import _network_id, get_agent_config
from .security import AccountContext
from .vault import get_account, get_vault_reader, require_verified_chain


def get_rec_store() -> RecommendationStore:
    """The recommendations store (US5 — per-advice attribution). Overridden in tests."""
    return RecommendationStore(get_database())


def get_vault_flow_reader() -> VaultFlowReader:
    """The indexed vault-flow reader (cost basis for PnL). Overridden in tests."""
    return VaultFlowReader(get_database())


def get_wrapper_store() -> PgWhitelistStore | None:
    """053 — the wrapper admission mirror (the curated-wrapper registry).

    Returns ``None`` when the DB is unavailable (no DATABASE_URL / construction failure): the
    portfolio then simply has no wrapper positions — an optional read surface must never break
    the endpoint. Overridden with a fake in tests."""
    try:
        return PgWhitelistStore(get_database())
    except Exception:
        return None


router = APIRouter(tags=["portfolio"], dependencies=[Depends(require_verified_chain)])

# The single vault position is addressed by this stable id (one ERC-4626 position per
# user). ``GET /portfolio/positions/vault`` resolves it; any other id is NOT_FOUND.
_VAULT_POSITION_ID = "vault"

# The vault is SparkPoint's conservative Aave-USDC yield strategy — a known static tier,
# not a derived/fabricated figure.
_VAULT_RISK_TIER = "conservative"
_VAULT_STRATEGY = "vault"
# 053 — the wallet's idle stable + the curated-wrapper positions on a chain without the launch
# vault. The keys are wire labels the app/chat render, not policy identifiers.
_CASH_STRATEGY = "cash"
_CASH_RISK_TIER = "cash"
_WRAPPER_STRATEGY = "wrapper"
_WRAPPER_RISK_TIER = "external"

# §3.3 ``?include=`` sections.
_ALL_SECTIONS: frozenset[str] = frozenset({"positions", "pnl", "allocation", "risk"})

# The derived-index data source that backs the enriched figures. Its status flips to
# ``stale`` when the on-chain read degrades (custody balances still reconcile via the
# frontend's direct RPC, §3.3).
_DATA_SOURCE = "vault_rpc"
# 053 — provenance for the curated-wrapper leg (admission mirror + direct RPC reads).
_WRAPPER_DATA_SOURCE = "wrapper_rpc"


# ─────────────────────────────────────────────────────────────────────────────
# Response models (camelCase field names = the exact §3.3 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class PositionDetail(BaseModel):
    """§3.3 enriched position. Cost basis + realized/unrealized PnL are real (018/020), computed
    from the indexed flows and surfaced only when the share history reconciles — else ``null``."""

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
    """One point on the value series, reconstructed from the indexed vault flows (018/020)."""

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
    """§3.3 ``pnl`` — realized + unrealized from the average-cost replay, plus the value series.
    ``null`` only when the indexed share history does not reconcile (never a guess)."""

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


# ── 053 — curated-wrapper positions + the wallet's idle stable (chains without the launch vault) ──


@dataclass(frozen=True)
class WrapperPosition:
    """One curated wrapper the wallet provably holds (admission mirror + direct RPC).

    053 — shared by the /portfolio route AND the chat portfolio provider, so the AI and the app
    read the same positions from the same code."""

    position_id: str
    vault_address: str
    label: str
    shares: int
    underlying: int  # wrapper-asset base units (convertToAssets)
    asset_address: str
    asset_decimals: int
    share_decimals: int  # the wrapper's OWN ERC-20 share scale (V3: 9 over a 6-dp asset)
    par: bool  # the wrapper's asset IS the chain stable ⇒ $1-par valuable


async def read_wrapper_positions(
    reader: VaultReader,
    store: PgWhitelistStore | None,
    chain_id: int,
    owner: str,
    stable_address: str | None,
) -> tuple[list[WrapperPosition], bool, int]:
    """The whitelisted wrappers this wallet holds on the request chain, read DIRECTLY over RPC.

    The wrapper fleet is dynamic (049), so the agent's own admission mirror is the registry: every
    DEPLOYED entry with a proxy address is a candidate, and only a non-zero ``balanceOf`` becomes a
    position. A wrapper's value is folded into net worth at $1 par ONLY when its ``asset()`` IS the
    chain stable (``config.stable_token_address``) — an unpriced asset is shown but never invented
    into a USD figure.

    Returns ``(positions, stale, block)``. ``stale`` is True when at least one candidate's read
    failed (the figures may be incomplete — say so rather than under-report silently). A chain with
    no deployed wrappers, or no store, returns ``([], False, block)``.
    """
    if store is None:
        return [], False, 0
    try:
        entries = await store.list_entries(chain_id)
    except Exception:
        return [], False, 0
    deployed = [e for e in entries if e.status == DEPLOYED and e.proxy_address]
    if not deployed:
        return [], False, 0

    try:
        block = await reader.block_number()
    except Exception:
        block = 0

    stable = (stable_address or "").lower()
    out: list[WrapperPosition] = []
    failures = 0
    for entry in deployed:
        proxy = (entry.proxy_address or "").lower()
        try:
            shares = await reader.token_balance_of(proxy, owner)
            if shares <= 0:
                continue
            underlying = await reader.convert_to_assets_at(proxy, shares)
            asset = (await reader.asset_at(proxy)).lower()
            decimals = await reader.decimals_at(asset)
            share_decimals = await reader.decimals_at(proxy)
            out.append(
                WrapperPosition(
                    position_id=f"wrapper:{proxy}",
                    vault_address=proxy,
                    label=entry.label or entry.name or "Curated vault",
                    shares=shares,
                    underlying=underlying,
                    asset_address=asset,
                    asset_decimals=decimals,
                    share_decimals=share_decimals,
                    par=bool(stable) and asset == stable,
                )
            )
        except VaultUnavailable:
            failures += 1
    return out, failures > 0, block


def _wrapper_detail(w: WrapperPosition) -> PositionDetail:
    """Map a held wrapper position to the §3.3 shape. Cost basis/PnL stay null until the wrapper
    flows are indexed (053 Phase C) — never fabricated. ``priceSource`` says whether the value is
    the stable's $1 par or an unpriced asset (never a guessed price)."""
    return PositionDetail(
        positionId=w.position_id,
        venue="wrapper",
        asset=w.asset_address,
        shares=str(w.shares),
        underlying=str(w.underlying),
        valueUsd=_usd_from_usdc(w.underlying) if w.par else "0.00",
        priceSource="onchain" if w.par else "unpriced",
        riskTier=None,
    )


def _combined_allocation(
    position: _VaultPosition,
    wrappers: list[WrapperPosition],
    idle: int,
    stable_address: str,
) -> Allocation:
    """§3.3 allocation across the launch vault, the held wrappers, and idle cash (053).

    With no wrappers this is the launch-vault allocation unchanged (byte-identical for Base).
    An unpriced wrapper contributes a zero-value bucket — it is never valued into a slice."""
    if not wrappers:
        return _allocation(position)
    buckets: list[tuple[str, str, str, int]] = []  # (asset, strategy, tier, value)
    if position.held:
        buckets.append(
            (position.asset_address, _VAULT_STRATEGY, _VAULT_RISK_TIER, position.underlying)
        )
    for w in wrappers:
        buckets.append(
            (w.asset_address, _WRAPPER_STRATEGY, _WRAPPER_RISK_TIER, w.underlying if w.par else 0)
        )
    buckets.append((stable_address, _CASH_STRATEGY, _CASH_RISK_TIER, idle))
    total = sum(value for *_, value in buckets)

    def slices(key_of: Callable[[tuple[str, str, str, int]], str]) -> list[AllocationSlice]:
        merged: dict[str, int] = {}
        for bucket in buckets:
            if bucket[3] <= 0:
                continue
            key = key_of(bucket)
            merged[key] = merged.get(key, 0) + bucket[3]
        return [
            AllocationSlice(key=key, valueUsd=_usd_from_usdc(value), bps=_bps_of(value, total))
            for key, value in merged.items()
        ]

    return Allocation(
        byAsset=slices(lambda b: b[0]),
        byStrategy=slices(lambda b: b[1]),
        byRiskTier=slices(lambda b: b[2]),
    )


def _combined_risk(
    position: _VaultPosition, wrappers: list[WrapperPosition], idle: int
) -> RiskSummary:
    """§3.3 risk across the combined holdings: concentration = the largest single non-cash
    holding's share. With no wrappers this is the launch-vault risk unchanged."""
    if not wrappers:
        return _risk(position)
    total = (position.underlying if position.held else 0) + sum(
        w.underlying for w in wrappers if w.par
    ) + idle
    concentration = max((w.underlying for w in wrappers if w.par), default=0)
    if position.held:
        concentration = max(concentration, position.underlying)
    return RiskSummary(score=None, concentrationBps=_bps_of(concentration, total), drift=None)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/portfolio", response_model=PortfolioResponse)
async def get_portfolio(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    wrapper_store: Annotated[PgWhitelistStore | None, Depends(get_wrapper_store)],
    include: Annotated[str | None, Query()] = None,
) -> PortfolioResponse:
    """Enriched, derived portfolio — stale-markable (agent-service-api.md §3.3).

    Reads the user's vault position from chain, values USDC at $1 par, and derives
    allocation/concentration from it. Cost basis + unrealized PnL come from the INDEXED on-chain
    Deposit/Withdraw flows (B2) when available, else null (never fabricated). A chain outage
    DEGRADES to ``200 + stale:true`` (the frontend reconciles custody balances via direct RPC).

    053 — on a chain WITHOUT the launch vault (the Robinhood Chain beta) the portfolio is the
    wallet's idle stable plus every whitelisted curated wrapper the wallet holds, read directly
    over RPC. That chain is not "stale": it simply has no launch vault, and reporting one would
    hide the user's real funds from the AI.
    """
    sections = _parse_include(include)

    # The launch vault is read only when this chain HAS one configured. Otherwise the position is
    # an honest empty, not a degraded read — the beta's funds live in wrappers + the wallet.
    if config.vault_address:
        position = await _read_vault_position(reader, account)
    else:
        position = _VaultPosition(
            shares=0,
            underlying=0,
            asset_address=config.stable_token_address or "",
            block=0,
            stale=False,
        )

    # 053 — curated-wrapper positions (the admission mirror is the registry) + the idle stable.
    wrapper_positions, wrappers_stale, wrappers_block = await read_wrapper_positions(
        reader, wrapper_store, account.chain_id, account.account, config.stable_token_address
    )
    idle = position.idle
    stable_read_failed = False
    if not config.vault_address and config.stable_token_address:
        try:
            idle = await reader.token_balance_of(config.stable_token_address, account.account)
        except VaultUnavailable:
            stable_read_failed = True
            idle = 0

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
    # 053 — launch-vault only: wrapper flows are indexed separately (Phase C).
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
    if "positions" in sections:
        positions.extend(_wrapper_detail(w) for w in wrapper_positions)

    # Net worth = launch vault + par-valued wrappers + idle stable ($1 par each). A degraded read
    # on any leg → stale, with the figures zeroed rather than partially trusted.
    stale = position.stale or wrappers_stale or stable_read_failed
    wrapper_value = sum(w.underlying for w in wrapper_positions if w.par)
    total_units = (position.underlying if position.held else 0) + wrapper_value + idle
    net_worth = "0.00" if stale else _usd_from_usdc(total_units)
    idle_usdc = "0.00" if stale else _usd_from_usdc(idle)
    status = "stale" if stale else "ok"
    _cost, unrealized, realized = _pnl_usd(position, basis) if position.held else (None, None, None)
    as_of_block = position.block or wrappers_block

    return PortfolioResponse(
        asOfBlock=as_of_block,
        asOf=_now_iso(),
        stale=stale,
        netWorthUsd=net_worth,
        idleUsdc=idle_usdc,
        nativeBalanceWei=native_wei,
        positions=positions,
        allocation=(
            _combined_allocation(
                position, wrapper_positions, idle, config.stable_token_address or ""
            )
            if "allocation" in sections
            else None
        ),
        pnl=(
            Pnl(series=value_series, realizedUsd=realized, unrealizedUsd=unrealized)
            if "pnl" in sections
            else None
        ),
        risk=(
            _combined_risk(position, wrapper_positions, idle) if "risk" in sections else None
        ),
        dataSources=[
            DataSource(
                source=_DATA_SOURCE,
                status=status,
                lastBlock=position.block if not stale else None,
            )
        ]
        + (
            [
                DataSource(
                    source=_WRAPPER_DATA_SOURCE, status=status, lastBlock=wrappers_block or None
                )
            ]
            if wrapper_positions
            else []
        ),
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
    # §020/US5 — one row per ACTED-ON recommendation (the credibility loop), populated only when the
    # history reconciles. Empty when there is no acted-on advice or the history can't be reconciled.
    recommendations: list[RecommendationOutcomeRow] = []


class RecommendationOutcomeRow(BaseModel):
    """§020/US5 — one acted-on recommendation's outcome (the deposit it caused, marked to market).

    Position-lot attributed via the explicit build→sign link (``attributionMethod='intent_log'``);
    every figure is reconstructable from chain. ``shared`` = the position is blended across ≥2
    deposit lots (an honest share of a shared position, never a fabricated split)."""

    recId: str
    title: str
    strategyKind: str
    actedTxHash: str  # the deposit tx — on-chain proof of acting on the advice
    entryBlock: int
    entryUsd: str  # this rec's deposit cost
    realizedUsd: str  # FIFO-realized on this rec's lot (signed)
    unrealizedUsd: str  # current mark of the lot's remaining shares − remaining cost (signed)
    label: str  # open | win | loss | flat
    attributionMethod: str  # 'intent_log' (explicit link)
    shared: bool
    reconstructable: bool


class RecommendationOutcomeResponse(BaseModel):
    """§020/US5 ``GET /outcomes/{recId}`` 200 body — one recommendation's outcome detail."""

    recId: str
    title: str
    rationale: str
    strategyKind: str
    proposedAction: dict[str, Any]
    status: str
    actedTxHash: str
    entryBlock: int
    entryUsd: str
    realizedUsd: str
    unrealizedUsd: str
    realizedApyBps: int | None
    label: str
    attributionMethod: str
    shared: bool
    reconstructable: bool
    asOfBlock: int


def _lot_label(lot: Lot) -> str:
    """open while shares remain; else win/loss/flat by the realized sign (honest, chain-derived)."""
    if lot.shares_remaining > 0:
        return "open"
    return "win" if lot.realized > 0 else "loss" if lot.realized < 0 else "flat"


def _lot_for_tx(lots: tuple[Lot, ...], deposit_tx: str) -> Lot | None:
    want = deposit_tx.lower()
    for lot in lots:
        if lot.deposit_tx.lower() == want:
            return lot
    return None


_SECONDS_PER_YEAR = 365 * 24 * 60 * 60  # 31_536_000 — annualization base for realized APY


def _realized_apy_bps(lot: Lot) -> int | None:
    """Annualized REALIZED return for a CLOSED lot (bps), or None while open/flat (contract §020).

    ``realized / entry_cost`` annualized over the lot's on-chain holding period (entry→exit block at
    Base's ~2s cadence). Computed ONLY for a fully-realized lot (no shares left) with a non-zero
    realized — an open or flat lot has no realized APY to claim (honest null, not an extrapolation).
    Reconstructable from chain: entry_block, exit_block, entry_cost, realized are all on-chain-set.
    """
    if lot.shares_remaining > 0 or lot.realized == 0 or lot.entry_cost <= 0:
        return None
    held_blocks = lot.exit_block - lot.entry_block
    if held_blocks <= 0:
        return None
    held_seconds = held_blocks * _BASE_BLOCK_SECONDS
    apy = (lot.realized / lot.entry_cost) * (_SECONDS_PER_YEAR / held_seconds)
    return round(apy * 10_000)


@router.get("/outcomes", response_model=OutcomesResponse)
async def get_outcomes(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    rec_store: Annotated[RecommendationStore, Depends(get_rec_store)],
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
    hist: list[FlowRow] = []
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

    # §020/US5 — one row per ACTED-ON recommendation (the credibility loop). Per-deposit-lot (FIFO)
    # attribution, keyed by the deposit tx of the rec's linked execution; live-computed, not cached.
    rec_rows: list[RecommendationOutcomeRow] = []
    if reconciles:
        current_value = await reader.convert_to_assets(position.shares) if position.shares else 0
        lot_replay: LotReplay | None = replay_lots(hist, position.shares, current_value)
        if lot_replay is not None and lot_replay.reconciles:
            by_tx = {lot.deposit_tx.lower(): lot for lot in lot_replay.lots}
            try:
                acted = await rec_store.list_acted(account.account)
            except Exception:
                acted = []
            for a in acted:
                lot = by_tx.get(a.deposit_tx.lower())
                if lot is None:
                    continue  # the rec's deposit isn't indexed yet → no outcome to show
                rec_rows.append(
                    RecommendationOutcomeRow(
                        recId=str(a.rec_id),
                        title=a.title,
                        strategyKind=a.strategy_kind,
                        actedTxHash=a.deposit_tx,
                        entryBlock=lot.entry_block,
                        entryUsd=_usd_from_usdc(lot.entry_cost),
                        realizedUsd=_usd_signed(lot.realized),
                        unrealizedUsd=_usd_signed(lot.unrealized),
                        label=_lot_label(lot),
                        attributionMethod="intent_log",
                        shared=lot.shared,
                        reconstructable=True,
                    )
                )

    return OutcomesResponse(
        asOfBlock=position.block,
        asOf=_now_iso(),
        stale=position.stale,
        reconciles=reconciles,
        netRealizedUsd=net_realized,
        wins=wins,
        losses=losses,
        outcomes=rows,
        recommendations=rec_rows,
    )


@router.get("/outcomes/{rec_id}", response_model=RecommendationOutcomeResponse)
async def get_outcome_detail(
    rec_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    rec_store: Annotated[RecommendationStore, Depends(get_rec_store)],
) -> RecommendationOutcomeResponse:
    """§020/US5 ``GET /outcomes/{recId}`` — one recommendation's outcome: its stored snapshot, the
    deposit tx that proves it was acted on, and that deposit's LIVE realized+unrealized PnL (FIFO
    lot-attributed against later withdrawals; ``intent_log`` = the explicit build→sign→exec link).

    ``NOT_FOUND`` for an unknown rec, another wallet's rec, or one never acted on. A degraded chain
    read or an unreconstructable share history DEGRADES to ``DATA_STALE`` (honest) — never a
    fabricated figure. Read/derive only: no key, no fund move/write; exit never gated (N2).
    """
    try:
        rid = UUID(rec_id)
    except ValueError as exc:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "Unknown recommendation.",
            reasons=[ErrorReason("NOT_FOUND", "recId is not a recommendation id")],
        ) from exc

    rec = await rec_store.get(rid)
    if rec is None or rec.wallet.lower() != account.account.lower():
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "Unknown recommendation.",
            reasons=[ErrorReason("NOT_FOUND", "no such recommendation for this wallet")],
        )

    # The explicit link: rec → its linked bundle → the submitted execution's deposit tx. No tx ⇒ the
    # advice was surfaced but never acted on — nothing to mark to market yet.
    deposit_tx = await rec_store.deposit_tx_for(rid)
    if deposit_tx is None:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "This recommendation hasn't been acted on yet.",
            reasons=[ErrorReason("NOT_FOUND", "no linked execution")],
        )

    position = await _read_vault_position(reader, account)
    if position.stale or not config.vault_address:
        raise ApiError(
            ErrorCode.DATA_STALE,
            "On-chain history is temporarily unavailable — try again shortly.",
            reasons=[ErrorReason("DATA_STALE", "vault read degraded")],
        )
    try:
        hist = await flows.list_flows(
            _network_id(account.chain_id),
            config.vault_address,
            account.account,
            limit=_SERIES_MAX_FLOWS,
        )
    except Exception as exc:
        raise ApiError(
            ErrorCode.DATA_STALE,
            "On-chain history is temporarily unavailable — try again shortly.",
            reasons=[ErrorReason("DATA_STALE", "flow index unreachable")],
        ) from exc

    current_value = await reader.convert_to_assets(position.shares) if position.shares else 0
    lot_replay = replay_lots(hist, position.shares, current_value)
    if lot_replay is None or not lot_replay.reconciles:
        raise ApiError(
            ErrorCode.DATA_STALE,
            "Your on-chain share history can't be reconciled yet — figures withheld until it can.",
            reasons=[ErrorReason("DATA_STALE", "share history does not reconcile")],
        )

    lot = _lot_for_tx(lot_replay.lots, deposit_tx)
    if lot is None:
        raise ApiError(
            ErrorCode.DATA_STALE,
            "This recommendation's deposit isn't indexed yet — check back shortly.",
            reasons=[ErrorReason("DATA_STALE", "deposit tx not yet in the flow index")],
        )

    return RecommendationOutcomeResponse(
        recId=str(rec.id),
        title=rec.title,
        rationale=rec.rationale,
        strategyKind=rec.strategy_kind,
        proposedAction=rec.proposed_action,
        status="executed",  # derived from reality — the deposit is on-chain AND indexed
        actedTxHash=deposit_tx,
        entryBlock=lot.entry_block,
        entryUsd=_usd_from_usdc(lot.entry_cost),
        realizedUsd=_usd_signed(lot.realized),
        unrealizedUsd=_usd_signed(lot.unrealized),
        realizedApyBps=_realized_apy_bps(lot),
        label=_lot_label(lot),
        attributionMethod="intent_log",
        shared=lot.shared,
        reconstructable=True,
        asOfBlock=position.block,
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
