// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPool (Aave v3)
/// @notice Minimal Aave v3 Pool surface consumed by SparkPointVault + the AaveV3Adapter.
///         Canonical Aave v3 signatures (aave-v3-core IPool) — the ONLY entrypoints the vault/adapter
///         call: `supply` (USDC in → aUSDC) and `withdraw` (aUSDC → USDC, the N2 escape-hatch unwind).
/// @dev See smart-contracts.md §6/§7: `IPool.supply(asset, amount, onBehalfOf, referralCode=0)` and
///      `IPool.withdraw(asset, amount, to)` (returns the amount actually delivered).
///      Base mainnet (8453) Pool 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
///      Base Sepolia (84532) Pool 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27.
interface IPool {
    /// @notice Supplies `amount` of `asset` into the reserve, minting aTokens to `onBehalfOf`.
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    /// @notice Withdraws `amount` of underlying `asset`, burning the equivalent aTokens, to `to`.
    /// @return The final amount withdrawn.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}
