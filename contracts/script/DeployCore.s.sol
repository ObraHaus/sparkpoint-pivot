// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SparkPointVault } from "../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../src/governance/CapRegistry.sol";
import { KillSwitch } from "../src/governance/KillSwitch.sol";
import { AaveV3Adapter } from "../src/adapters/AaveV3Adapter.sol";
import { IPool } from "../src/interfaces/external/IPool.sol";

/// @title DeployCore — deploys the W5-US1 Aave Yield Vault core (CapRegistry + KillSwitch +
///        AaveV3Adapter + SparkPointVault) and records addresses to deployments/<chainId>/addresses.json.
/// @notice Cap defaults + ceilings mirror packages/shared/src/policy/constants.ts (T098 parity):
///         perUser 5_000e6 (ceiling 10_000e6); total 1_000_000e6 (ceiling 5_000_000e6);
///         vault 1_000_000e6 (ceiling 5_000_000e6). Performance-fee default 1000 bps (10%), hard cap
///         2000 bps (20%). Custody addresses (USDC/Aave Pool/aUSDC) default to Base mainnet (8453) and
///         are overridable via env for Base Sepolia (84532) / a fork.
/// @dev Governance is the multisig/timelock (guardian == the pause + timelocked-fee authority on the
///      vault; a separate `governance` key owns the bounded CapRegistry). NO key here is ever a fund
///      path (N1/N5) — this only wires immutables. Run with: `forge script script/DeployCore.s.sol
///      --rpc-url <url> --broadcast` (set GUARDIAN/GOVERNANCE/FEE_RECIPIENT; token addrs per chain).
contract DeployCore is Script {
    // ── Base mainnet (8453) custody addresses; override via env for other chains ──
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant BASE_AUSDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    // ── Cap params (USDC 6dp), T098 parity with packages/shared ──
    uint256 internal constant PER_USER_CAP = 5_000e6;
    uint256 internal constant TOTAL_CAP = 1_000_000e6;
    uint256 internal constant VAULT_CAP = 1_000_000e6;
    uint16 internal constant DEFAULT_PERFORMANCE_FEE_BPS = 1000; // 10%

    function run() external {
        // Roles (required for a real deploy; default to msg.sender for a dry run / fork).
        address deployer = msg.sender;
        address guardian = vm.envOr("GUARDIAN", deployer);
        address governance = vm.envOr("GOVERNANCE", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        // Custody addresses (Base mainnet defaults; override per chain).
        address usdc = vm.envOr("USDC", BASE_USDC);
        address aavePool = vm.envOr("AAVE_POOL", BASE_AAVE_POOL);
        address aUSDC = vm.envOr("AUSDC", BASE_AUSDC);

        uint16 perfFeeBps = uint16(vm.envOr("PERF_FEE_BPS", uint256(DEFAULT_PERFORMANCE_FEE_BPS)));

        vm.startBroadcast();

        CapRegistry capRegistry = new CapRegistry(governance, PER_USER_CAP, TOTAL_CAP, VAULT_CAP);
        KillSwitch killSwitch = new KillSwitch(guardian);
        AaveV3Adapter aaveAdapter = new AaveV3Adapter(IPool(aavePool));
        SparkPointVault vault = new SparkPointVault(
            IERC20(usdc),
            IPool(aavePool),
            IERC20(aUSDC),
            guardian,
            address(capRegistry),
            feeRecipient,
            perfFeeBps
        );

        vm.stopBroadcast();

        console2.log("SparkPointVault  ", address(vault));
        console2.log("CapRegistry      ", address(capRegistry));
        console2.log("KillSwitch       ", address(killSwitch));
        console2.log("AaveV3Adapter    ", address(aaveAdapter));
        console2.log("guardian         ", guardian);
        console2.log("governance       ", governance);
        console2.log("feeRecipient     ", feeRecipient);

        _writeAddresses(
            address(vault),
            address(capRegistry),
            address(killSwitch),
            address(aaveAdapter),
            guardian,
            governance,
            feeRecipient
        );
    }

    function _writeAddresses(
        address vault,
        address capRegistry,
        address killSwitch,
        address aaveAdapter,
        address guardian,
        address governance,
        address feeRecipient
    ) internal {
        string memory dir = string.concat("deployments/", vm.toString(block.chainid));
        vm.createDir(dir, true);

        string memory key = "sparkpoint-core";
        vm.serializeAddress(key, "SparkPointVault", vault);
        vm.serializeAddress(key, "CapRegistry", capRegistry);
        vm.serializeAddress(key, "KillSwitch", killSwitch);
        vm.serializeAddress(key, "AaveV3Adapter", aaveAdapter);
        vm.serializeAddress(key, "guardian", guardian);
        vm.serializeAddress(key, "governance", governance);
        string memory json = vm.serializeAddress(key, "feeRecipient", feeRecipient);

        string memory path = string.concat(dir, "/addresses.json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
