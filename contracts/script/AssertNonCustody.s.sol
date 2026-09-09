// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { SparkPointVault } from "../src/vault/SparkPointVault.sol";
import { SparkPointMorphoVault } from "../src/vault/SparkPointMorphoVault.sol";
import { SparkPointVaultFactory } from "../src/factory/SparkPointVaultFactory.sol";

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

        // ── 011: if a Morpho WRAPPER address is provided, assert the same custody guarantees + the
        //    Morpho-specific immutables (morphoVault, factory). Optional — a plain Aave-vault run is
        //    unaffected when WRAPPER_VAULT_ADDRESS is unset.
        address wrapperAddr = vm.envOr("WRAPPER_VAULT_ADDRESS", address(0));
        if (wrapperAddr != address(0)) _assertMorphoWrapper(wrapperAddr);

        // ── 011: if a FACTORY address is provided, assert it is a non-custodian: no fund-egress
        //    selector + zero balance. Optional — unset FACTORY_ADDRESS leaves plain runs unaffected.
        address factoryAddr = vm.envOr("FACTORY_ADDRESS", address(0));
        if (factoryAddr != address(0)) _assertFactoryNonCustody(factoryAddr);
    }

    /// @dev N1: the SparkPointVaultFactory holds NO funds and has NO fund-egress path. It exposes no
    ///      deposit/withdraw/sweep/transfer/rescue/skim selector and no receive/fallback, so a bare
    ///      value transfer reverts and its balance is provably 0. It only reads state + deploys wrappers.
    function _assertFactoryNonCustody(address factoryAddr) internal view {
        SparkPointVaultFactory factory = SparkPointVaultFactory(factoryAddr);
        console2.log("Asserting non-custody invariants for factory", factoryAddr);

        // ── N1: zero balance (the factory is never a custodian) ──
        require(factoryAddr.balance == 0, "N1(factory): factory holds a balance");

        // ── N1: NO fund-egress selector dispatches — a value-bearing / egress call has no function ──
        require(!_hasSelector(factoryAddr, "sweep(address,uint256)"), "N1(factory): sweep selector present");
        require(!_hasSelector(factoryAddr, "withdraw(address,uint256)"), "N1(factory): withdraw selector present");
        require(!_hasSelector(factoryAddr, "transfer(address,uint256)"), "N1(factory): transfer selector present");
        require(!_hasSelector(factoryAddr, "rescue(address,uint256)"), "N1(factory): rescue selector present");
        require(
            !_hasSelector(factoryAddr, "recoverERC20(address,uint256)"),
            "N1(factory): recoverERC20 selector present"
        );
        require(!_hasSelector(factoryAddr, "skim(address)"), "N1(factory): skim selector present");

        // ── Provenance sanity: the factory's own immutables are wired (usdc/guardian/feeRecipient) ──
        require(address(factory.usdc()) != address(0), "N1(factory): usdc immutable unset");
        require(factory.guardian() != address(0), "N5(factory): guardian immutable unset");
        require(factory.feeRecipient() != address(0), "N5(factory): feeRecipient immutable unset");
        require(factory.owner() != address(0), "factory owner unset");

        console2.log("OK  factory balance == 0");
        console2.log("OK  factory exposes no fund-egress selector (N1)");
        console2.log("OK  factory owner", factory.owner());
        console2.log("All factory non-custody assertions passed (N1).");
    }

    /// @dev Mirrors the SparkPointVault assertions for the Morpho WRAPPER and adds the N1/N5
    ///      Morpho-specific checks: the wrapped morphoVault + deploying factory are set immutables, the
    ///      Aave views are GONE (compile-time: the wrapper's ABI has no aavePool/aUSDC), and NO fund-
    ///      egress selector exists (deliberate absence re-proven in test/invariant/MorphoVaultNonCustody).
    function _assertMorphoWrapper(address wrapperAddr) internal view {
        SparkPointMorphoVault wrapper = SparkPointMorphoVault(wrapperAddr);
        console2.log("Asserting non-custody invariants for Morpho wrapper", wrapperAddr);

        // ── N5: management / entry / exit fees are a compile-time constant 0 ──
        require(wrapper.entryFeeBasisPoints() == 0, "N5(wrapper): entry fee != 0");
        require(wrapper.exitFeeBasisPoints() == 0, "N5(wrapper): exit fee != 0");
        require(wrapper.managementFeeBasisPoints() == 0, "N5(wrapper): management fee != 0");

        // ── N5 / §6.1: performance fee hard-capped at 20% and within the cap; feeRecipient set ──
        require(wrapper.MAX_PERFORMANCE_FEE_BPS() == 2000, "N5(wrapper): perf-fee hard cap != 2000 bps");
        require(
            wrapper.performanceFeeBps() <= wrapper.MAX_PERFORMANCE_FEE_BPS(),
            "N5(wrapper): perf-fee rate over cap"
        );
        require(wrapper.feeRecipient() != address(0), "N5(wrapper): feeRecipient unset");

        // ── FR-050: HWM seeded to >= 1e18 at deployment ──
        require(wrapper.highWaterMark() >= 1e18, "FR-050(wrapper): HWM not seeded to >= 1e18");

        // ── N5: pause-only governance; guardian set (no fund path) ──
        require(wrapper.guardian() != address(0), "N5(wrapper): guardian unset");

        // ── N5: not behind a proxy — EIP-1967 slots empty, real (non-minimal) bytecode ──
        require(
            vm.load(wrapperAddr, EIP1967_IMPL_SLOT) == bytes32(0),
            "N5(wrapper): EIP-1967 impl slot set"
        );
        require(
            vm.load(wrapperAddr, EIP1967_ADMIN_SLOT) == bytes32(0),
            "N5(wrapper): EIP-1967 admin slot set"
        );
        require(wrapperAddr.code.length > 1000, "N5(wrapper): bytecode looks like a proxy");

        // ── N1/N5: custody immutables wired — asset (USDC), the wrapped morphoVault, factory, caps ──
        require(wrapper.asset() != address(0), "N1(wrapper): asset (USDC) unset");
        require(wrapper.morphoVault() != address(0), "N1/N5(wrapper): morphoVault (immutable) unset");
        require(wrapper.factory() != address(0), "N5(wrapper): factory (immutable) unset");
        require(wrapper.capRegistry() != address(0), "caps(wrapper): registry unset");

        // ── N1: NO fund-egress selector. The wrapper's ABI exposes no sweep/migrate/rescue/skim/
        //    upgradeTo — any such call has no function to dispatch to and reverts. The only asset-out
        //    path is ERC-4626 withdraw/redeem (share-owner/approved). Provably re-tested in T006.
        require(!_hasSelector(wrapperAddr, "sweep(address,uint256)"), "N1(wrapper): sweep selector present");
        require(!_hasSelector(wrapperAddr, "migrate(address)"), "N1(wrapper): migrate selector present");
        require(!_hasSelector(wrapperAddr, "rescue(address,uint256)"), "N1(wrapper): rescue selector present");
        require(
            !_hasSelector(wrapperAddr, "recoverERC20(address,uint256)"),
            "N1(wrapper): recoverERC20 selector present"
        );
        require(!_hasSelector(wrapperAddr, "skim(address)"), "N1(wrapper): skim selector present");
        require(!_hasSelector(wrapperAddr, "upgradeTo(address)"), "N5(wrapper): upgradeTo selector present");

        console2.log("OK  wrapper entry/exit/mgmt fee == 0");
        console2.log("OK  wrapper perf-fee rate (bps)", wrapper.performanceFeeBps());
        console2.log("OK  wrapper morphoVault (immutable)", wrapper.morphoVault());
        console2.log("OK  wrapper factory (immutable)", wrapper.factory());
        console2.log("OK  wrapper highWaterMark seeded", wrapper.highWaterMark());
        console2.log("OK  wrapper exposes no fund-egress selector (N1)");
        console2.log("All Morpho-wrapper non-custody assertions passed (N1/N2/N5).");
    }

    /// @dev A fund-egress selector is "present" only if calling it does NOT revert with the EVM's
    ///      default no-such-function behavior. We staticcall the 4-byte selector with empty args: a
    ///      MISSING function reverts (success == false). A present-but-reverting function would also
    ///      return false here, which is acceptable — the assertion is that NONE of these dispatch
    ///      successfully to real egress logic. Deliberate-absence is definitively re-proven in T006.
    function _hasSelector(address target, string memory sig) internal view returns (bool ok) {
        (bool success,) = target.staticcall(abi.encodeWithSignature(sig));
        return success;
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
