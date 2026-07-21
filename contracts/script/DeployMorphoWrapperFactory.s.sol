// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

import { SparkPointVaultFactory } from "../src/factory/SparkPointVaultFactory.sol";
import { ISparkPointVaultFactory } from "../src/interfaces/ISparkPointVaultFactory.sol";

/// @title DeployMorphoWrapperFactory — 011 factory deploy (spec §3). Deploys SparkPointVaultFactory owned
///        by an OZ TimelockController, allowlists a VETTED curated Morpho vault, and optionally deploys
///        one smoke wrapper. Mirrors DeploySepolia.s.sol / DeployCore.s.sol.
/// @notice The Timelock is the factory `owner` (== the mandated allowlist delay/veto window, constitution
///         v2.0.0) AND the `guardian` every wrapper is deployed with (pause + hard-capped fee-rate only —
///         NO fund path, N5). `feeRecipient` is the SparkPoint treasury (a non-privileged fee-share
///         holder). NO key here is a fund path (N1/N5): the factory holds no funds and only wires
///         immutables + deploys wrappers.
/// @dev Env:
///        MORPHO_VAULT        (required) the VETTED curated Morpho ERC-4626 to allowlist — NEVER a
///                            guessed hardcode; it must clear the off-chain IV.5(c) vetting first.
///        USDC                (required) the USDC every wrapper routes.
///        FEE_RECIPIENT       (optional, default deployer) the SparkPoint treasury.
///        TIMELOCK_MIN_DELAY  (optional, default 60s testnet; production ~172800).
///        DEPLOY_SMOKE_WRAPPER (optional, default false) deploy one wrapper over MORPHO_VAULT.
///        SMOKE_FEE_BPS       (optional, default 1000) perf-fee for the smoke wrapper (≤ 2000).
///      Run: `MORPHO_VAULT=0x.. USDC=0x.. forge script script/DeployMorphoWrapperFactory.s.sol \
///            --rpc-url <url> --broadcast`.
contract DeployMorphoWrapperFactory is Script {
    // Smoke-wrapper caps (USDC 6dp) — mirror the 010/011 defaults; within CapRegistry ceilings.
    uint256 internal constant SMOKE_PER_ADDRESS_CAP = 5_000e6;
    uint256 internal constant SMOKE_TOTAL_CAP = 1_000_000e6;
    uint16 internal constant DEFAULT_SMOKE_FEE_BPS = 1000; // 10%

    /// @dev Fixed version tag ⇒ the same bytecode + args + deployer land at the SAME address (no churn).
    bytes32 internal constant SALT = keccak256("sparkpoint-morpho-factory-v1");

    function run() external {
        address deployer = msg.sender;
        address usdc = vm.envAddress("USDC");
        address morphoVault = vm.envAddress("MORPHO_VAULT");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast();

        address timelock = _deployGuardian(deployer);

        SparkPointVaultFactory factory =
            new SparkPointVaultFactory{ salt: SALT }(timelock, IERC20(usdc), timelock, feeRecipient);
        console2.log("SparkPointVaultFactory", address(factory));
        console2.log("  owner/guardian (timelock)", timelock);
        console2.log("  usdc                     ", usdc);
        console2.log("  feeRecipient             ", feeRecipient);

        // Allowlist the vetted curated Morpho vault. Owner == the timelock, so in production this is a
        // timelock schedule/execute; on a single-key testnet run the deployer is the timelock admin.
        // We call through the timelock owner path via a direct owner call only when deployer == owner;
        // for the standard testnet MVP the deployer is the timelock's sole proposer/executor.
        _allowlist(factory, timelock, morphoVault);

        if (vm.envOr("DEPLOY_SMOKE_WRAPPER", false)) {
            _deploySmokeWrapper(factory, timelock, morphoVault);
        }

        vm.stopBroadcast();

        _writeAddresses(address(factory), timelock, usdc, morphoVault, feeRecipient);
    }

    /// @dev OZ TimelockController: deployer is the sole proposer/executor/admin for the testnet MVP
    ///      (production stacks a Safe M-of-N in front + renounces admin). Mirrors DeploySepolia.
    function _deployGuardian(address deployer) internal returns (address) {
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(60));
        TimelockController timelock =
            new TimelockController{ salt: SALT }(minDelay, proposers, executors, deployer);
        console2.log("TimelockController", address(timelock));
        console2.log("  minDelay        ", minDelay);
        return address(timelock);
    }

    /// @dev Schedule + execute `allowlistMorphoVault(morphoVault, true)` through the timelock owner.
    function _allowlist(SparkPointVaultFactory factory, address timelockAddr, address morphoVault)
        internal
    {
        TimelockController timelock = TimelockController(payable(timelockAddr));
        bytes memory data =
            abi.encodeCall(ISparkPointVaultFactory.allowlistMorphoVault, (morphoVault, true));
        uint256 delay = timelock.getMinDelay();
        timelock.schedule(address(factory), 0, data, bytes32(0), SALT, delay);
        vm.warp(block.timestamp + delay + 1);
        timelock.execute(address(factory), 0, data, bytes32(0), SALT);
        console2.log("allowlisted curated Morpho vault", morphoVault);
    }

    /// @dev Schedule + execute one smoke `createVault(...)` through the timelock owner.
    function _deploySmokeWrapper(
        SparkPointVaultFactory factory,
        address timelockAddr,
        address morphoVault
    ) internal {
        TimelockController timelock = TimelockController(payable(timelockAddr));
        uint16 feeBps = uint16(vm.envOr("SMOKE_FEE_BPS", uint256(DEFAULT_SMOKE_FEE_BPS)));
        ISparkPointVaultFactory.Caps memory caps = ISparkPointVaultFactory.Caps({
            perAddressCap: SMOKE_PER_ADDRESS_CAP,
            totalCap: SMOKE_TOTAL_CAP
        });
        string memory label = "SparkPoint Morpho USDC";
        address predicted = factory.predictVaultAddress(morphoVault, feeBps, caps, label);

        bytes memory data =
            abi.encodeCall(ISparkPointVaultFactory.createVault, (morphoVault, feeBps, caps, label));
        uint256 delay = timelock.getMinDelay();
        timelock.schedule(address(factory), 0, data, bytes32(0), SALT, delay);
        vm.warp(block.timestamp + delay + 1);
        timelock.execute(address(factory), 0, data, bytes32(0), SALT);

        console2.log("smoke wrapper predicted", predicted);
        console2.log("smoke wrapper deployed ", factory.vaultAt(factory.vaultsLength() - 1));
    }

    function _writeAddresses(
        address factory,
        address timelock,
        address usdc,
        address morphoVault,
        address feeRecipient
    ) internal {
        string memory dir = string.concat("deployments/", vm.toString(block.chainid));
        vm.createDir(dir, true);

        string memory key = "sparkpoint-morpho-factory";
        vm.serializeAddress(key, "SparkPointVaultFactory", factory);
        vm.serializeAddress(key, "TimelockController", timelock);
        vm.serializeAddress(key, "guardian", timelock);
        vm.serializeAddress(key, "owner", timelock);
        vm.serializeAddress(key, "USDC", usdc);
        vm.serializeAddress(key, "curatedMorphoVault", morphoVault);
        string memory json = vm.serializeAddress(key, "feeRecipient", feeRecipient);

        string memory path = string.concat(dir, "/morpho-factory.json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
