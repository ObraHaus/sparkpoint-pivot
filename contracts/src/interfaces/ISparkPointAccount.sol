// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { IPolicyModule } from "./IPolicyModule.sol";

/// @title SparkPointAccount
/// @notice The user's ERC-4337 smart account. Holds funds, validates UserOps, executes calls.
/// @dev Sole admin authority is the user's owner EOA (N3). The ONLY ways funds leave are:
///      (a) owner direct call, (b) an owner-signed UserOp, (c) a session-key UserOp validated
///      in-scope by SessionKeyValidator/PolicyModule. There is NO admin/sweep/rescue path that
///      can name a SparkPoint or arbitrary external recipient (N1). Upgrade is UUPS but
///      gated to owner() ONLY — SparkPoint can never upgrade a user's account.
/// @dev Transcribed verbatim from specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §2.
interface ISparkPointAccount {
    /// @notice Emitted once at init; binds the sole owner. No SparkPoint address may appear here (N3).
    event SparkPointAccountInitialized(address indexed entryPoint, address indexed owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SessionKeyAuthorized(address indexed sessionKey, uint48 validUntil);
    event SessionKeyRevoked(address indexed sessionKey);
    /// @notice Provable intent tag for off-chain PnL attribution (Data layer). Emitted on execute.
    event IntentLog(
        bytes32 indexed intentId, address indexed target, bytes4 indexed selector, uint256 value
    );
    event Executed(address indexed target, uint256 value, bytes4 selector);

    /// @notice The canonical EntryPoint (v0.7) this account trusts. Immutable; wrong pin caught in tests.
    function entryPoint() external view returns (address);

    /// @notice The sole owner/admin signer (the user's EOA). Public for Trust Center (N3/N5 provability).
    function owner() external view returns (address);

    /// @notice ERC-4337 validation. Owner-signed UserOps validate ECDSA against owner(); session-key
    ///         UserOps (1-byte signature prefix) delegate to SessionKeyValidator.
    /// @dev MUST obey EntryPoint storage-access rules: only this account's own/associated storage is
    ///      read in validation (PolicyModule state is account-associated, §5/§6). Returns packed
    ///      validationData (authorizer | validUntil | validAfter).
    /// @return validationData 0 = owner OK; SIG_VALIDATION_FAILED on bad sig; packed expiry for session keys.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);

    /// @notice Execute a single call. INVARIANT N1: gated by _requireFromEntryPointOrOwner(); for
    ///         session-key-originated UserOps the call has already passed PolicyModule scope. `target`
    ///         is unconstrained ONLY for the owner; session keys can reach allowlisted targets only.
    function execute(address target, uint256 value, bytes calldata data) external;

    /// @notice Execute a batch (e.g. approve + deposit). Same N1 gating as execute().
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external;

    /// @notice Authorize an opt-in session key with an on-chain Policy. Owner-only (N4).
    /// @dev Seeds PolicyModule with EXACTLY {vault deposit/withdraw, Aave supply/withdraw,
    ///      Aerodrome swap}. ERC-20 approve and arbitrary call are NOT seeded, so a session key
    ///      cannot grant itself spend power or reach an unknown contract.
    function authorizeSessionKey(IPolicyModule.Policy calldata policy) external;

    /// @notice Revoke a session key. Owner-only, INSTANT, UNILATERAL — no SparkPoint cooperation,
    ///         no timelock. The next UserOp under this key fails validateUserOp because validation
    ///         reads live storage (N4, FR-031, SC-008). NEVER pausable.
    function revokeSessionKey(address sessionKey) external;

    /// @notice Owner-only ownership transfer (N3). The only way owner() changes.
    function transferOwnership(address newOwner) external;

    /// @notice UUPS upgrade — OWNER ONLY (N3). SparkPoint has no authority here. A user may adopt the
    ///         ZeroDev/Kernel fallback or patch a bug; we cannot upgrade their account.
    /// @dev Account upgradeability is a user-controlled convenience and is orthogonal to the vault,
    ///      which is hard non-upgradeable (N5). Safe default if deemed risky: ship non-upgradeable.
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;

    /// @notice Accept ETH (for the Aave-ETH path via WETH gateway inside an adapter call).
    receive() external payable;
}
