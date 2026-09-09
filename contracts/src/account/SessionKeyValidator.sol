// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { ISessionKeyValidator } from "../interfaces/ISessionKeyValidator.sol";
import { ISparkPointAccount } from "../interfaces/ISparkPointAccount.sol";
import { IPolicyModule } from "../interfaces/IPolicyModule.sol";
import { SessionScopeLib } from "./SessionScopeLib.sol";

/// @title SessionKeyValidator — VIEW-ONLY parity mirror of the account's session validation (§4; N4).
/// @notice After the Path-A (feature 022 §R1) refactor the AUTHORITATIVE session validation runs INSIDE
///         `SparkPointAccount.validateUserOp` over the account's OWN storage (via the inlined
///         `SessionScopeLib`). This contract reproduces that exact accept/reject verdict as a pure VIEW
///         by reading the account's (== `op.sender`'s) live session policy + allowlist snapshot. It is
///         used by the off-chain policy layer, the Trust Center, and tests — it holds NO state, writes
///         NO spend, and is NEVER the on-chain write path, so it cannot violate the ERC-7562 rules.
/// @dev The `policyModule` reference is retained purely as an informational pointer for tooling/Trust
///      Center (it is not consulted here — the account's own storage is the source of truth).
contract SessionKeyValidator is ISessionKeyValidator {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /// @notice Signature prefix byte marking a session-key (vs owner) UserOp signature.
    bytes1 public constant SESSION_PREFIX = 0x01;

    /// @notice Informational pointer to the global arming allowlist (not consulted during validation).
    address public immutable policyModule;

    constructor(address policyModule_) {
        policyModule = policyModule_;
    }

    /// @inheritdoc ISessionKeyValidator
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        view
        returns (uint256 validationData)
    {
        address account = userOp.sender;
        address signer = SessionScopeLib.recoverSessionSigner(userOp.signature, userOpHash);
        if (signer == address(0)) return SIG_VALIDATION_FAILED;

        IPolicyModule.Policy memory p = ISparkPointAccount(payable(account)).sessionPolicyOf(signer);
        SessionScopeLib.Scope memory scope =
            SessionScopeLib.inspect(p, userOp, userOpHash, block.timestamp);
        if (!scope.preAllowlistOk) return scope.validationData;

        if (ISparkPointAccount(payable(account)).isSessionAllowed(signer, scope.target, scope.innerSelector)) {
            return scope.validationData;
        }
        return SIG_VALIDATION_FAILED;
    }

    /// @inheritdoc ISessionKeyValidator
    function isActive(address account, address sessionKey) external view returns (bool) {
        IPolicyModule.Policy memory p = ISparkPointAccount(payable(account)).sessionPolicyOf(sessionKey);
        return p.sessionKey == sessionKey && !p.revoked && block.timestamp >= p.validAfter
            && block.timestamp <= p.validUntil;
    }
}
