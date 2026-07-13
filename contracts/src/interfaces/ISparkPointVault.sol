// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title SparkPointVault
/// @notice Single-purpose, 0-management / profit-only performance-fee Aave Yield Vault.
///         USDC in → Aave aUSDC → withdraw anytime. 0% management, 0% entry/exit, 0% on principal;
///         a PERFORMANCE FEE of 10% (default; on-chain-configurable within a HARD CAP of 20%) is
///         charged on REALIZED YIELD ONLY, above a high-water mark (HWM) on share price — never on
///         principal, never in flat/down periods. "We only earn when you earn — never on your
///         principal, never by taking custody." ACTIVE AT LAUNCH (Sept 2026 v1).
/// @dev NON-UPGRADEABLE (N5): plain contract, no proxy, no upgradeTo, no EIP-1967 slots, no
///      delegatecall-to-impl. Immutables (USDC, AAVE_POOL, aUSDC, guardian, capRegistry) set in
///      constructor. Built on OZ v5 ERC4626 with virtual-offset (donation/inflation safe).
///      CONSTRUCTOR SEEDS the HWM: `highWaterMark = convertToAssets(1e18)` (== 1e18 under the OZ
///      ERC4626 virtual-shares offset at empty-vault state) so the first accrueFee() can NEVER charge
///      the fee on principal (a default-0 HWM would tax the ENTIRE share value on the first accrual —
///      N-fee / FR-050). The seeded HWM is monotonic up and never sits below 1e18 thereafter.
///      INVARIANT N2: withdraw/redeem carry NO whenNotPaused — exit is unconditional.
///      PERFORMANCE FEE (see §6.1) is realized by MINTING fee shares to a NON-PRIVILEGED feeRecipient
///      during a lazy, FAIL-OPEN `_accrueFee()` — it can NEVER block/revert withdraw/redeem and NEVER
///      reduce a user's redeemable principal below deposited principal. feeRate is the ONLY mutable
///      param: timelocked, hard-capped at 20%, multisig-bounded, and can NEVER alter custody/withdraw/
///      principal semantics (N1–N5 unchanged). Constitution v1.1.0 (standard amendment).
/// @dev Transcribed verbatim from specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §6.
interface ISparkPointVault is IERC4626 {
    /// ── ERC-4626 surface (asset/share accounting; OZ-standard rounding ALWAYS in the VAULT's favor) ──
    /// asset()        => USDC
    /// totalAssets()  => aUSDC.balanceOf(this) (+ idle USDC, ~0). Reflects Aave yield automatically.
    ///                   The performance fee is taken via fee-SHARE dilution (§6.1), NOT by deducting
    ///                   from totalAssets() — so totalAssets() is always the full Aave-backed claim.
    /// convertToShares / convertToAssets / previewDeposit / previewMint / previewWithdraw / previewRedeem
    /// deposit(assets, receiver) / mint(shares, receiver)        — pausable (deposit side ONLY)
    /// withdraw(assets, receiver, owner) / redeem(shares, receiver, owner)  — NEVER pausable (N2)
    /// maxDeposit(receiver) => min(perUserRemaining, totalRemaining, vaultRemaining); 0 at cap (caps via ERC-4626)
    /// maxMint / maxWithdraw / maxRedeem accordingly

