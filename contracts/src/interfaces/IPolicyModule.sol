// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PolicyModule
/// @notice The on-chain authority both manual (SparkPointAccount) and automated (SessionKeyValidator)
///         execution consult. Deterministic scope: protocol+selector allowlist, per-tx & cumulative
///         caps, max-slippage floor, hard expiry.
/// @dev N4 + G2 + G5. State is stored in the ACCOUNT'S ASSOCIATED STORAGE (keyed by account) so
///      validateUserOp stays within EntryPoint storage-access rules and is bundler-acceptable.
/// @dev Transcribed verbatim from specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §5.
interface IPolicyModule {
    /// @param sessionKey      pubkey the agent signs rebalances with (no standing authority)
    /// @param validAfter      activation timestamp
    /// @param validUntil      HARD expiry (N4)
    /// @param perTxCap        max notional per UserOp (USDC 6dp)
    /// @param cumulativeCap   lifetime ceiling for this key
    /// @param spent           running total (monotonic ↑; never resets)
    /// @param maxSlippageBps  floor on amountOutMin for swaps
    /// @param revoked         set true by revokeSessionKey
    struct Policy {
        address sessionKey;
        uint48 validAfter;
        uint48 validUntil;
        uint128 perTxCap;
        uint128 cumulativeCap;
        uint128 spent;
        uint16 maxSlippageBps;
        bool revoked;
        // allowlist: target => selector => allowed  (seeded at authorization, see SparkPointAccount)
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event PolicySeeded(address indexed account, address indexed sessionKey, uint48 validUntil);
    event PolicyRevoked(address indexed account, address indexed sessionKey);
    event Spent(
        address indexed account, address indexed sessionKey, uint256 notional, uint256 newSpent
    );

    /// @notice Is (target, selector) a whitelisted protocol entrypoint? Address+selector level (G5),
    ///         NOT name level — only specific Aave v3 Pool / Aerodrome Router / vault selectors pass.
    function isAllowedTarget(address target, bytes4 selector) external view returns (bool);

    /// @notice Stateless scope check used by SessionKeyValidator. Pure-ish view over account storage.
    /// @return ok      true iff allowlisted target+selector, value ≤ perTxCap, spent+value ≤ cumulativeCap,
    ///                 within [validAfter, validUntil], not revoked, slippage floor honored, recipient==account.
    /// @return reason  bytes32 reason code when !ok (surfaced off-chain).
    function checkAction(address account, Call calldata call, uint256 valueUSD)
        external
        view
        returns (bool ok, bytes32 reason);

    /// @notice Read a session policy (for SessionKeyValidator + Trust Center provability).
    function policyOf(address account, address sessionKey) external view returns (Policy memory);
}
