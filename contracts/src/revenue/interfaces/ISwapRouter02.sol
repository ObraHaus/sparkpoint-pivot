// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ISwapRouter02
/// @notice The slice of Uniswap V3's `SwapRouter02` (Robinhood Chain 4663:
/// `0xCaf681a66D020601342297493863E78C959E5cb2`) the `FeeRouter` depends on.
/// @dev ⚠️ The `02` router's `exactInputSingle` takes **no deadline** — the deadline is enforced by
/// the caller. The `FeeRouter` therefore checks `block.timestamp <= deadline` itself before the
/// call; without that, a swap could sit in the mempool and execute at a stale price.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swap an exact input amount for as much output as possible, single hop.
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
