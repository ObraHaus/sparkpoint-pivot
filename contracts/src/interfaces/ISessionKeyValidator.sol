// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

/// @title ISessionKeyValidator
/// @notice After the Path-A (feature 022) refactor the AUTHORITATIVE session-key validation lives
///         inside SparkPointAccount (`validateUserOp` runs the §4 scope flow over the account's OWN
///         storage using the inlined `SessionScopeLib` — no external call, no external storage). This
///         contract is a STATELESS, VIEW-ONLY PARITY MIRROR of that flow: it reads the account's live
///         session policy + allowlist (the sender's own storage) and reports the same accept/reject
///         verdict, for off-chain checks, the Trust Center, and tests. It records NO spend and holds NO
///         state — it can never be the write path.
/// @dev N4: a session key has ZERO standing authority. Every check is deterministic on-chain code; a
///      compromised agent holding the session private key can only churn within scope and can NEVER name
///      an external/SparkPoint recipient or exceed caps/slippage/expiry. Transcribed from
///      specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §4 (storage location per §022 R1).
interface ISessionKeyValidator {
    /// @notice Report whether a session-key UserOp would validate against the account's live scope. Pure
    ///         mirror of SparkPointAccount's own validation (reads `op.sender`'s session policy +
    ///         allowlist snapshot). VIEW: records no spend.
    /// @dev Flow: (1) recover signer; require the registered, non-revoked sessionKey on the account.
    ///   (2) block.timestamp ∈ [validAfter, validUntil] else pack expiry → EntryPoint rejects.
    ///   (3) callData is a single execute(target,value,inner); (target,innerSelector) in the account's
    ///       session allowlist snapshot. (4) notional ≤ perTxCap AND spent + notional ≤ cumulativeCap.
    ///   (5) swaps: amountOutMin ≥ floor(maxSlippageBps). (6) recipient/`to` == account (N1).
    /// @return validationData packed (validUntil/validAfter); SIG_VALIDATION_FAILED on bad/revoked/out-of-scope.
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        view
        returns (uint256 validationData);

    /// @notice Whether `sessionKey` is currently usable on `account` (live storage read of the account).
    function isActive(address account, address sessionKey) external view returns (bool);
}
