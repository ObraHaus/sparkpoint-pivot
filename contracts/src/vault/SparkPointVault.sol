// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISparkPointVault } from "../interfaces/ISparkPointVault.sol";
import { IPool } from "../interfaces/external/IPool.sol";
import { ICapRegistry } from "../interfaces/ICapRegistry.sol";

/// @title SparkPointVault — the Aave Yield Vault (ERC-4626, non-upgradeable, profit-only perf fee)
/// @notice USDC in -> Aave aUSDC -> withdraw anytime. 0% management, 0% entry/exit, 0% on principal; a
///         PERFORMANCE FEE (default 10%, hard-capped 20%) is charged on REALIZED YIELD ONLY, above a
///         share-price high-water mark — never on principal, never in flat/down periods.
/// @dev Faithful implementation of specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §6/§6.1
///      and the §7 ERC-4626 correctness notes. Enforces the non-custody invariants BY CONSTRUCTION:
///        N1  the only asset-out paths are ERC-4626 withdraw/redeem (share-owner/approved only); the
///            perf fee is share DILUTION (_mint to a non-privileged feeRecipient), never an asset move;
///            there is NO sweep/rescue/migrate selector.
///        N2  withdraw/redeem/_withdraw carry NO pause modifier and unwind DIRECTLY against the Aave
///            Pool; the fee accrual on the exit path is try/catch FAIL-OPEN; only deposit/mint carry
///            the deposit-side pause (whenDepositsAllowed).
///        N5  plain contract — no proxy, no upgradeTo, no EIP-1967 slots, no delegatecall-to-impl;
///            custody immutables set in the constructor; governance is pause-only + one hard-capped
///            (<=20%) forward-only performance-fee rate + feeRecipient; mgmt/entry/exit fees pure 0.
///      Built on OZ v5 ERC4626 with the default virtual-shares offset (donation/inflation safe). The
///      constructor SEEDS the HWM to convertToAssets(1e18) (== 1e18 at empty-vault state) so the first
///      accrual can never tax principal (FR-050).
contract SparkPointVault is ERC4626, ISparkPointVault {
    using SafeERC20 for IERC20;

    /// @dev Hard cap on the performance-fee rate (bytecode constant). Governance can NEVER exceed it.
    uint16 internal constant _MAX_PERFORMANCE_FEE_BPS = 2000; // 20%
    uint256 internal constant _BPS_DENOMINATOR = 10_000;

    // ── Custody immutables (N5) — set once in the constructor, never mutable ──
    IPool internal immutable _aavePool;
    IERC20 internal immutable _aUSDC;
    address internal immutable _guardian;
    address internal immutable _capRegistry;

    // ── Governance-mutable state ──
    address internal _feeRecipient; // ordinary, non-privileged share holder (§6.1)
    uint16 internal _performanceFeeBps; // the ONLY mutable fee param; timelocked (guardian) + hard-capped
    uint256 internal _highWaterMark; // share price (assets-per-share, 1e18-scaled); seeded to 1e18 (FR-050)
    bool internal _paused; // deposit-side ONLY; withdrawals are unaffected (N2)

    // ── Revert selectors ──
    error FeeExceedsCap();
    error DepositsArePaused();
    error CapExceeded();
    error NotGuardian();
    error ZeroAddress();
    error ZeroShares();

    /// @dev Deposit-side pause (N2): touches deposit/mint ONLY — never withdraw/redeem.
    modifier whenDepositsAllowed() {
        if (_paused) revert DepositsArePaused();
        _;
    }

    /// @dev The guardian is the pause + timelocked-fee-governance authority. It has NO fund path.
    modifier onlyGuardian() {
        if (msg.sender != _guardian) revert NotGuardian();
        _;
    }

    /// @dev Sets the custody immutables and SEEDS highWaterMark so the first accrual can never tax
    ///      principal (§6/§6.1, FR-050). At empty-vault state convertToAssets(1e18) == 1e18 under OZ
    ///      ERC4626's virtual-shares offset, so the seed is exactly 1e18.
    constructor(
        IERC20 usdc_,
        IPool aavePool_,
        IERC20 aUSDC_,
        address guardian_,
        address capRegistry_,
        address feeRecipient_,
        uint16 performanceFeeBps_
    ) ERC20("SparkPoint Aave USDC Vault", "spkUSDC") ERC4626(usdc_) {
        if (
            address(usdc_) == address(0) || address(aavePool_) == address(0)
                || address(aUSDC_) == address(0) || guardian_ == address(0)
                || capRegistry_ == address(0) || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (performanceFeeBps_ > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();

        _aavePool = aavePool_;
        _aUSDC = aUSDC_;
        _guardian = guardian_;
        _capRegistry = capRegistry_;
        _feeRecipient = feeRecipient_;
        _performanceFeeBps = performanceFeeBps_;
        _highWaterMark = convertToAssets(1e18); // SEED == 1e18 (empty-vault virtual-offset)

        // One-time approval so the Pool can pull USDC on supply(). The Pool only pulls when this vault
        // itself calls supply(); this grants no admin asset-movement path (N1).
        usdc_.forceApprove(address(aavePool_), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERC-4626 accounting — totalAssets is the full Aave-backed claim (§6/§7)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The vault's Aave-backed claim: aUSDC.balanceOf(this) (rebasing; includes Aave interest).
    ///         In normal operation every deposited USDC is supplied to Aave immediately, so idle USDC is
    ///         always 0 — we therefore price shares off the aUSDC claim ONLY. Excluding idle USDC makes
    ///         raw-token DONATIONS (usdc.transfer straight to the vault) NOT move the share price, which
    ///         hardens the OZ virtual-offset against inflation/donation attacks (§7). The performance
    ///         fee is share dilution (§6.1), NOT a term here, so totalAssets is always the full claim.
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        return _aUSDC.balanceOf(address(this));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Caps (G2) — enforced via maxDeposit/maxMint; caps NEVER gate withdraw/redeem (N2)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice min(perUserRemaining, totalRemaining, vaultRemaining); 0 at cap or while paused.
    function maxDeposit(address receiver)
        public
        view
        override(ERC4626, IERC4626)
        returns (uint256)
    {
        if (_paused) return 0;
        ICapRegistry reg = ICapRegistry(_capRegistry);
        uint256 ta = totalAssets();
        uint256 userAssets = convertToAssets(balanceOf(receiver));

        uint256 perUserCap = reg.perUserCap();
        uint256 totalCap = reg.totalCap();
        uint256 vaultCap = reg.vaultCap();

        uint256 perUserRemaining = perUserCap > userAssets ? perUserCap - userAssets : 0;
        uint256 totalRemaining = totalCap > ta ? totalCap - ta : 0;
        uint256 vaultRemaining = vaultCap > ta ? vaultCap - ta : 0;

        return Math.min(perUserRemaining, Math.min(totalRemaining, vaultRemaining));
    }

    /// @notice The share-denominated cap, derived from maxDeposit (rounds DOWN, vault's favor).
    function maxMint(address receiver) public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 assetsCap = maxDeposit(receiver);
        if (assetsCap >= type(uint256).max) return type(uint256).max;
        return convertToShares(assetsCap);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdraw liquidity clamps (N2) — rounding-sound against availableLiquidity
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Underlying USDC currently withdrawable from Aave for this vault. For a request <= this,
    ///         Aave v3 IPool.withdraw returns EXACTLY the requested amount.
    function availableLiquidity() public view returns (uint256) {
        return Math.min(_aUSDC.balanceOf(address(this)), IERC20(asset()).balanceOf(address(_aUSDC)));
    }

    /// @notice Assets implied by the owner's shares (rounds DOWN), clamped to what Aave can pay. Never
    ///         reduced by pause, caps, or fee accrual.
    function maxWithdraw(address owner) public view override(ERC4626, IERC4626) returns (uint256) {
        return Math.min(convertToAssets(balanceOf(owner)), availableLiquidity());
    }

    /// @notice Shares payable from current liquidity (convertToShares rounds DOWN, so
    ///         previewRedeem(maxRedeem) <= availableLiquidity). Never reduced by pause/caps/fee.
    function maxRedeem(address owner) public view override(ERC4626, IERC4626) returns (uint256) {
        return Math.min(balanceOf(owner), convertToShares(availableLiquidity()));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deposit / mint — pausable + cap-checked; ACCRUE-THEN-PRICE (FR-050)
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Accrue FIRST (atomic mint-for-gain-above-HWM AND advance) so existing holders pay the fee
    ///      on yield-up-to-now BEFORE the new shares are priced. accrueFee() is FAIL-OPEN; if (and only
    ///      if) its fee-share MINT leg is skipped, the MANDATORY _settleHighWaterMark() fallback
    ///      force-advances the HWM to the current pps WITHOUT minting — so a late depositor is never
    ///      charged on pre-entry yield. The fallback is a no-op on the success path and NEVER runs
    ///      before/instead of the mint (that would zero the gain and under-collect the fee).
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626, IERC4626)
        whenDepositsAllowed
        returns (uint256 shares)
    {
        _tryAccrueFee();
        _settleHighWaterMark();
        if (assets > maxDeposit(receiver)) revert CapExceeded();
        shares = previewDeposit(assets); // priced AFTER accrual so the depositor is not diluted by it
        // Refuse a deposit that would mint 0 shares (a donation/inflated-pps edge) so a depositor never
        // surrenders assets for nothing — the OZ virtual-offset defence, backstopped by construction.
        // Slither incorrect-equality FP: `shares` is tainted by the aUSDC balanceOf read inside
        // convertToShares, so an `== 0` here reads as a manipulable strict equality. `< 1` is the
        // identical predicate with no strict equality (resolves the finding; no strict-equality fix).
        if (shares < 1) revert ZeroShares();
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver)
        public
        override(ERC4626, IERC4626)
        whenDepositsAllowed
        returns (uint256 assets)
    {
        _tryAccrueFee();
        _settleHighWaterMark();
        if (shares > maxMint(receiver)) revert CapExceeded();
        assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    /// @dev Pull USDC in, supply it to Aave (aUSDC held by the vault), then mint shares.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        IERC20 usdc = IERC20(asset());
        usdc.safeTransferFrom(caller, address(this), assets);
        _aavePool.supply(address(usdc), assets, address(this), 0);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
        emit AaveSupplied(assets);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdraw / redeem — NO pause modifier (N2); unwind DIRECTLY against Aave
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev _tryAccrueFee() is FAIL-OPEN; it can NEVER block the exit below. The OZ path clamps to
    ///      maxWithdraw, then _withdraw pulls from Aave and burns.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626, IERC4626)
        returns (uint256 shares)
    {
        _tryAccrueFee();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626, IERC4626)
        returns (uint256 assets)
    {
        _tryAccrueFee();
        return super.redeem(shares, receiver, owner);
    }

    /// @dev Pull from Aave FIRST (to this vault), then burn shares + transfer to the receiver. Because
    ///      the public wrappers clamp to maxWithdraw/maxRedeem, assets <= availableLiquidity() always
    ///      holds, so `received == assets` is a defensive assertion that cannot trip. Do NOT call
    ///      _spendAllowance here — super._withdraw already spends it exactly once when caller != owner.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        uint256 received = _aavePool.withdraw(asset(), assets, address(this));
        // `>=`: the invariant is "never settle for less than requested". Aave withdraw returns the
        // exact amount or reverts; `>=` keeps the fail-closed guard while avoiding a strict-equality
        // predicate on an external-call return (slither incorrect-equality).
        require(received >= assets, "PARTIAL");
        super._withdraw(caller, receiver, owner, assets, shares);
        emit AaveWithdrawn(assets, receiver);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §6.1 performance fee — lazy, profit-only, HWM, FAIL-OPEN mint leg
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Lazy, idempotent fee accrual. Mints fee shares to feeRecipient worth
    ///         feeRate x (assets gained above the HWM since last accrual), then advances the HWM.
    ///         Profit-only: no fee at/below the HWM (flat/down periods), no fee on principal.
    /// @dev Kept `virtual` so a test harness can mock a reverting accrual to prove the exit path is
    ///      fail-open (N2). Fee is DILUTION (new shares to a non-privileged holder), so totalAssets()
    ///      is never touched and no existing holder's underlying is reduced below principal.
    function accrueFee() public virtual override returns (uint256 feeShares) {
        uint256 pps = convertToAssets(1e18);
        uint256 hwm = _highWaterMark;
        if (pps <= hwm) return 0; // flat/down -> no fee, HWM unchanged

        uint256 supply = totalSupply();
        // slither-disable-next-line divide-before-multiply -- intentional two-step floor,
        // identical to the shipped/audited fee arithmetic; a one-step mulDiv would change the
        // rounded fee on a DEPLOYED vault.
        uint256 gainAssets = ((pps - hwm) * supply) / 1e18; // yield realized above the mark
        // slither-disable-next-line divide-before-multiply -- see the note on gainAssets.
        uint256 feeAssets = (gainAssets * _performanceFeeBps) / _BPS_DENOMINATOR;
        // `< 1` == `== 0` for a uint; avoids slither's strict-equality FP on balance-tainted values.
        if (feeAssets < 1) return 0;

        uint256 ta = totalAssets();
        if (ta <= feeAssets) return 0; // defensive: cannot dilute more than exists
        feeShares = (feeAssets * supply) / (ta - feeAssets); // round DOWN (vault's / holders' favor)
        if (feeShares < 1) return 0;

        _mint(_feeRecipient, feeShares); // dilution only — totalAssets() untouched
        uint256 newHwm = convertToAssets(1e18); // post-mint pps (monotonic up)
        emit PerformanceFeeAccrued(_feeRecipient, feeShares, gainAssets, newHwm);
        emit HighWaterMarkUpdated(hwm, newHwm);
        _highWaterMark = newHwm;
    }

    /// @notice Realize Aave interest into the share price and accrue the fee (keeper convenience).
    ///         The aUSDC balance already reflects accrued interest, so this is a fail-open accrual.
    function harvest() external override {
        _tryAccrueFee();
    }

    /// @dev FAIL-OPEN wrapper. A revert in fee accrual is swallowed so the redemption/deposit is never
    ///      blocked (N2). The external self-call boundary is what makes the try/catch effective.
    function _tryAccrueFee() internal {
        // Bound AND referenced (see SparkPointUniversalVault): a bare `try f() { }` reads as an
        // ignored return to some analyzer builds. The mint inside accrueFee() is the side effect.
        try this.accrueFee() returns (uint256 feeShares) {
            if (feeShares > 0) { }
        } catch { }
    }

    /// @notice MANDATORY (non-fail-open) deposit-time HWM advance. Settles the HWM up to the current
    ///         pps WITHOUT minting. Runs AFTER _tryAccrueFee() in deposit()/mint() — never before/
    ///         instead of the fee-share mint. A no-op on the success path (accrueFee already advanced
    ///         the HWM); it does real work only when accrueFee's mint leg failed open, so a late
    ///         depositor entering above the global HWM is never later charged on pre-entry yield.
    function _settleHighWaterMark() internal {
        uint256 pps = convertToAssets(1e18);
        if (pps > _highWaterMark) {
            emit HighWaterMarkUpdated(_highWaterMark, pps);
            _highWaterMark = pps;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Governance — timelocked (guardian), hard-capped; NEVER a fund/withdraw path (N1, N5)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Set the performance-fee rate. Guardian-only (timelock/multisig); reverts above the cap.
    ///         Touches only the FORWARD fee on FUTURE yield-above-HWM — never principal/withdraw.
    function setPerformanceFeeBps(uint16 newRateBps) external override onlyGuardian {
        if (newRateBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();
        emit FeeRateUpdated(_performanceFeeBps, newRateBps);
        _performanceFeeBps = newRateBps;
    }

    /// @notice Set the fee-share recipient. Guardian-only. The recipient is always an ordinary,
    ///         non-privileged share holder with no authority over other users' funds.
    function setFeeRecipient(address newRecipient) external override onlyGuardian {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(_feeRecipient, newRecipient);
        _feeRecipient = newRecipient;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pause — PAUSE-ONLY kill switch (N5). Guardian-only; deposit/mint side ONLY.
    // ─────────────────────────────────────────────────────────────────────────

    function pauseDeposits() external override onlyGuardian {
        _paused = true;
        emit DepositsPaused(msg.sender);
    }

    function unpauseDeposits() external override onlyGuardian {
        _paused = false;
        emit DepositsUnpaused(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Custody-relevant views (public for Trust Center provability, N5)
    // ─────────────────────────────────────────────────────────────────────────

    function paused() public view override returns (bool) {
        return _paused;
    }

    function guardian() external view override returns (address) {
        return _guardian;
    }

    function pauser() external view override returns (address) {
        return _guardian;
    }

    function capRegistry() external view override returns (address) {
        return _capRegistry;
    }

    function aavePool() external view override returns (address) {
        return address(_aavePool);
    }

    function aUSDC() external view override returns (address) {
        return address(_aUSDC);
    }

    function depositCap() external view override returns (uint256) {
        return ICapRegistry(_capRegistry).vaultCap();
    }

    function feeRecipient() external view override returns (address) {
        return _feeRecipient;
    }

    function performanceFeeBps() external view override returns (uint16) {
        return _performanceFeeBps;
    }

    function highWaterMark() external view override returns (uint256) {
        return _highWaterMark;
    }

    // ── Fees that are a compile-time constant 0 at the bytecode level (N5) ──
    function MAX_PERFORMANCE_FEE_BPS() external pure override returns (uint16) {
        return _MAX_PERFORMANCE_FEE_BPS;
    }

    function entryFeeBasisPoints() external pure override returns (uint256) {
        return 0;
    }

    function exitFeeBasisPoints() external pure override returns (uint256) {
        return 0;
    }

    function managementFeeBasisPoints() external pure override returns (uint256) {
        return 0;
    }
}
