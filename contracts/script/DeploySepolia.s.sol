// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

import { SparkPointVault } from "../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../src/governance/CapRegistry.sol";
import { KillSwitch } from "../src/governance/KillSwitch.sol";
import { AaveV3Adapter } from "../src/adapters/AaveV3Adapter.sol";
import { IPool } from "../src/interfaces/external/IPool.sol";

/// @title DeploySepolia — Base Sepolia (84532) testnet deploy of the US1 vault core, guarded by an
///        OpenZeppelin TimelockController (Gate-B decision: an OZ-standard multi-party guardian).
/// @notice Deploys, in one broadcast: a TimelockController (the guardian + governance authority), then
///         CapRegistry + KillSwitch + AaveV3Adapter + SparkPointVault wired to the Base Sepolia Aave v3
///         market. The Timelock is the vault's `guardian` (deposit-pause + hard-capped ≤20% fee rate)
///         and the CapRegistry `governance`; because the kill-switch is DEPOSIT-ONLY (withdrawals are
///         never gated, N2), a timelock delay on the guardian is safe AND makes the fee-rate change
///         genuinely timelocked (resolves the W5-US1 N5 fee-timelock note).
/// @dev The deployer is the Timelock's sole proposer/executor/admin for the testnet MVP (production
///      stacks a Safe M-of-N in front + renounces admin). Env: TIMELOCK_MIN_DELAY (default 60s testnet;
///      production ~172800). Custody addresses (USDC/AAVE_POOL/AUSDC) MUST be set for Base Sepolia.
///      NO key here is a fund path (N1/N5) — this only wires immutables. Split into helpers to keep
///      the default (non-via-IR) profile — so the vault bytecode deployed is the exact 76-test build.
contract DeploySepolia is Script {
    // Cap params (USDC 6dp), T098 parity with packages/shared/src/policy/constants.ts.
    uint256 internal constant PER_USER_CAP = 5_000e6;
    uint256 internal constant TOTAL_CAP = 1_000_000e6;
    uint256 internal constant VAULT_CAP = 1_000_000e6;
    uint16 internal constant DEFAULT_PERFORMANCE_FEE_BPS = 1000; // 10%

    function run() external {
        address deployer = msg.sender;
        vm.startBroadcast();
        address timelock = _deployGuardian(deployer);
        _deployCore(deployer, timelock);
        vm.stopBroadcast();
    }

    /// @dev OZ TimelockController: deployer is the sole proposer/executor/admin for the testnet MVP.
    function _deployGuardian(address deployer) internal returns (address) {
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(60));
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, deployer);
        console2.log("TimelockController", address(timelock));
        console2.log("  minDelay        ", minDelay);
        return address(timelock);
    }

    /// @dev Core: guardian + governance = the Timelock; feeRecipient = deployer (non-privileged holder).
    function _deployCore(address deployer, address timelock) internal {
        CapRegistry capRegistry = new CapRegistry(timelock, PER_USER_CAP, TOTAL_CAP, VAULT_CAP);
        KillSwitch killSwitch = new KillSwitch(timelock);
        AaveV3Adapter adapter = new AaveV3Adapter(IPool(vm.envAddress("AAVE_POOL")));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        SparkPointVault vault = new SparkPointVault(
            IERC20(vm.envAddress("USDC")),
            IPool(vm.envAddress("AAVE_POOL")),
            IERC20(vm.envAddress("AUSDC")),
            timelock,
            address(capRegistry),
            feeRecipient,
            uint16(vm.envOr("PERF_FEE_BPS", uint256(DEFAULT_PERFORMANCE_FEE_BPS)))
        );
        console2.log("SparkPointVault   ", address(vault));
        console2.log("CapRegistry       ", address(capRegistry));
        console2.log("KillSwitch        ", address(killSwitch));
        console2.log("AaveV3Adapter     ", address(adapter));
        console2.log("guardian(timelock)", timelock);
        console2.log("feeRecipient      ", feeRecipient);
        _writeAddresses(address(vault), address(capRegistry), address(killSwitch), address(adapter), timelock, feeRecipient);
    }

    function _writeAddresses(
        address vault,
        address capRegistry,
        address killSwitch,
        address aaveAdapter,
        address timelock,
        address feeRecipient
    ) internal {
        string memory dir = string.concat("deployments/", vm.toString(block.chainid));
        vm.createDir(dir, true);

        string memory key = "sparkpoint-core";
        vm.serializeAddress(key, "SparkPointVault", vault);
        vm.serializeAddress(key, "CapRegistry", capRegistry);
        vm.serializeAddress(key, "KillSwitch", killSwitch);
        vm.serializeAddress(key, "AaveV3Adapter", aaveAdapter);
        vm.serializeAddress(key, "TimelockController", timelock);
        vm.serializeAddress(key, "guardian", timelock);
        vm.serializeAddress(key, "governance", timelock);
        string memory json = vm.serializeAddress(key, "feeRecipient", feeRecipient);

        string memory path = string.concat(dir, "/addresses.json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
