// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

/// @title SessionKeyValidator
/// @notice Validates UserOps signed by a session key, delegating scope checks to PolicyModule.
/// @dev N4: a session key has ZERO standing authority. Every check is deterministic on-chain code;
///      a compromised agent holding the session private key can only churn within scope and can
///      NEVER name an external/SparkPoint recipient or exceed caps/slippage/expiry.
/// @dev Transcribed verbatim from specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §4.
interface ISessionKeyValidator {
    /// @notice Validate a session-key UserOp against PolicyModule scope.
    /// @dev Flow (deterministic, account-associated storage only — bundler-compliant):
    ///   1. Recover signer; require it is a registered, non-revoked sessionKey.
    ///   2. require(block.timestamp ∈ [validAfter, validUntil]) else pack expiry → EntryPoint rejects.
    ///   3. Decode callData → (target, value, selector, innerData); require policy.allowed[target][selector].
    ///   4. Extract notional; require notional ≤ perTxCap AND spent + notional ≤ cumulativeCap; spent += notional.
    ///   5. Swaps: decode amountOutMin; require amountOutMin ≥ floor(maxSlippageBps); reject if 0/below floor.
    ///   6. Force recipient/`to` == account (NEVER external/SparkPoint) — else revert (N1).
    /// @return validationData packed (validUntil/validAfter); SIG_VALIDATION_FAILED on bad/revoked key.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        returns (uint256 validationData);

    /// @notice Whether `sessionKey` is currently usable on `account` (live storage read).
    function isActive(address account, address sessionKey) external view returns (bool);
}