    /// ── Events ──
    /// Inherited ERC-4626: Deposit(caller, owner, assets, shares); Withdraw(caller, receiver, owner, assets, shares)
    event DepositsPaused(address indexed guardian);
    event DepositsUnpaused(address indexed guardian);
    event AaveSupplied(uint256 assets);
    event AaveWithdrawn(uint256 assets, address indexed receiver);
    /// @notice Fee shares minted to feeRecipient for realized yield above the HWM (§6.1). Profit-only.
    event PerformanceFeeAccrued(address indexed feeRecipient, uint256 feeShares, uint256 yieldAssets, uint256 newHighWaterMark);
    /// @notice feeRate changed by timelocked, hard-capped (≤2000 bps), multisig-bounded governance.
    event FeeRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    /// @notice HWM (share price, 1e18-scaled) advanced after a fee accrual on new highs.
    event HighWaterMarkUpdated(uint256 oldHighWaterMark, uint256 newHighWaterMark);
    /// @notice feeRecipient changed (timelocked governance). Always an ORDINARY, non-privileged holder.
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// ── Custody-relevant views (public for Trust Center provability, N5) ──
    function paused() external view returns (bool);     // PAUSE-ONLY status; withdrawals unaffected
    function guardian() external view returns (address); // multisig — pause/unpause ONLY, no fund path
    function pauser() external view returns (address);   // the ops multisig; role scope = PAUSE-ONLY (cannot move funds or block withdrawals)
    function depositCap() external view returns (uint256);
    function capRegistry() external view returns (address);
    function aavePool() external view returns (address);
    function aUSDC() external view returns (address);
    /// @notice Entry/exit fee BPS — overridden to a compile-time constant 0; not settable (0 at bytecode level).
    function entryFeeBasisPoints() external pure returns (uint256);  // == 0 (pure constant)
    function exitFeeBasisPoints() external pure returns (uint256);   // == 0 (pure constant)
    /// @notice Management fee BPS — overridden to a compile-time constant 0; not settable (no time-based fee).
    function managementFeeBasisPoints() external pure returns (uint256); // == 0 (pure constant)

    /// ── Performance fee surface (profit-only, HWM, capped — §6.1; public-view for Trust Center, N5) ──
    /// @notice Hard cap on the performance fee (bytecode constant). Governance can NEVER exceed this.
    function MAX_PERFORMANCE_FEE_BPS() external pure returns (uint16); // == 2000 (20%)
    /// @notice Current performance-fee rate in bps. Default 1000 (10%); timelocked, ≤ MAX_PERFORMANCE_FEE_BPS.
    ///         Applies ONLY to realized yield above the HWM — never to principal, never in flat/down periods.
    function performanceFeeBps() external view returns (uint16);
    /// @notice High-water mark on SHARE PRICE (assets-per-share, 1e18-scaled). Fee accrues only above this.
    ///         SEEDED in the constructor to `convertToAssets(1e18)` (== 1e18 at empty-vault state) so the
    ///         first accrual can never tax principal, and ADVANCED to the current pps on every deposit
    ///         (mandatory, non-fail-open). Monotonic up; never < 1e18 from block 0 (FR-050).
    function highWaterMark() external view returns (uint256);
    /// @notice The fee-share recipient — an ORDINARY, NON-privileged holder. Redeems via the same
    ///         withdraw/redeem path as any user; has NO admin/withdraw authority over other holders'
    ///         shares and cannot block, delay, or reorder any redemption.
    function feeRecipient() external view returns (address);

    /// @notice Lazy, idempotent fee accrual. Best-effort / FAIL-OPEN: if anything would revert it MUST
    ///         no-op and return 0 (NEVER bubble up). Invoked at the TOP of deposit/withdraw/redeem/harvest.
    ///         Mints fee shares to feeRecipient worth feeRate × (assets gained above HWM since last
    ///         accrual), then advances the HWM. Callable by anyone (e.g. a keeper); the withdraw/redeem
    ///         escape-hatch path NEVER depends on its success (N2).
    function accrueFee() external returns (uint256 feeSharesMinted);

    /// @notice Realize Aave interest into the share price and accrue the fee (keeper convenience).
    ///         Pure read-through to Aave + accrueFee(); no custody movement. Also FAIL-OPEN on the fee leg.
    function harvest() external;

    /// ── Governance (timelocked, multisig-bounded; NEVER a fund/custody/withdraw path — N1, N5) ──
    /// @notice Set the performance-fee rate. Timelocked + multisig; reverts if newRateBps > MAX (20%).
    ///         Cannot alter custody/withdraw/principal semantics; only the forward fee on FUTURE yield.
    function setPerformanceFeeBps(uint16 newRateBps) external;       // timelock + onlyGovernance; ≤ MAX
    /// @notice Set the fee-share recipient (timelocked + multisig). The new recipient is still an
    ///         ordinary, non-privileged share holder with no power over other users' funds.
    function setFeeRecipient(address newRecipient) external;          // timelock + onlyGovernance

    /// ── Pause: PAUSE-ONLY kill-switch (N5). Multisig/guardian ONLY. Touches deposit/mint ONLY. ──
    function pauseDeposits() external;   // guardian-only; blocks NEW deposits, never withdrawals
    function unpauseDeposits() external; // guardian-only
}
