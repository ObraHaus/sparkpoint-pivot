// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC4626Upgradeable } from
    "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICapRegistry } from "../interfaces/ICapRegistry.sol";
import { ISparkPointUniversalVault } from "../interfaces/ISparkPointUniversalVault.sol";

/// @title SparkPointUniversalVault — the universal upgradeable wrapper (feature 049)
/// @notice ONE implementation wraps ANY allowlisted ERC-4626 child. USDC (or the child's asset) in →
///         exactly one child vault → withdraw anytime (up to live child liquidity). 0 management,
///         0 entry/exit, 0 on principal; a PERFORMANCE FEE (default 10%, hard-capped 20%) is charged
///         on REALIZED YIELD ONLY, above a share-price high-water mark — never on principal, never
///         in flat/down periods. The fee STACKS on the child's own fee (disclosed net off-chain).
///
/// @dev UPGRADEABILITY (constitution v4.0.0). This implementation sits behind an
///      OZ `UpgradeableBeacon` owned by a TimelockController (3-of-5 proposer, independent
///      canceller, ≥72h delay). The proxy's storage is this contract's storage; upgrades MUST
///      preserve the ERC-7201 layout below. There is deliberately NO upgrade function here — the
///      beacon is the only upgrade path, and it is not an asset path.
///
///      NON-CUSTODY INVARIANTS BY CONSTRUCTION:
///        N1  the only asset-out paths are ERC-4626 withdraw/redeem (share owner/approved only); the
///            perf fee is share DILUTION (mint to a non-privileged recipient), never an asset move;
///            there is NO sweep/rescue/migrate/re-target selector anywhere in this contract.
///        N2  withdraw/redeem carry NO pause modifier and unwind DIRECTLY from the child; the fee
///            accrual on the exit path is try/catch FAIL-OPEN; only deposit/mint carry the
///            deposit-side pause. A pending beacon upgrade does not touch this contract at all —
///            users can always exit during an upgrade window.
///        SINGLE CHILD  the child is set in `initialize` and has NO setter; a beacon upgrade cannot
///            re-point it without changing this storage layout (which CI upgrade checks reject).
///
///      NON-REBASING: totalAssets == child.convertToAssets(child.balanceOf(this)) — it tracks the
///      child's share price UP and DOWN. Raw-asset donations do NOT move the share price.
///      INFLATION DEFENSE: OZ v5 virtual shares with `_decimalsOffset() == 3` plus a zero-share
///      refusal on deposit, and the HWM is SEEDED in the initializer so the first accrual can never
///      tax principal.
///
///      STORAGE: ERC-7201 namespaced (slot derived from "sparkpoint.storage.SparkPointUniversalVault").
contract SparkPointUniversalVault is ERC4626Upgradeable, ISparkPointUniversalVault {
    using SafeERC20 for IERC20;

    /// @dev Hard cap on the performance-fee rate (bytecode constant). Governance can NEVER exceed it.
    uint16 internal constant _MAX_PERFORMANCE_FEE_BPS = 2000; // 20%
    uint256 internal constant _BPS_DENOMINATOR = 10_000;

    /// @dev OZ virtual-share offset. 10^3 virtual shares make the first-depositor inflation attack
    ///      uneconomical by orders of magnitude (researched: OZ inflation guidance).
    uint8 internal constant _DECIMALS_OFFSET = 3;

    /// @custom:storage-location erc7201:sparkpoint.storage.SparkPointUniversalVault
    struct UniversalVaultStorage {
        IERC4626 child;
        address guardian;
        address factory;
        address capRegistry;
        address feeRecipient;
        uint16 performanceFeeBps;
        uint256 highWaterMark;
        bool paused;
        string label;
    }

    // keccak256(abi.encode(uint256(keccak256("sparkpoint.storage.SparkPointUniversalVault")) - 1))
    //   & ~bytes32(uint256(0xff))
    bytes32 private constant _STORAGE_LOCATION =
        0xe38e2aa556dc9557a6d80a2485b39c9f8988b74046115b8beae1a4fb18a44f00;

    function _store() private pure returns (UniversalVaultStorage storage $) {
        assembly {
            $.slot := _STORAGE_LOCATION
        }
    }

    // ── errors ────────────────────────────────────────────────────────────────
    error FeeExceedsCap();
    error DepositsArePaused();
    error CapExceeded();
    error NotGuardian();
    error ZeroAddress();
    error ZeroShares();
    error AssetMismatch();
    error SlippageExceeded();
    error InvalidChild();

    /// @dev Deposit-side pause (N2): touches deposit/mint ONLY — never withdraw/redeem.
    modifier whenDepositsAllowed() {
        if (_store().paused) revert DepositsArePaused();
        _;
    }

    /// @dev The guardian is the pause + bounded-parameter authority (the timelock). It has NO fund path.
    modifier onlyGuardian() {
        if (msg.sender != _store().guardian) revert NotGuardian();
        _;
    }

    /// @dev Implementation contracts MUST NOT be initializable directly (a live implementation
    ///      left initializable is the Parity/Wormhole class of bug).
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc ISparkPointUniversalVault
    function initialize(InitParams calldata p) external initializer {
        if (
            address(p.asset) == address(0) || address(p.child) == address(0)
                || p.guardian == address(0) || p.factory == address(0)
                || p.capRegistry == address(0) || p.feeRecipient == address(0)
        ) {
            revert ZeroAddress();
        }
        if (p.performanceFeeBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();
        if (address(p.child).code.length == 0) revert InvalidChild();
        if (p.child.asset() != address(p.asset)) revert AssetMismatch();

        __ERC20_init(p.name, p.symbol);
        __ERC4626_init(p.asset);

        UniversalVaultStorage storage $ = _store();
        $.child = p.child;
        $.guardian = p.guardian;
        $.factory = p.factory;
        $.capRegistry = p.capRegistry;
        $.feeRecipient = p.feeRecipient;
        $.performanceFeeBps = p.performanceFeeBps;
        $.label = p.label;
        // Seed the HWM at empty-vault pps so the first accrual can never tax principal. With the
        // virtual-shares offset this is < 1e18 (see convertToAssets), in the same units accrueFee
        // compares against.
        $.highWaterMark = convertToAssets(1e18);

        // One-time approval so the child can pull the asset on deposit(). The child only pulls when
        // THIS vault calls deposit(); this grants no admin asset-movement path (N1).
        p.asset.forceApprove(address(p.child), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERC-4626 accounting — totalAssets is the full child-backed claim (NON-REBASING)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The wrapper's child-backed claim: child.convertToAssets(child.balanceOf(this)).
    ///         NON-REBASING — tracks the child's share price up and down (a child-side loss is
    ///         reflected, never fabricated). Raw-asset donations do not move the share price.
    function totalAssets() public view override returns (uint256) {
        return _store().child.convertToAssets(_store().child.balanceOf(address(this)));
    }

    /// @dev Research-backed inflation defense (in addition to the HWM seed + zero-share refusal).
    function _decimalsOffset() internal view override returns (uint8) {
        return _DECIMALS_OFFSET;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Caps — enforced via maxDeposit/maxMint; caps NEVER gate withdraw/redeem (N2)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice min(perUserRemaining, totalRemaining, vaultRemaining); 0 at cap or while paused.
    function maxDeposit(address receiver) public view override returns (uint256) {
        UniversalVaultStorage storage $ = _store();
        if ($.paused) return 0;
        ICapRegistry reg = ICapRegistry($.capRegistry);
        uint256 ta = totalAssets();
        uint256 userAssets = convertToAssets(balanceOf(receiver));

        uint256 perUserRemaining = reg.perUserCap() > userAssets ? reg.perUserCap() - userAssets : 0;
        uint256 totalRemaining = reg.totalCap() > ta ? reg.totalCap() - ta : 0;
        uint256 vaultRemaining = reg.vaultCap() > ta ? reg.vaultCap() - ta : 0;

        return Math.min(perUserRemaining, Math.min(totalRemaining, vaultRemaining));
    }

    /// @notice The share-denominated cap, derived from maxDeposit (rounds DOWN, vault's favor).
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assetsCap = maxDeposit(receiver);
        if (assetsCap >= type(uint256).max) return type(uint256).max;
        return convertToShares(assetsCap);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdraw liquidity clamps (N2) — rounding-sound against availableLiquidity
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Underlying assets currently withdrawable from the child for this wrapper. Normally
    ///         child.maxWithdraw(this); for a Morpho-Vault-V2-style child whose max* return 0 while
    ///         holding value, fall back to the FULL claim (optimistic) — the real child.withdraw and
    ///         the "PARTIAL" require in `_withdraw` then fail-close CLEANLY if liquidity is short,
    ///         never a spuriously-zero clamp that would block the escape hatch.
    function availableLiquidity() public view returns (uint256) {
        UniversalVaultStorage storage $ = _store();
        uint256 mw = $.child.maxWithdraw(address(this));
        if (mw == 0 && totalAssets() > 0) {
            return $.child.convertToAssets($.child.balanceOf(address(this)));
        }
        return mw;
    }

    /// @notice Assets implied by the owner's shares (rounds DOWN), clamped to what the child can
    ///         pay. Never reduced by pause, caps, or fee accrual.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(convertToAssets(balanceOf(owner)), availableLiquidity());
    }

    /// @notice Shares payable from current liquidity (convertToShares rounds DOWN). Never reduced by
    ///         pause, caps, or fee accrual (N2).
    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(balanceOf(owner), convertToShares(availableLiquidity()));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deposit / mint — pausable + cap-checked; ACCRUE-THEN-PRICE
    // ─────────────────────────────────────────────────────────────────────────

    function deposit(uint256 assets, address receiver)
        public
        override
        whenDepositsAllowed
        returns (uint256 shares)
    {
        shares = _depositChecked(assets, receiver, 0);
    }

    /// @notice Slippage-bounded deposit (ERC-5143-style convenience; the standard entry point is
    ///         untouched). Reverts if the minted shares are below `minSharesOut`.
    function deposit(uint256 assets, address receiver, uint256 minSharesOut)
        external
        whenDepositsAllowed
        returns (uint256 shares)
    {
        shares = _depositChecked(assets, receiver, minSharesOut);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenDepositsAllowed
        returns (uint256 assets)
    {
        assets = _mintChecked(shares, receiver, type(uint256).max);
    }

    /// @notice Slippage-bounded mint: reverts if the required assets exceed `maxAssetsIn`.
    function mint(uint256 shares, address receiver, uint256 maxAssetsIn)
        external
        whenDepositsAllowed
        returns (uint256 assets)
    {
        assets = _mintChecked(shares, receiver, maxAssetsIn);
    }

    function _depositChecked(uint256 assets, address receiver, uint256 minSharesOut)
        internal
        returns (uint256 shares)
    {
        _tryAccrueFee();
        _settleHighWaterMark();
        if (assets > maxDeposit(receiver)) revert CapExceeded();
        shares = previewDeposit(assets);
        // Refuse a deposit that would mint 0 shares (donation/inflated-pps edge) so a depositor
        // never surrenders assets for nothing.
        if (shares < 1) revert ZeroShares();
        if (shares < minSharesOut) revert SlippageExceeded();
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function _mintChecked(uint256 shares, address receiver, uint256 maxAssetsIn)
        internal
        returns (uint256 assets)
    {
        _tryAccrueFee();
        _settleHighWaterMark();
        if (shares > maxMint(receiver)) revert CapExceeded();
        assets = previewMint(shares);
        if (assets > maxAssetsIn) revert SlippageExceeded();
        _deposit(_msgSender(), receiver, assets, shares);
    }

    /// @dev Pull the asset in, supply it to the child (child shares held by this vault), mint
    ///      wrapper shares. NO admin path exists around this function.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        IERC20 asset_ = IERC20(asset());
        asset_.safeTransferFrom(caller, address(this), assets);
        uint256 childShares = _store().child.deposit(assets, address(this));
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
        emit ChildSupplied(address(_store().child), assets, childShares);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdraw / redeem — NO pause modifier (N2); unwind DIRECTLY from the child
    // ─────────────────────────────────────────────────────────────────────────

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        returns (uint256 shares)
    {
        _tryAccrueFee(); // FAIL-OPEN: can never block the exit
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        returns (uint256 assets)
    {
        _tryAccrueFee(); // FAIL-OPEN: can never block the exit
        return super.redeem(shares, receiver, owner);
    }

    /// @dev Pull from the child FIRST (to this vault), then burn shares + transfer. Require that the
    ///      vault's balance covers the request — no silent short-fill; a short child reverts cleanly.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        IERC20 asset_ = IERC20(asset());
        uint256 childShares = _store().child.withdraw(assets, address(this), address(this));
        require(asset_.balanceOf(address(this)) >= assets, "PARTIAL");
        super._withdraw(caller, receiver, owner, assets, shares);
        emit ChildWithdrawn(address(_store().child), assets, childShares, receiver);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Performance fee — lazy, profit-only, HWM, FAIL-OPEN mint leg
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Lazy, idempotent fee accrual: mints fee shares to the recipient worth
    ///         feeRate × (assets gained above the HWM since the last accrual), then advances the
    ///         HWM. Profit-only: no fee at/below the HWM (flat/down periods), never on principal.
    /// @dev The fee is DILUTION (new shares to a non-privileged holder): totalAssets() is never
    ///      touched and no holder's underlying is reduced below principal. Kept `virtual` so a test
    ///      harness can mock a reverting accrual to prove the exit path is fail-open.
    function accrueFee() public virtual override returns (uint256 feeShares) {
        UniversalVaultStorage storage $ = _store();
        uint256 pps = convertToAssets(1e18);
        uint256 hwm = $.highWaterMark;
        if (pps <= hwm) return 0; // flat/down -> no fee, HWM unchanged

        uint256 supply = totalSupply();
        uint256 gainAssets = ((pps - hwm) * supply) / 1e18; // yield realized above the mark
        uint256 feeAssets = (gainAssets * $.performanceFeeBps) / _BPS_DENOMINATOR;
        if (feeAssets < 1) return 0;

        uint256 ta = totalAssets();
        if (ta <= feeAssets) return 0; // defensive: cannot dilute more than exists
        feeShares = (feeAssets * supply) / (ta - feeAssets); // round DOWN (holders' favor)
        if (feeShares < 1) return 0;

        _mint($.feeRecipient, feeShares); // dilution only — totalAssets() untouched
        uint256 newHwm = convertToAssets(1e18); // post-mint pps
        emit PerformanceFeeAccrued($.feeRecipient, feeShares, gainAssets, newHwm);
        emit HighWaterMarkUpdated(hwm, newHwm);
        $.highWaterMark = newHwm;
    }

    /// @notice Realize child yield into the share price and accrue the fee (keeper convenience).
    function harvest() external override {
        _tryAccrueFee();
    }

    /// @dev FAIL-OPEN: a revert in fee accrual is swallowed so redemption/deposit is never blocked
    ///      (N2). The external self-call boundary is what makes the try/catch effective.
    function _tryAccrueFee() internal {
        try this.accrueFee() returns (uint256) { } catch { }
    }

    /// @notice MANDATORY (non-fail-open) deposit-time HWM advance: settles the HWM up to the current
    ///         pps WITHOUT minting, so a late depositor entering above the global HWM is never
    ///         charged on pre-entry yield if the fee mint leg failed open.
    function _settleHighWaterMark() internal {
        UniversalVaultStorage storage $ = _store();
        uint256 pps = convertToAssets(1e18);
        if (pps > $.highWaterMark) {
            emit HighWaterMarkUpdated($.highWaterMark, pps);
            $.highWaterMark = pps;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Governance — bounded parameters only; NEVER a fund/withdraw path (N1)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Set the performance-fee rate (≤20%). Guardian-only (timelock). Touches only the
    ///         FORWARD fee on FUTURE yield-above-HWM — never principal/withdraw.
    function setPerformanceFeeBps(uint16 newRateBps) external override onlyGuardian {
        if (newRateBps > _MAX_PERFORMANCE_FEE_BPS) revert FeeExceedsCap();
        UniversalVaultStorage storage $ = _store();
        emit FeeRateUpdated($.performanceFeeBps, newRateBps);
        $.performanceFeeBps = newRateBps;
    }

    /// @notice Set the fee-share recipient (an ordinary, non-privileged share holder). Guardian-only.
    function setFeeRecipient(address newRecipient) external override onlyGuardian {
        if (newRecipient == address(0)) revert ZeroAddress();
        UniversalVaultStorage storage $ = _store();
        emit FeeRecipientUpdated($.feeRecipient, newRecipient);
        $.feeRecipient = newRecipient;
    }

    /// @notice Rotate the guardian (e.g. a new timelock). Guardian-only; no fund power either way.
    function setGuardian(address newGuardian) external override onlyGuardian {
        if (newGuardian == address(0)) revert ZeroAddress();
        UniversalVaultStorage storage $ = _store();
        emit GuardianUpdated($.guardian, newGuardian);
        $.guardian = newGuardian;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pause — deposit-side ONLY (N2)
    // ─────────────────────────────────────────────────────────────────────────

    function pauseDeposits() external override onlyGuardian {
        _store().paused = true;
        emit DepositsPaused(msg.sender);
    }

    function unpauseDeposits() external override onlyGuardian {
        _store().paused = false;
        emit DepositsUnpaused(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views (Trust Center provability)
    // ─────────────────────────────────────────────────────────────────────────

    function child() external view override returns (address) {
        return address(_store().child);
    }

    function guardian() external view override returns (address) {
        return _store().guardian;
    }

    function factory() external view override returns (address) {
        return _store().factory;
    }

    function capRegistry() external view override returns (address) {
        return _store().capRegistry;
    }

    function label() external view override returns (string memory) {
        return _store().label;
    }

    function paused() public view override returns (bool) {
        return _store().paused;
    }

    function feeRecipient() external view override returns (address) {
        return _store().feeRecipient;
    }

    function performanceFeeBps() external view override returns (uint16) {
        return _store().performanceFeeBps;
    }

    function highWaterMark() external view override returns (uint256) {
        return _store().highWaterMark;
    }

    // ── Fees that are compile-time 0 at the bytecode level ──
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
