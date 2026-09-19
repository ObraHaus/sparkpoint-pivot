// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title ISparkPointVaultFactoryV3
/// @notice The admission-gateway factory surface (feature 049, amendment v4.1.0). Holds no funds,
///         has no fund-moving selector, and retains NO authority over anything it deploys: the
///         wrapper's guardian is the timelock and its upgrade authority is the timelock-owned
///         beacon.
///
///         RBAC (OpenZeppelin `AccessControl`):
///           * DEFAULT_ADMIN_ROLE — the TimelockController: grant/revoke roles and the bounded
///             non-admission params (beacon / guardian / fee recipient / deploy limit).
///           * ADMIN_ROLE — the operator EOA: instant whitelist, `releaseNow`, `unwhitelist`,
///             `setCooldown`, and `createVault`.
///           * DEPLOYER_ROLE — the AI deploy runner: whitelist (ready after the on-chain
///             cooldown) and `createVault`. No other power.
///
///         The timelock is deliberately NOT an admission role: it cannot whitelist or deploy.
interface ISparkPointVaultFactoryV3 {
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

    /// @notice A pending admission, exactly one per child until it is consumed or cancelled.
    /// @param by the address that admitted the child (admin EOA or AI deployer).
    /// @param readyAt unix seconds at which `createVault` unlocks; **0 = deployable immediately**
    ///        (every admin admission, and any AI entry after `releaseNow`).
    struct WhitelistEntry {
        address by;
        uint64 readyAt;
    }

    // ── admission (ADMIN_ROLE | DEPLOYER_ROLE) ──────────────────────────────

    /// @notice Admit `child`. An admin call is deployable immediately (`readyAt = 0`); a deployer
    ///         call unlocks after the current cooldown (`readyAt = now + cooldown`).
    function whitelistVault(address child) external;

    /// @notice Cancel a pending admission (admin only). A deployed child cannot be unwhitelisted
    ///         — its entry was consumed by `createVault`.
    function unwhitelist(address child) external;

    /// @notice Zero a pending AI entry's cooldown so it can be deployed immediately (admin only).
    function releaseNow(address child) external;

    /// @notice Set the AI cooling-off window, bounded to `[MIN_COOLDOWN, MAX_COOLDOWN]`
    ///         (admin only). Applies to admissions AFTER the call; a pending `readyAt` is fixed.
    function setCooldown(uint64 newCooldown) external;

    // ── deploy (ADMIN_ROLE | DEPLOYER_ROLE) ─────────────────────────────────

    /// @notice Deploy a `BeaconProxy` wrapper + per-wrapper `CapRegistry` for an admitted child
    ///         whose cooldown has elapsed, exactly once (on-chain `wrapperOf` guard). The whitelist
    ///         entry is consumed. Fee ≤ cap, bounded caps, and on-chain child validation apply.
    function createVault(CreateVaultParams calldata params) external returns (address proxy);

    /// @notice The deterministic wrapper address for the same inputs, without deploying.
    function predictVaultAddress(CreateVaultParams calldata params)
        external
        view
        returns (address proxy);

    // ── views ────────────────────────────────────────────────────────────────

    function beacon() external view returns (address);
    function guardian() external view returns (address);
    function feeRecipient() external view returns (address);
    function timelock() external view returns (address);
    function deployLimit() external view returns (uint32);
    function cooldown() external view returns (uint64);
    function MIN_COOLDOWN() external view returns (uint64);
    function DEFAULT_COOLDOWN() external view returns (uint64);
    function MAX_COOLDOWN() external view returns (uint64);

    /// @notice The pending admission for `child` (`by == address(0)` when none).
    function whitelistOf(address child) external view returns (address by, uint64 readyAt);

    /// @notice True while an admission is pending (admin or not yet elapsed AI).
    function isWhitelisted(address child) external view returns (bool);

    /// @notice True when `child` is admitted and its cooldown has elapsed (or is zero).
    function isReady(address child) external view returns (bool);

    /// @notice The wrapper deployed for `child`, or `address(0)`. At most one, ever.
    function wrapperOf(address child) external view returns (address);

    // ── events ───────────────────────────────────────────────────────────────

    event VaultCreated(
        address indexed child,
        address indexed proxy,
        address capRegistry,
        address indexed deployer,
        uint16 feeBps,
        string label
    );
    event VaultWhitelisted(address indexed child, address indexed by, uint64 readyAt);
    event VaultReleased(address indexed child, address indexed by);
    event VaultUnwhitelisted(address indexed child, address indexed by);
    event CooldownUpdated(uint64 oldCooldown, uint64 newCooldown, address indexed by);
    event BeaconUpdated(address oldBeacon, address newBeacon);
    event GuardianUpdated(address oldGuardian, address newGuardian);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event DeployLimitUpdated(uint32 oldLimit, uint32 newLimit);
}
