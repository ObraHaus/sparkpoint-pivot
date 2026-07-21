// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title SparkPointMorphoVault
/// @notice Branded, single-purpose, NON-UPGRADEABLE (N5) ERC-4626 wrapper over ONE curated Morpho vault.
///         USDC in -> curated IERC4626 morphoVault -> withdraw anytime (up to live Morpho liquidity).
///         0% management, 0% entry/exit, 0% on principal; a profit-only HWM performance fee (default 1000
///         bps, HARD CAP 2000 bps) minted as fee-SHARES to a non-privileged feeRecipient. External-vault
///         yield is NOT Aave and the SparkPoint fee STACKS on Morpho's native curator fee (both disclosed).
/// @dev Deployed via SparkPointVaultFactory CREATE2 FULL-bytecode (NOT a minimal-proxy clone: a clone
///      delegatecalls an impl, which violates N5's "no delegatecall-to-impl"). morphoVault + guardian +
///      factory + capRegistry are constructor IMMUTABLES. NO sweep/migrate/rescue (N1). withdraw/redeem
///      carry NO whenNotPaused (N2). Non-rebasing: totalAssets == morphoVault.convertToAssets(balanceOf).
interface ISparkPointMorphoVault is IERC4626 {
    // ── The single wrapped protocol target (immutable ⇒ single-purpose, N5) ──
    /// @notice The ONE curated Morpho IERC4626 this instance routes into. Immutable; no setter.
    function morphoVault() external view returns (address);
    /// @notice The deploying factory (provenance; the factory has NO fund path into this instance).
    function factory() external view returns (address);

    // ── Non-rebasing accounting ──
    /// totalAssets() => morphoVault.convertToAssets(morphoVault.balanceOf(address(this)))
    /// @notice Withdrawable amount CLAMPED to live Morpho liquidity so the partial-exit assertion holds.
    ///         For a wrapped Morpho VAULTS V2 (whose max* return 0), availability is derived from the
    ///         market's liquid assets, not maxWithdraw (see research.md / §1.3 note).
    function maxWithdraw(address owner) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);

    // ── Custody-relevant views (public for Trust Center provability, N5) ──
    function paused() external view returns (bool);          // PAUSE-DEPOSITS-ONLY; withdrawals unaffected (N2)
    function guardian() external view returns (address);     // OZ TimelockController; pause/unpause + param-set ONLY
    function capRegistry() external view returns (address);
    function depositCap() external view returns (uint256);
    function label() external view returns (string memory);  // branded display name (registry parity)
    function entryFeeBasisPoints() external pure returns (uint256);       // == 0
    function exitFeeBasisPoints() external pure returns (uint256);        // == 0
    function managementFeeBasisPoints() external pure returns (uint256);  // == 0

    // ── Performance fee (profit-only, HWM, capped — identical spine to ISparkPointVault §6.1) ──
    function MAX_PERFORMANCE_FEE_BPS() external pure returns (uint16);    // == 2000 (20%)
    function performanceFeeBps() external view returns (uint16);          // default 1000; ≤ MAX
    function highWaterMark() external view returns (uint256);             // constructor-seeded; monotonic up
    function feeRecipient() external view returns (address);              // ordinary, non-privileged holder
    function accrueFee() external returns (uint256 feeSharesMinted);      // lazy, FAIL-OPEN; never blocks N2
    function harvest() external;                                          // read-through Morpho + accrueFee()

    // ── Governance (timelocked, guardian-bounded; NEVER a fund/custody/withdraw path — N1, N5) ──
    function setPerformanceFeeBps(uint16 newRateBps) external;            // timelock; reverts if > MAX
    function setFeeRecipient(address newRecipient) external;              // timelock; still non-privileged
    function pauseDeposits() external;                                    // guardian-only; blocks NEW deposits only
    function unpauseDeposits() external;                                  // guardian-only

    // ── Events (superset of ISparkPointVault; Aave events replaced by Morpho leg) ──
    event MorphoSupplied(uint256 assets, uint256 morphoShares);
    event MorphoWithdrawn(uint256 assets, uint256 morphoShares, address indexed receiver);
    event DepositsPaused(address indexed guardian);
    event DepositsUnpaused(address indexed guardian);
    event PerformanceFeeAccrued(address indexed feeRecipient, uint256 feeShares, uint256 yieldAssets, uint256 newHighWaterMark);
    event FeeRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event HighWaterMarkUpdated(uint256 oldHighWaterMark, uint256 newHighWaterMark);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ── DELIBERATELY ABSENT (N1): no sweep / migrate / rescue / recoverERC20 / skim / upgradeTo. ──
}
