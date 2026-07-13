// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWrappedTokenGatewayV3 (Aave v3)
/// @notice Minimal Aave v3 WETH gateway surface for the ETH → Aave path (routed inside an adapter
///         call). USDC is the must-have deposit asset; the ETH path is gated behind a flag until the
///         gateway address is confirmed at build (smart-contracts.md §7).
/// @dev Canonical Aave v3 WrappedTokenGatewayV3 signatures.
interface IWrappedTokenGatewayV3 {
    /// @notice Wraps the sent ETH to WETH and supplies it to the Aave `pool` on behalf of `onBehalfOf`.
    function depositETH(address pool, address onBehalfOf, uint16 referralCode) external payable;

    /// @notice Withdraws `amount` of WETH from the Aave `pool`, unwraps to ETH, and sends to `to`.
    function withdrawETH(address pool, uint256 amount, address to) external;
}
