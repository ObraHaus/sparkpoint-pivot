// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IAToken (Aave v3)
/// @notice Minimal Aave v3 aToken surface. The vault reads `balanceOf` (from IERC20) to compute
///         totalAssets()/availableLiquidity() (smart-contracts.md §6). aUSDC is a rebasing balance
///         that reflects Aave interest automatically.
/// @dev Base mainnet aUSDC / Base Sepolia aUSDC 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC.
interface IAToken is IERC20 {
    /// @notice The address of the underlying asset (USDC) backing this aToken.
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);

    /// @notice The scaled (non-rebasing) balance of `user`.
    function scaledBalanceOf(address user) external view returns (uint256);

    /// @notice The Aave Pool that mints/burns this aToken.
    function POOL() external view returns (address);
}
