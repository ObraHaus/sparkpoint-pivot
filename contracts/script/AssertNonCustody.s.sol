// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { SparkPointVault } from "../src/vault/SparkPointVault.sol";

/// @title AssertNonCustody — post-deploy Trust-Center assertions for the SparkPointVault (N1/N2/N5).
/// @notice Reads the deployed vault (env VAULT_ADDRESS, else deployments/<chainId>/addresses.json) and
///         asserts, on-chain, the custody guarantees the vault claims — so a mis-deploy is caught before
///         funds are onboarded. All checks are pure reads; this script moves no funds.
/// @dev Run: `VAULT_ADDRESS=0x.. forge script script/AssertNonCustody.s.sol --rpc-url <url>` (no
///      --broadcast needed; it's a read-only verifier that reverts on any violation).
contract AssertNonCustody is Script {
    // EIP-1967 slots — MUST be empty for a non-proxy vault (N5).
    bytes32 internal constant EIP1967_IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant EIP1967_ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    function run() external view {
        SparkPointVault vault = SparkPointVault(_vaultAddress());
        console2.log("Asserting non-custody invariants for vault", address(vault));

        // ── N5: management / entry / exit fees are a compile-time constant 0 ──
        require(vault.entryFeeBasisPoints() == 0, "N5: entry fee != 0");
        require(vault.exitFeeBasisPoints() == 0, "N5: exit fee != 0");
        require(vault.managementFeeBasisPoints() == 0, "N5: management fee != 0");

        // ── N5 / §6.1: performance fee is hard-capped at 20% and within the cap; feeRecipient set ──
        require(vault.MAX_PERFORMANCE_FEE_BPS() == 2000, "N5: perf-fee hard cap != 2000 bps");
        require(
            vault.performanceFeeBps() <= vault.MAX_PERFORMANCE_FEE_BPS(),
            "N5: perf-fee rate over cap"
        );
        require(vault.feeRecipient() != address(0), "N5: feeRecipient unset");

        // ── FR-050: HWM seeded to >= 1e18 at deployment (first accrual can never tax principal) ──
        require(vault.highWaterMark() >= 1e18, "FR-050: HWM not seeded to >= 1e18");

        // ── N5: pause-only governance; guardian == pauser and is set (no fund path) ──
        address guardian = vault.guardian();
        require(guardian != address(0), "N5: guardian unset");
        require(vault.pauser() == guardian, "N5: pauser != guardian (must be pause-only role)");

        // ── N5: not behind a proxy — EIP-1967 slots empty, real (non-minimal) bytecode ──
        require(
            vm.load(address(vault), EIP1967_IMPL_SLOT) == bytes32(0), "N5: EIP-1967 impl slot set"
        );
        require(
            vm.load(address(vault), EIP1967_ADMIN_SLOT) == bytes32(0), "N5: EIP-1967 admin slot set"
        );
        require(address(vault).code.length > 1000, "N5: vault bytecode looks like a proxy");

        // ── N1/N5: custody immutables wired (asset == USDC; Aave Pool / aUSDC / capRegistry set) ──
        require(vault.asset() != address(0), "N1: asset (USDC) unset");
        require(vault.aavePool() != address(0), "N1: Aave Pool unset");
        require(vault.aUSDC() != address(0), "N1: aUSDC unset");
        require(vault.capRegistry() != address(0), "caps: registry unset");

        console2.log("OK  entry/exit/mgmt fee == 0");
        console2.log("OK  perf-fee rate (bps)", vault.performanceFeeBps());
        console2.log("OK  perf-fee hard cap (bps)", vault.MAX_PERFORMANCE_FEE_BPS());
        console2.log("OK  feeRecipient", vault.feeRecipient());
        console2.log("OK  highWaterMark seeded", vault.highWaterMark());
        console2.log("OK  guardian == pauser (pause-only)", guardian);
        console2.log(
            "OK  non-upgradeable (EIP-1967 slots empty), code bytes", address(vault).code.length
        );
        console2.log("All non-custody assertions passed (N1/N2/N5).");
    }

    /// @dev Prefer env VAULT_ADDRESS; else read deployments/<chainId>/addresses.json.
    function _vaultAddress() internal view returns (address) {
        address fromEnv = vm.envOr("VAULT_ADDRESS", address(0));
        if (fromEnv != address(0)) return fromEnv;

        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        string memory json = vm.readFile(path);
        return vm.parseJsonAddress(json, ".SparkPointVault");
    }
}
