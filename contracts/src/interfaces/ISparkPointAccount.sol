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
    /// @notice Emitted each time a session UserOp validates and the monotonic spend ledger advances.
    ///         The ledger lives in this account's OWN storage (Path-A, feature 022 §R1), so the write
    ///         happens inside `validateUserOp` without touching any external contract's storage.
    event SessionKeySpent(address indexed sessionKey, uint256 notional, uint256 newSpent);
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
    ///         UserOps (1-byte signature prefix) run the §4 scope flow inline over this account's OWN
    ///         session storage (Path-A, feature 022 §R1) via the pure SessionScopeLib.
    /// @dev MUST obey EntryPoint/ERC-7562 storage-access rules: validation reads/writes ONLY this
    ///      account's own storage (the session policy, allowlist snapshot, and monotonic spend ledger
    ///      all live here) — no external contract storage is touched. Returns packed validationData
    ///      (authorizer | validUntil | validAfter).
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

    /// @notice Authorize an opt-in session key with an on-chain Policy + its (target,selector) allowlist
    ///         subset. Owner-only (N4). The scope + the allowlist snapshot are written to THIS account's
    ///         OWN storage; `spent` is preserved across a re-authorization of the same key (never reset).
    /// @dev Each `(targets[i], selectors[i])` MUST be a member of the PolicyModule global arming
    ///      allowlist (`isAllowedTarget`), which enforces the §6 "allowlist ⊆ global" rule AND rejects
    ///      approve/transfer/transferFrom/arbitrary-call BY CONSTRUCTION — so a session key can neither
    ///      widen its scope nor grant itself spend power. `validUntil` must be non-zero and within
    ///      MAX_SESSION_DURATION (no infinite session, N4).
    /// @param policy    the scope (sessionKey, window, caps, slippage); `spent` on input is ignored.
    /// @param targets   the session's chosen call targets (parallel to `selectors`).
    /// @param selectors the session's chosen selectors (parallel to `targets`).
    function authorizeSessionKey(
        IPolicyModule.Policy calldata policy,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external;

    /// @notice Revoke a session key. Owner-only, INSTANT, UNILATERAL — no SparkPoint cooperation,
    ///         no timelock. The next UserOp under this key fails validateUserOp because validation
    ///         reads live storage (N4, FR-031, SC-008). NEVER pausable — a sacred exit (N2).
    function revokeSessionKey(address sessionKey) external;

    /// @notice The account's active session key (last authorized, non-superseded). address(0) if none.
    function activeSessionKey() external view returns (address);

    /// @notice Read a session policy from this account's own storage (for the validator mirror, the
    ///         off-chain policy layer, and Trust Center provability). `sessionKey`==address(0) means none.
    function sessionPolicyOf(address sessionKey)
        external
        view
        returns (IPolicyModule.Policy memory);

    /// @notice Whether `(target, selector)` is in `sessionKey`'s authorized allowlist snapshot. Forbidden
    ///         selectors (approve/transfer/transferFrom/empty) always return false (defense in depth).
    function isSessionAllowed(address sessionKey, address target, bytes4 selector)
        external
        view
        returns (bool);

    /// @notice Stateless scope check over the account's ACTIVE session policy (single-agent-key model) —
    ///         mirrors the §4 validation flow for the off-chain policy layer + Trust Center. Reads only
    ///         this account's own storage. Never records spend.
    /// @return ok     true iff allowlisted target+selector, value ≤ perTxCap, spent+value ≤ cumulativeCap,
    ///                within [validAfter,validUntil], not revoked, slippage floor honored, recipient==account.
    /// @return reason bytes32 reason code when !ok (surfaced off-chain).
    function checkAction(IPolicyModule.Call calldata call, uint256 valueUSD)
        external
        view
        returns (bool ok, bytes32 reason);

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
