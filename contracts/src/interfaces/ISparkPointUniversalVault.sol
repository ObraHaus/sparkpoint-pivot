// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title ISparkPointUniversalVault
/// @notice The custody surface of the universal wrapper (feature 049). ONE implementation wraps ANY
///         allowlisted ERC-4626 child; each proxy is bound to exactly one child at initialization
///         and that binding has NO setter. Upgradeability lives ONLY in the beacon (owned by the
///         TimelockController) — never in this interface: there is no upgradeTo, no sweep, no
///         rescue, no migrate selector, and no function that moves assets to a SparkPoint address.
interface ISparkPointUniversalVault {
    /// @notice Initializer parameters (struct keeps the initializer's stack shallow).
    /// @param asset the ERC-4626 asset (must equal `child.asset()` — re-checked here).
    /// @param child the one ERC-4626 vault this instance wraps. No setter exists.
    /// @param guardian the pause + bounded-parameter authority (the timelock).
    /// @param factory the deploy-only factory, recorded for provenance.
    /// @param capRegistry per-wrapper inflow caps (never gates withdrawals).
    /// @param feeRecipient ordinary, non-privileged share holder receiving fee dilution.
    /// @param performanceFeeBps ≤ MAX_PERFORMANCE_FEE_BPS.
    struct InitParams {
        IERC20 asset;
        IERC4626 child;
        address guardian;
        address factory;
        address capRegistry;
        address feeRecipient;
        uint16 performanceFeeBps;
        string name;
        string symbol;
        string label;
    }

    /// @notice One-time proxy initializer. Called atomically by `SparkPointVaultFactoryV2`.
    function initialize(InitParams calldata params) external;

    // ── custody-relevant views (Trust Center provability) ────────────────────

    function child() external view returns (address);
    function guardian() external view returns (address);
    function factory() external view returns (address);
    function capRegistry() external view returns (address);
    function label() external view returns (string memory);
    function paused() external view returns (bool);
    function feeRecipient() external view returns (address);
    function performanceFeeBps() external view returns (uint16);
    function highWaterMark() external view returns (uint256);
    function MAX_PERFORMANCE_FEE_BPS() external pure returns (uint16);
    function entryFeeBasisPoints() external pure returns (uint256);
    function exitFeeBasisPoints() external pure returns (uint256);
    function managementFeeBasisPoints() external pure returns (uint256);

    /// @notice Underlying assets currently withdrawable from the child for this wrapper.
    function availableLiquidity() external view returns (uint256);

    // ── fee + governance (never a fund path) ─────────────────────────────────

    function accrueFee() external returns (uint256 feeShares);
    function harvest() external;
    function setPerformanceFeeBps(uint16 newRateBps) external;
    function setFeeRecipient(address newRecipient) external;
    function setGuardian(address newGuardian) external;
    function pauseDeposits() external;
    function unpauseDeposits() external;

    // ── events ────────────────────────────────────────────────────────────────

    event ChildSupplied(address indexed child, uint256 assets, uint256 childShares);
    event ChildWithdrawn(
        address indexed child, uint256 assets, uint256 childShares, address receiver
    );
    event PerformanceFeeAccrued(
        address indexed recipient, uint256 feeShares, uint256 gainAssets, uint256 newHighWaterMark
    );
    event HighWaterMarkUpdated(uint256 oldMark, uint256 newMark);
    event FeeRateUpdated(uint16 oldRateBps, uint16 newRateBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event GuardianUpdated(address oldGuardian, address newGuardian);
    event DepositsPaused(address by);
    event DepositsUnpaused(address by);
}
