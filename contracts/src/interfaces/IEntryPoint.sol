// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Re-export the canonical ERC-4337 EntryPoint v0.7 interfaces from the vendored
// account-abstraction lib so downstream contracts, the test harness, and the ABI
// export can import them from a stable in-repo path (contracts/src/interfaces/).
// The on-chain EntryPoint is the v0.7 singleton
// 0x0000000071727De22E5E9d8BAf0edAc6f37da032 (identical on Base mainnet + Base Sepolia),
// pinned as an immutable in SparkPointAccount (smart-contracts.md §7).
import {IEntryPoint} from "@account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/interfaces/PackedUserOperation.sol";
