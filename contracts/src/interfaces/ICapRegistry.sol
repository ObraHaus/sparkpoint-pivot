// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICapRegistry
/// @notice Minimal read surface the SparkPointVault consults to compute `maxDeposit`
///         (`min(perUserRemaining, totalRemaining, vaultRemaining)`; smart-contracts.md §6, G2).
/// @dev The three caps are multisig-settable ONLY within hard-coded immutable ceilings, so even a
///      compromised multisig can never open caps to infinity (§6 "CapRegistry params ... within
///      hard-coded max ceilings"). Caps are INFLOW-only — they NEVER gate withdraw/redeem (N2).
///      Cap values mirror packages/shared/src/policy/constants.ts (T098 on-chain == shared parity).
interface ICapRegistry {
    /// @notice Per-user vault TVL cap (USDC 6dp). Default 5_000e6; ceiling 10_000e6.
    function perUserCap() external view returns (uint256);
    /// @notice Aggregate protocol cap (USDC 6dp). Default 1_000_000e6; ceiling 5_000_000e6.
    function totalCap() external view returns (uint256);
    /// @notice Vault deposit cap (USDC 6dp). Default 1_000_000e6; ceiling 5_000_000e6.
    function vaultCap() external view returns (uint256);
}
