// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAerodromeRouter (Aerodrome / Velodrome-V2-style)
/// @notice Minimal Aerodrome Router surface for the session-key swap path. `amountOutMin` is the
///         on-chain slippage floor (enforced by the AMM and re-checked by PolicyModule for session
///         keys); `to` is FORCED to the account (N1). See smart-contracts.md §7.
/// @dev Base mainnet (8453) Router 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43.
///      NO Base-Sepolia (84532) deployment exists — swaps are fork-only there.
interface IAerodromeRouter {
    /// @notice A single hop in a swap route.
    /// @param from    input token of this hop
    /// @param to      output token of this hop
    /// @param stable  whether to use the stable or volatile pool
    /// @param factory the pool factory that created the pair
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    /// @notice Swaps an exact `amountIn` for at least `amountOutMin`, along `routes`, delivering to `to`
    ///         before `deadline`. Reverts if the output falls below `amountOutMin` (the slippage floor).
    /// @return amounts The input/output amounts of each hop in the route.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
