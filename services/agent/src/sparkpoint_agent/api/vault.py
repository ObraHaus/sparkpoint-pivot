"""The §3.7 vault deposit/withdraw quote endpoints (READ / PREVIEW only).

agent-service-api.md §3.7 — two convenience helpers that mirror the on-chain
ERC-4626 vault. They NEVER move funds and hold no key: every number is either read
straight from chain via :class:`~sparkpoint_agent.chain.VaultReader` (so the vault's
EIP-4626 rounding — round-DOWN in the vault's favor for deposit/redeem — is mirrored
exactly, never re-derived in Python) or taken from the LLM-free policy constants.

Non-custody invariants enforced here
------------------------------------
- **Withdraw is NEVER cap-, pause-, or fee-gated (N2, §3.7).** ``/vault/quote/withdraw``
  does not call ``paused()`` and does not consult any cap, so no ``KILL_SWITCH_PAUSED``
  / ``CAP_EXCEEDED`` path structurally exists on it. It returns
  ``performanceFee.doesNotGateWithdraw = true`` and the ERC-4626 ``previewRedeem`` value
  (already net of fee-share dilution). The convenience quote's absence never blocks the
  on-chain escape hatch.
- **Deposit** MAY surface ``KILL_SWITCH_PAUSED`` (deposit is pausable) so the UI disables
  deposit while keeping withdraw open, and prefers ``200 + caps.wouldBreach:true`` over a
  ``CAP_EXCEEDED`` error when over cap (FR-025/SC-009) so the UI blocks pre-sign.
- **LLM-free.** This module imports no llm/ / knowledge/ code; the quote path is a
  deterministic read + arithmetic over on-chain values and mirrored policy constants.
- **Fail-closed.** A vault that is not deployed / an unreachable RPC surfaces as the
  canonical §1.5 envelope (``SIMULATION_UNAVAILABLE`` / ``UPSTREAM_UNAVAILABLE``) via the
  :class:`~sparkpoint_agent.chain.VaultUnavailable` handler — never a fabricated quote.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import StrEnum
from typing import Annotated

import eth_abi
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator

from ..chain import VaultReader, VaultUnavailable, VaultUnavailableReason
from ..config import AgentConfig
from ..policy import CAPS, GOVERNANCE
from ..policy.enums import ActionType, ReasonCode
from ..sim import SimulationRequest, SimulationResult, SimulatorUnavailableError, ViemEthCallChecker
from .errors import ApiError, ErrorCode, ErrorReason, new_request_id, render_api_error
from .security import AccountContext

router = APIRouter(tags=["vault"])

# The 1e18 scale of the on-chain HWM / share price (assets-per-share). SparkPointVault
# stores ``_highWaterMark`` as ``convertToAssets(1e18)`` — a 1e18-scaled ratio seeded to
# 1e18 at par (contract §6/§6.1, FR-050). This is the contract's own documented scale,
# so formatting a HWM as a decimal is a faithful render of the on-chain value, not a
# re-derivation of vault math.
_WAD = 10**18

# The largest value a uint256 request amount may take (fail-closed on overflow).
_UINT256_MAX = 2**256 - 1

# §3.7 disclosure strings — rendered VERBATIM (do not paraphrase). The deposit form
# carries the fuller custody statement; the withdraw form is the short profit-only line.
_DEPOSIT_DISCLOSURE = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal. We only earn when you earn — never on your principal, never by "
    "taking custody."
)
_WITHDRAW_DISCLOSURE = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal."
)
_WITHDRAW_NOTE = (
    "Withdrawals are never blocked by caps, the kill-switch, or fee accrual (N2). The "
    "performance fee is profit-only (0% on your principal) and is taken as share "
    "dilution, never by holding back your assets. You can also exit directly on-chain."
)
_EXIT_HATCH_URL = "/exit"

# The profit-only fee is charged only on realized yield above the high-water mark.
_FEE_BASE = "realized_yield_above_hwm"

# §018/US2 — the REAL mutating ERC-4626 calldata selectors for the pre-sign dry-run. These are
# the 4-byte function selectors of the vault's state-changing entrypoints (verified against the
# compiled artifact's methodIdentifiers + policy/constants.py; a parity test pins them). We encode
# this calldata ONLY to eth_call-dry-run it — never to sign or submit (N1/N3).
_DEPOSIT_SELECTOR = "0x6e553f65"  # deposit(uint256 assets, address receiver)
_REDEEM_SELECTOR = "0xba087652"  # redeem(uint256 shares, address receiver, address owner)


# ─────────────────────────────────────────────────────────────────────────────
# Request / response models (camelCase field names = the exact §3.7 wire shape)
# ─────────────────────────────────────────────────────────────────────────────


class QuoteBy(StrEnum):
    """Whether ``amount`` is denominated in underlying assets or in vault shares (§3.7)."""

    ASSETS = "assets"
    SHARES = "shares"


class VaultQuoteRequest(BaseModel):
    """``{ "by": "assets"|"shares", "amount": "<uint256 base units>" }`` (§3.7).

    ``amount`` is a raw base-unit uint256 as a decimal STRING (JSON numbers cannot
    carry uint256 precision). A non-integer / negative / oversized value is a
    VALIDATION_ERROR (§1.6) rather than a silently coerced quote.
    """

    by: QuoteBy
    amount: str

    @field_validator("amount")
    @classmethod
    def _validate_amount(cls, value: str) -> str:
        if not value.isdigit():  # rejects "", signs, decimals, whitespace
            raise ValueError("amount must be a non-negative base-10 integer string")
        if int(value) > _UINT256_MAX:
            raise ValueError("amount exceeds uint256")
        return value

    @property
    def amount_int(self) -> int:
        """The validated ``amount`` as an ``int`` (exact base units)."""
        return int(self.amount)


class PerformanceFeeDeposit(BaseModel):
    """§3.7 deposit ``performanceFee`` — profit-only; 0% on principal/mgmt/entry/exit."""

    rateBps: int
    maxRateBps: int
    base: str
    managementBps: int
    entryBps: int
    exitBps: int
    principalBps: int
    highWaterMark: str
    active: bool
    disclosure: str
    provableOnchain: bool


class CapsMeter(BaseModel):
    """§3.7 deposit ``caps`` — remaining headroom + the on-chain ERC-4626 max + breach flag."""

    perUserRemaining: str
    totalRemaining: str
    vaultRemaining: str
    maxDeposit: str
    wouldBreach: bool


class DepositQuoteResponse(BaseModel):
    """§3.7 ``POST /vault/quote/deposit`` 200 body."""

    by: str
    assets: str
    shares: str
    grossApyBps: int | None
    netApyBps: int | None
    performanceFee: PerformanceFeeDeposit
    caps: CapsMeter
    asOfBlock: int
    stale: bool


class PerformanceFeeWithdraw(BaseModel):
    """§3.7 withdraw ``performanceFee`` — carries the non-custody ``doesNotGateWithdraw``."""

    rateBps: int
    maxRateBps: int
    base: str
    highWaterMark: str
    estFeeOnYieldUsd: str | None
    netYieldUsd: str | None
    disclosure: str
    doesNotGateWithdraw: bool


class WithdrawQuoteResponse(BaseModel):
    """§3.7 ``POST /vault/quote/withdraw`` 200 body. NEVER cap-, pause-, or fee-gated."""

    by: str
    shares: str
    assets: str
    principalUsd: str | None
    accruedYieldUsd: str | None
    performanceFee: PerformanceFeeWithdraw
    maxWithdraw: str
    maxRedeem: str
    note: str
    exitHatchUrl: str
    asOfBlock: int
    stale: bool


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────


def get_account(request: Request) -> AccountContext:
    """The user-scoping identity the middleware asserted (§1.2). NOT fund authority —
    used only to scope the per-user reads (``maxDeposit``/``balanceOf``/``max*``)."""
    account = getattr(request.state, "account", None)
    if not isinstance(account, AccountContext):  # pragma: no cover — middleware guarantees it
        raise ApiError(ErrorCode.ACCOUNT_HEADERS_INVALID, "Missing user-scoping account context.")
    return account


def get_vault_reader(request: Request) -> VaultReader:
    """Build the fail-closed chain-read client, SCOPED to the request's chain (T030 · §B3).

    The reader targets the chain the caller asserted via ``X-Chain-Id``: the RPC is resolved for
    that chain, and the vault address is carried ONLY on the agent's configured vault chain. So a
    request on any OTHER supported chain (e.g. Robinhood 46630, where the vault is Base-only) reads
    the correct RPC yet fails closed with NOT_DEPLOYED on vault views — never a cross-chain vault
    read. Construction raises :class:`VaultUnavailable` (RPC_UNREACHABLE) when no RPC is configured;
    each vault read raises NOT_DEPLOYED when the vault address is unset — both mapped to the §1.5
    envelope by :func:`vault_unavailable_handler`. Overridden in tests with a mocked reader.
    """
    config = AgentConfig.from_env()
    account = getattr(request.state, "account", None)
    if isinstance(account, AccountContext):
        config = config.for_chain(account.chain_id)
    return VaultReader.from_config(config)


# ─────────────────────────────────────────────────────────────────────────────
# Formatting helpers (exact, integer-only — never a lossy float)
# ─────────────────────────────────────────────────────────────────────────────


def _format_wad_ratio(value: int) -> str:
    """Render a 1e18-scaled ratio (the on-chain HWM / share price) as an exact decimal.

    Integer-only (no float) so the rendered string never misstates the on-chain value;
    trailing fractional zeros are trimmed (``1_042_300_000_000_000_000`` → ``"1.0423"``).
    """
    whole, frac = divmod(value, _WAD)
    frac_str = f"{frac:018d}".rstrip("0")
    return f"{whole}.{frac_str}" if frac_str else str(whole)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/vault/quote/deposit", response_model=DepositQuoteResponse)
async def quote_deposit(
    body: VaultQuoteRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
) -> DepositQuoteResponse:
    """Deposit/mint preview + caps meter (agent-service-api.md §3.7).

    Shares/assets are the ERC-4626 ``previewDeposit``/``previewMint`` values read straight
    from chain (round in the vault's favor — DOWN for previewDeposit, UP for previewMint).
    ``grossApyBps`` is the pure Aave supply APY; with no live Aave feed wired it is exposed
    as ``null`` and the quote is flagged ``stale`` (never fabricated). ``netApyBps`` is the
    net-of-fee projection on the yield leg (``null`` when gross is unavailable).

    Kill-switch: a paused vault surfaces ``KILL_SWITCH_PAUSED`` so the UI disables deposit
    (§3.7). Over cap prefers ``200 + caps.wouldBreach:true`` (FR-025) over ``CAP_EXCEEDED``.
    """
    # Deposit is pausable: surface the kill-switch first so the UI can disable deposit
    # (withdraw stays open — see quote_withdraw). paused() is a view read → NOT_DEPLOYED
    # fails closed here if the vault is undeployed.
    if await reader.paused():
        raise ApiError(
            ErrorCode.KILL_SWITCH_PAUSED,
            "Deposits are paused by the vault kill-switch; withdrawals remain open (N2).",
            reasons=[ErrorReason("KILL_SWITCH_PAUSED", "vault paused() == true")],
        )

    block = await reader.block_number()
    rate_bps = await reader.performance_fee_bps()
    hwm = await reader.high_water_mark()
    total_assets = await reader.total_assets()

    # Per-user headroom from the user's CURRENT on-chain position (shares → assets).
    user_shares = await reader.balance_of(account.account)
    user_assets = await reader.convert_to_assets(user_shares) if user_shares else 0
    max_deposit_chain = await reader.max_deposit(account.account)

    # ERC-4626 preview — read from chain, never re-derived (rounding mirrors the vault).
    if body.by is QuoteBy.ASSETS:
        assets = body.amount_int
        shares = await reader.preview_deposit(assets)  # rounds DOWN (vault's favor)
    else:  # by == shares — assets needed to mint the requested shares (rounds UP)
        shares = body.amount_int
        assets = await reader.preview_mint(shares)

    # Caps meter (policy constants — the LLM-free source of truth).
    per_user_remaining = max(0, CAPS.per_user_tvl.amount - user_assets)
    total_remaining = max(0, CAPS.total_protocol.amount - total_assets)
    vault_remaining = max(0, CAPS.vault_deposit.amount - total_assets)
    # Effective headroom is the tightest of the on-chain ERC-4626 max and the policy caps.
    effective_max = min(max_deposit_chain, per_user_remaining, total_remaining, vault_remaining)
    would_breach = assets > effective_max

    # Aave supply APY is not wired to a live feed here — expose null + stale, never fabricate.
    gross_apy_bps: int | None = None
    net_apy_bps: int | None = (
        None if gross_apy_bps is None else gross_apy_bps * (10_000 - rate_bps) // 10_000
    )

    return DepositQuoteResponse(
        by=body.by.value,
        assets=str(assets),
        shares=str(shares),
        grossApyBps=gross_apy_bps,
        netApyBps=net_apy_bps,
        performanceFee=PerformanceFeeDeposit(
            rateBps=rate_bps,
            maxRateBps=GOVERNANCE.performance_fee.ceiling_bps,
            base=_FEE_BASE,
            managementBps=0,
            entryBps=0,
            exitBps=0,
            principalBps=0,
            highWaterMark=_format_wad_ratio(hwm),
            active=rate_bps > 0,
            disclosure=_DEPOSIT_DISCLOSURE,
            provableOnchain=True,
        ),
        caps=CapsMeter(
            perUserRemaining=str(per_user_remaining),
            totalRemaining=str(total_remaining),
            vaultRemaining=str(vault_remaining),
            maxDeposit=str(max_deposit_chain),
            wouldBreach=would_breach,
        ),
        asOfBlock=block,
        # stale reflects the APY projection leg: the ERC-4626 preview + caps are live at
        # asOfBlock, but the APY is best-effort/unavailable until an Aave feed is wired.
        stale=gross_apy_bps is None,
    )


@router.post("/vault/quote/withdraw", response_model=WithdrawQuoteResponse)
async def quote_withdraw(
    body: VaultQuoteRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
) -> WithdrawQuoteResponse:
    """Withdraw/redeem preview — NEVER cap-, pause-, or fee-gated (agent-service-api.md §3.7, N2).

    ``assets`` is the ERC-4626 ``previewRedeem`` value (rounds DOWN, in the vault's favor),
    ALREADY net of fee-share dilution — no fee is ever withheld from the transfer. This
    handler deliberately does NOT read ``paused()`` and consults NO cap, so no
    ``KILL_SWITCH_PAUSED`` / ``CAP_EXCEEDED`` path exists on it; it always returns
    ``performanceFee.doesNotGateWithdraw = true``.

    The per-position ``principalUsd``/``accruedYieldUsd``/``netYieldUsd`` and (above-HWM)
    ``estFeeOnYieldUsd`` require the derived cost-basis index (owned by the fee indexer,
    not yet built) — exposed as ``null`` (best-effort), never fabricated. When share price
    is at/below the HWM the fee is provably ``0`` (profit-only), so ``estFeeOnYieldUsd`` is
    ``"0.00"`` from chain reads alone.
    """
    # A view-read is issued FIRST (not eth_blockNumber) so an undeployed vault fails closed
    # with NOT_DEPLOYED before any RPC call — never a fabricated quote. Note: NOT paused().
    rate_bps = await reader.performance_fee_bps()
    hwm = await reader.high_water_mark()
    # Current share price (assets per 1e18 shares == the 1e18-scaled pps), read from chain.
    pps = await reader.convert_to_assets(_WAD)

    # ERC-4626 preview — read from chain, never re-derived (rounding mirrors the vault).
    if body.by is QuoteBy.SHARES:
        shares = body.amount_int
        assets = await reader.preview_redeem(shares)  # rounds DOWN; net of fee-share dilution
    else:  # by == assets — shares to burn to withdraw the requested assets (rounds UP)
        assets = body.amount_int
        shares = await reader.preview_withdraw(assets)

    # Non-custody escape-hatch limits (never a gate — informational only, N2).
    max_withdraw = await reader.max_withdraw(account.account)
    max_redeem = await reader.max_redeem(account.account)
    block = await reader.block_number()

    # Profit-only: at/below the HWM there is provably no fee (from chain reads alone). Above
    # the HWM, the fee attributable to THIS exit needs the per-position cost basis (derived
    # index, not yet built) → null (best-effort), never fabricated.
    est_fee_on_yield_usd: str | None = "0.00" if pps <= hwm else None

    return WithdrawQuoteResponse(
        by=body.by.value,
        shares=str(shares),
        assets=str(assets),
        # Cost-basis breakdown needs the derived index (fee indexer owns it) → null here.
        principalUsd=None,
        accruedYieldUsd=None,
        performanceFee=PerformanceFeeWithdraw(
            rateBps=rate_bps,
            maxRateBps=GOVERNANCE.performance_fee.ceiling_bps,
            base=_FEE_BASE,
            highWaterMark=_format_wad_ratio(hwm),
            estFeeOnYieldUsd=est_fee_on_yield_usd,
            netYieldUsd=None,
            disclosure=_WITHDRAW_DISCLOSURE,
            doesNotGateWithdraw=True,  # N2 — fee accrual is FAIL-OPEN; it can never gate the exit
        ),
        maxWithdraw=str(max_withdraw),
        maxRedeem=str(max_redeem),
        note=_WITHDRAW_NOTE,
        exitHatchUrl=_EXIT_HATCH_URL,
        asOfBlock=block,
        stale=False,
    )


class VaultSimulateResponse(BaseModel):
    """§018/US2 ``POST /vault/simulate/{deposit,withdraw}`` 200 body — the read-only pre-sign
    dry-run envelope. Mirrors ``packages/shared`` ``VaultSimulateResponseSchema`` byte-for-byte
    (``extra="forbid"``, camelCase). Wraps the canonical :class:`SimulationResult` from the
    ``viem_eth_call`` dry-run of the REAL mutating calldata, plus two honesty signals:

    - ``approvalRequired`` — DEPOSIT only: the live USDC allowance to the vault is below the
      amount, so the deposit ``eth_call`` would revert on ``transferFrom`` for a reason that is
      NOT a real problem → we DEFER the dry-run (``simulation = null``) and say "approve first".
    - ``sharesOut``/``assetsOut`` — the deterministic ERC-4626 ``previewDeposit``/``previewRedeem``
      read straight from chain (the ``viem_eth_call`` leg diffs no balances, so the sim's own
      ``sharesOut``/``assetsOut`` stay null — these envelope fields carry the real amount).

    Non-custody: eth_call + eth_estimateGas trace only — never signs/submits, and the withdraw
    dry-run is advisory (it can never gate the exit, N2)."""

    model_config = ConfigDict(extra="forbid")

    kind: str  # "deposit" | "withdraw"
    approvalRequired: bool
    simulation: SimulationResult | None
    sharesOut: str | None
    assetsOut: str | None


def _encode_deposit(assets: int, receiver: str) -> str:
    """ABI-encode ``deposit(uint256 assets, address receiver)`` calldata (for eth_call ONLY)."""
    return _DEPOSIT_SELECTOR + eth_abi.encode(["uint256", "address"], [assets, receiver]).hex()


def _encode_redeem(shares: int, receiver: str, owner: str) -> str:
    """ABI-encode ``redeem(uint256 shares, address receiver, address owner)`` (eth_call ONLY)."""
    return _REDEEM_SELECTOR + eth_abi.encode(
        ["uint256", "address", "address"], [shares, receiver, owner]
    ).hex()


# The pre-sign dry-run runner: (request, rpc_url) → SimulationResult. Injected so tests can supply
# a fake without a live RPC; the default runs the real fork-free viem_eth_call check.
DryRunner = Callable[[SimulationRequest, str], Awaitable[SimulationResult]]


async def _default_dry_runner(request: SimulationRequest, rpc_url: str) -> SimulationResult:
    """Run the fork-free ``viem_eth_call`` dry-run — a real revert/return check + gas estimate.
    A transport/RPC failure fails CLOSED to the canonical ``UPSTREAM_UNAVAILABLE`` envelope (never a
    fabricated "passed")."""
    try:
        async with ViemEthCallChecker(rpc_url) as checker:
            return await checker.check(request)
    except SimulatorUnavailableError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The simulation RPC is unreachable; the pre-trade dry-run is temporarily unavailable.",
            reasons=[ErrorReason(ReasonCode.SIM_UNAVAILABLE.value, str(exc))],
        ) from exc


def get_sim_config() -> AgentConfig:
    """Process config for the §018/US2 simulate endpoints (vault address + RPC). Overridden in
    tests. Scoped per request chain by the endpoint via ``for_chain``."""
    return AgentConfig.from_env()


def get_dry_runner() -> DryRunner:
    """The pre-sign dry-run runner (viem_eth_call). Overridden in tests with a fake that returns a
    preset :class:`SimulationResult` (or raises to exercise the fail-closed path)."""
    return _default_dry_runner


def _build_sim_request(
    *, chain_id: int, sender: str, vault: str, data: str, action: ActionType
) -> SimulationRequest:
    """The unsigned eth_call to dry-run (never signed/submitted — N1/N3)."""
    return SimulationRequest(
        chain_id=chain_id,
        sender=sender,
        to=vault,
        data=data,
        value=0,
        op_type="eoa_call",
        action=action,
    )


@router.post("/vault/simulate/deposit", response_model=VaultSimulateResponse)
async def simulate_deposit(
    body: VaultQuoteRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    dry_run: Annotated[DryRunner, Depends(get_dry_runner)],
) -> VaultSimulateResponse:
    """Read-only pre-sign dry-run of the REAL ``deposit(assets, receiver)`` calldata (§018/US2).

    Reads the user's live USDC allowance first: when it is below the amount the deposit would
    revert on ``transferFrom`` for a non-problem reason, so we DEFER the dry-run and return
    ``approvalRequired = true`` (never a spurious "would revert"). Otherwise we ``eth_call``-
    dry-run the actual deposit and return ``willRevert`` + decoded reason + real gas. The
    expected shares (``sharesOut``) are the on-chain ``previewDeposit``. Fails closed to
    ``SIMULATION_UNAVAILABLE``/``UPSTREAM_UNAVAILABLE`` on an undeployed vault / unreachable RPC —
    never a fabricated pass. This eth_call trace holds no key and moves no funds (N1/N3)."""
    chain_config = config.for_chain(account.chain_id)
    # asset() fails closed (VaultUnavailable → SIMULATION_UNAVAILABLE) when the vault is undeployed,
    # so a vault address is proven present before we read it for the calldata `to`.
    usdc = await reader.asset()
    vault = chain_config.require_vault_address()
    receiver = account.account

    # Resolve to the asset amount (for the calldata) + the expected shares (for display).
    if body.by is QuoteBy.ASSETS:
        assets = body.amount_int
        shares = await reader.preview_deposit(assets)
    else:  # by == shares — assets needed to mint the requested shares (rounds UP)
        shares = body.amount_int
        assets = await reader.preview_mint(shares)

    # Allowance gate: a deposit eth_call reverts on transferFrom when allowance < assets — that is
    # "approve first", NOT a real revert. Defer the dry-run and say so honestly (no false fail).
    allowance = await reader.token_allowance(usdc, account.account, vault)
    if allowance < assets:
        return VaultSimulateResponse(
            kind="deposit",
            approvalRequired=True,
            simulation=None,
            sharesOut=str(shares),
            assetsOut=None,
        )

    sim = await dry_run(
        _build_sim_request(
            chain_id=account.chain_id,
            sender=account.account,
            vault=vault,
            data=_encode_deposit(assets, receiver),
            action=ActionType.VAULT_DEPOSIT,
        ),
        chain_config.rpc_url,
    )
    return VaultSimulateResponse(
        kind="deposit",
        approvalRequired=False,
        simulation=sim,
        sharesOut=str(shares),
        assetsOut=None,
    )


@router.post("/vault/simulate/withdraw", response_model=VaultSimulateResponse)
async def simulate_withdraw(
    body: VaultQuoteRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_sim_config)],
    dry_run: Annotated[DryRunner, Depends(get_dry_runner)],
) -> VaultSimulateResponse:
    """Read-only pre-sign dry-run of the REAL ``redeem(shares, receiver, owner)`` (§018/US2).

    ADVISORY ONLY — this NEVER gates the exit (N2): the web confirm gate treats a withdraw
    dry-run as informational and keeps Sign / the on-chain escape hatch open regardless of the
    verdict or a sim outage. No allowance is needed (the user burns their own shares). Returns
    ``willRevert`` + decoded reason + real gas; the expected assets (``assetsOut``) are the
    on-chain ``previewRedeem`` (already net of fee-share dilution). Fails closed on an undeployed
    vault / unreachable RPC — never a fabricated pass."""
    chain_config = config.for_chain(account.chain_id)
    # A view read first: fails closed (VaultUnavailable) on an undeployed vault before any encode.
    if body.by is QuoteBy.SHARES:
        shares = body.amount_int
        assets = await reader.preview_redeem(shares)
    else:  # by == assets — shares to burn to withdraw the requested assets (rounds UP)
        assets = body.amount_int
        shares = await reader.preview_withdraw(assets)
    vault = chain_config.require_vault_address()

    sim = await dry_run(
        _build_sim_request(
            chain_id=account.chain_id,
            sender=account.account,
            vault=vault,
            # redeem(shares, receiver=owner, owner) — recipient forced to the user's own account.
            data=_encode_redeem(shares, account.account, account.account),
            action=ActionType.VAULT_REDEEM,
        ),
        chain_config.rpc_url,
    )
    return VaultSimulateResponse(
        kind="withdraw",
        approvalRequired=False,
        simulation=sim,
        sharesOut=None,
        assetsOut=str(assets),
    )


# ─────────────────────────────────────────────────────────────────────────────
# VaultUnavailable → §1.5 envelope (registered on the app in api/main.py)
# ─────────────────────────────────────────────────────────────────────────────

# Maps the chain layer's typed reason to a §1.6 code so the api/ layer owns the wire
# code while chain/ stays decoupled (never a fabricated value on either outage).
_UNAVAILABLE_CODE: dict[VaultUnavailableReason, ErrorCode] = {
    VaultUnavailableReason.NOT_DEPLOYED: ErrorCode.SIMULATION_UNAVAILABLE,
    VaultUnavailableReason.RPC_UNREACHABLE: ErrorCode.UPSTREAM_UNAVAILABLE,
}

_UNAVAILABLE_MESSAGE: dict[VaultUnavailableReason, str] = {
    VaultUnavailableReason.NOT_DEPLOYED: (
        "The vault is not deployed on this chain; no quote can be produced (fail-closed)."
    ),
    VaultUnavailableReason.RPC_UNREACHABLE: (
        "The vault RPC is unreachable; the quote is temporarily unavailable (retryable)."
    ),
}


async def vault_unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render a :class:`VaultUnavailable` as the canonical §1.5 envelope (never a fabricated
    quote). NOT_DEPLOYED → SIMULATION_UNAVAILABLE (503); RPC_UNREACHABLE → UPSTREAM_UNAVAILABLE
    (503, retryable)."""
    assert isinstance(exc, VaultUnavailable)  # noqa: S101 — registered only for VaultUnavailable
    code = _UNAVAILABLE_CODE[exc.reason]
    api_error = ApiError(
        code,
        _UNAVAILABLE_MESSAGE[exc.reason],
        reasons=[ErrorReason(exc.reason.value, str(exc))],
    )
    request_id = getattr(request.state, "request_id", None)
    if not isinstance(request_id, str):
        request_id = new_request_id()
    return render_api_error(api_error, request_id)
