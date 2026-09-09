// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPolicyModule
/// @notice After the Path-A (feature 022) refactor, PolicyModule is a STATELESS on-chain authority: it
///         holds only the GLOBAL protocol arming allowlist (`(target,selector)` pairs an owner may draw
///         a session scope from) plus the by-construction forbidden-selector guard. It holds NO
///         per-session state and NO assets, and exposes NO transfer selector. The per-session policy
///         (caps, expiry, spent, and the session's chosen allowlist subset) now lives in the user's
///         SparkPointAccount OWN storage — so `validateUserOp` reads/writes only account-own storage and
///         stays within the ERC-7562/bundler storage-access rules (the recordSpend-in-validation
///         external-storage write that blocked US6 is gone).
/// @dev The `Policy` struct is the in-memory scope shape a user signs and the account stores; it maps
///      1:1 to policy-schema.md §6 SessionScope.
interface IPolicyModule {
    /// @param sessionKey      pubkey the agent signs rebalances with (no standing authority)
    /// @param validAfter      activation timestamp
    /// @param validUntil      HARD expiry (N4)
    /// @param perTxCap        max notional per UserOp (USDC 6dp)
    /// @param cumulativeCap   lifetime ceiling for this key
    /// @param spent           running total (monotonic ↑; never resets)
    /// @param maxSlippageBps  floor on amountOutMin for swaps
    /// @param revoked         set true by SparkPointAccount.revokeSessionKey
    struct Policy {
        address sessionKey;
        uint48 validAfter;
        uint48 validUntil;
        uint128 perTxCap;
        uint128 cumulativeCap;
        uint128 spent;
        uint16 maxSlippageBps;
        bool revoked;
        // The session's chosen (target,selector) allowlist subset is snapshotted alongside this struct
        // in the account's OWN storage at authorization (see ISparkPointAccount.authorizeSessionKey).
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Is (target, selector) a whitelisted protocol entrypoint an owner may include in a session
    ///         scope? Address+selector level (G5), NOT name level — only specific Aave v3 Pool /
    ///         Aerodrome Router / vault selectors pass. approve/transfer/transferFrom/empty are rejected
    ///         BY CONSTRUCTION regardless of the arming map. Read at GRANT time by
    ///         SparkPointAccount.authorizeSessionKey to enforce the §6 "allowlist ⊆ global" rule; NEVER
    ///         read during `validateUserOp` (the account checks its own snapshot there).
    function isAllowedTarget(address target, bytes4 selector) external view returns (bool);
}
