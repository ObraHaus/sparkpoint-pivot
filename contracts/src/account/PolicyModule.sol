// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IPolicyModule } from "../interfaces/IPolicyModule.sol";
import { SessionScopeLib } from "./SessionScopeLib.sol";

/// @title PolicyModule — the GLOBAL protocol arming allowlist (smart-contracts.md §5; N4, G5).
/// @notice After the Path-A (feature 022 §R1) refactor this is a STATELESS registry: it holds ONLY the
///         global `(target, selector)` allowlist an owner may draw a session scope from, plus the
///         by-construction forbidden-selector guard. It holds NO per-session state, NO assets, and
///         exposes NO transfer selector. Per-session policy (caps, expiry, monotonic `spent`, and the
///         session's chosen allowlist subset) now lives in each user's SparkPointAccount OWN storage, so
///         `validateUserOp` reads/writes only account-own storage and is bundler-compliant (the
///         recordSpend-in-validation external-storage write that blocked US6 is GONE).
/// @dev `isAllowedTarget` is read by `SparkPointAccount.authorizeSessionKey` at GRANT time (an ordinary
///      owner transaction, NOT a bundler-validated UserOp) to enforce the §6 "allowlist ⊆ global" rule.
///      It is NEVER read during `validateUserOp`. approve / transfer / transferFrom / the empty selector
///      are NEVER allowlisted (enforced here via `SessionScopeLib.isForbiddenSelector`, a defense beyond
///      the arming script only ever seeding the protocol pairs).
contract PolicyModule is IPolicyModule {
    /// @notice The sole admin (arming authority). Seeds the global `(target,selector)` allowlist.
    address public admin;

    // GLOBAL protocol allowlist (target => selector => allowed). Seeded via `setAllowedTarget`; NEVER
    // contains a forbidden selector (guarded in `_isAllowedTarget`).
    mapping(address => mapping(bytes4 => bool)) internal _allowed;

    error OnlyAdmin();

    event AllowedTargetSet(address indexed target, bytes4 indexed selector, bool allowed);

    constructor(address admin_) {
        admin = admin_;
    }

    /// @notice Arm (or disarm) a global `(target, selector)` pair. Admin-only. Forbidden selectors are
    ///         still rejected by `isAllowedTarget` even if erroneously armed here.
    function setAllowedTarget(address target, bytes4 selector, bool allowed) external {
        if (msg.sender != admin) revert OnlyAdmin();
        _allowed[target][selector] = allowed;
        emit AllowedTargetSet(target, selector, allowed);
    }

    /// @inheritdoc IPolicyModule
    function isAllowedTarget(address target, bytes4 selector) external view returns (bool) {
        return _isAllowedTarget(target, selector);
    }

    /// @dev Address+selector-level allowlist (G5). approve/transfer/transferFrom/empty are rejected BY
    ///      CONSTRUCTION regardless of what the arming map holds — a session key can never self-grant
    ///      spend power or reach unknown code.
    function _isAllowedTarget(address target, bytes4 selector) internal view returns (bool) {
        if (SessionScopeLib.isForbiddenSelector(selector)) return false;
        return _allowed[target][selector];
    }
}
