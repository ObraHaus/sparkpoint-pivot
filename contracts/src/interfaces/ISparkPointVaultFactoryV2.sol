// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title ISparkPointVaultFactoryV2
/// @notice The deploy-only factory surface (feature 049). Holds no funds, has no fund-moving
///         selector, and retains NO authority over anything it deploys: the wrapper's guardian is
///         the timelock and its upgrade authority is the timelock-owned beacon. The factory's only
///         privileged powers are (a) role-gating WHO may deploy, (b) the curated allowlist, and
///         (c) bounded fleet defaults (guardian / fee recipient / beacon / deploy limit).
interface ISparkPointVaultFactoryV2 {
    /// @notice Creation parameters (struct keeps the deploy path's stack shallow).
    /// @param child the one ERC-4626 vault the new wrapper is bound to (no setter afterwards).
    /// @param feeBps performance fee for the new wrapper (≤2000).
    /// @param perUserCap/totalCap/vaultCap CapRegistry inflow caps for the new wrapper.
    /// @param name/symbol/label branding recorded on the wrapper.
    /// @param salt CREATE2 salt; must be unique and non-zero (deterministic address).
    struct CreateVaultParams {
        IERC4626 child;
        uint16 feeBps;
        uint256 perUserCap;
        uint256 totalCap;
        uint256 vaultCap;
        string name;
        string symbol;
        string label;
        bytes32 salt;
    }

    /// @notice Deploy a `BeaconProxy` wrapper for an ALREADY-ALLOWLISTED child. Deploy role only.
    function createVault(CreateVaultParams calldata params) external returns (address proxy);

    /// @notice The deterministic wrapper address for the same inputs, without deploying.
    function predictVaultAddress(CreateVaultParams calldata params)
        external
        view
        returns (address proxy);

    function beacon() external view returns (address);
    function guardian() external view returns (address);
    function feeRecipient() external view returns (address);
    function deployLimit() external view returns (uint32);
    function isDeployer(address account) external view returns (bool);
    function isAllowlisted(address child) external view returns (bool);

    event VaultCreated(
        address indexed child,
        address indexed proxy,
        address capRegistry,
        address indexed deployer,
        uint16 feeBps,
        string label
    );
    event AllowlistUpdated(address indexed child, bool allowed, address by);
    event DeployerUpdated(address indexed account, bool allowed, address by);
    event BeaconUpdated(address oldBeacon, address newBeacon);
    event GuardianUpdated(address oldGuardian, address newGuardian);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event DeployLimitUpdated(uint32 oldLimit, uint32 newLimit);
}
