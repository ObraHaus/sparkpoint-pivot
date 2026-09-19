// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { SparkPointVaultFactoryV3 } from "../src/factory/SparkPointVaultFactoryV3.sol";

/// @title DeployVaultFactoryV3
/// @notice V.3 of the Part-2 pivot: deploy `SparkPointVaultFactoryV3` (implementation +
///         Transparent proxy) for Robinhood Chain 4663. **Operator-signed** with the
///         `sparkybeta-deployer` keystore; this script reverts on any chain but 4663.
///
/// The initializer grants the three roles ATOMICALLY at deployment:
///   * DEFAULT_ADMIN_ROLE = the TimelockController (role admin + non-admission params),
///   * ADMIN_ROLE         = the operator EOA (instant admission lane),
///   * DEPLOYER_ROLE      = the AI deployer key (cooldown-gated admission lane).
/// The ProxyAdmin of the new proxy is owned by the timelock (72h upgrades only); the factory
/// implementation itself carries no upgrade and no payable surface.
///
/// Env (all optional — defaults are the live 4663 v4.1.0 addresses):
///   VAULT_TIMELOCK       default 0x62b8…b0B5
///   VAULT_ADMIN          default 0x3762…7dE8
///   VAULT_AI_DEPLOYER    default 0xB555…D875
///   VAULT_BEACON         default 0xC4D6…ab0c
///   VAULT_GUARDIAN       default = VAULT_TIMELOCK
///   VAULT_FEE_RECIPIENT  default = VAULT_ADMIN (the 4663 beta treasury)
///
/// Usage (dry run first, then add --broadcast; verification is chain-dependent):
///   cd contracts
///   forge script script/DeployVaultFactoryV3.s.sol \
///     --rpc-url "$RPC_URL" --account sparkybeta-deployer --slow
///   # …inspect the predicted addresses/args, then re-run the same command WITH --broadcast.
///
/// ⚠️ After broadcasting, verify on-chain reads (`defaultAdmin`/`ADMIN_ROLE`/`DEPLOYER_ROLE`
/// holders, cooldown = 86400, beacon, guardian, feeRecipient, ProxyAdmin owner) and record the
/// proxy in `contracts/deployments/4663/addresses.json` + `packages/shared` (V.3/V.7). This script
/// changes nothing; it replaces the sunset V2 factory for FUTURE wrappers only.
contract DeployVaultFactoryV3 is Script {
    /// @dev Live 4663 v4.0.0 fleet + v4.1.0 role holders (contracts/deployments/4663/addresses.json).
    address internal constant TIMELOCK_4663 = 0x62b8b01cEcecBc191F35A0dD93f5898A6848b0B5;
    address internal constant BEACON_4663 = 0xC4D6D11fe9d7F1091b9f74b55b27D6D1cbB0ab0c;
    address internal constant ADMIN_4663 = 0x376293DDb027555aB7F483c00e1D61b2a7757dE8;
    address internal constant AI_DEPLOYER_4663 = 0xB555dbEc2cC5908c8B245ED84cb038D5d205D875;

    function run() external {
        if (block.chainid != 4663) {
            revert("DeployVaultFactoryV3: Robinhood Chain 4663 only");
        }

        address timelock = vm.envOr("VAULT_TIMELOCK", TIMELOCK_4663);
        address admin = vm.envOr("VAULT_ADMIN", ADMIN_4663);
        address aiDeployer = vm.envOr("VAULT_AI_DEPLOYER", AI_DEPLOYER_4663);
        address beacon = vm.envOr("VAULT_BEACON", BEACON_4663);
        address guardian = vm.envOr("VAULT_GUARDIAN", timelock);
        address feeRecipient = vm.envOr("VAULT_FEE_RECIPIENT", admin);

        if (timelock.code.length == 0) {
            revert("DeployVaultFactoryV3: VAULT_TIMELOCK must be a contract (TimelockController)");
        }
        if (beacon.code.length == 0) {
            revert("DeployVaultFactoryV3: VAULT_BEACON must be the deployed UpgradeableBeacon");
        }
        if (admin == address(0) || aiDeployer == address(0) || guardian == address(0)) {
            revert("DeployVaultFactoryV3: role holders must be set");
        }
        if (feeRecipient == address(0)) {
            revert("DeployVaultFactoryV3: VAULT_FEE_RECIPIENT must be set");
        }

        vm.startBroadcast();

        SparkPointVaultFactoryV3 factoryImpl = new SparkPointVaultFactoryV3();
        bytes memory initData = abi.encodeCall(
            SparkPointVaultFactoryV3.initialize,
            (timelock, admin, aiDeployer, beacon, guardian, feeRecipient)
        );
        SparkPointVaultFactoryV3 factory = SparkPointVaultFactoryV3(
            address(new TransparentUpgradeableProxy(address(factoryImpl), timelock, initData))
        );

        vm.stopBroadcast();

        console2.log("== SparkPointVaultFactoryV3 deployed (4663) ==");
        console2.log("factory (proxy)  <-- record + wire THIS", address(factory));
        console2.log("factory impl", address(factoryImpl));
        console2.log("DEFAULT_ADMIN_ROLE (timelock)", timelock);
        console2.log("ADMIN_ROLE (operator EOA)", admin);
        console2.log("DEPLOYER_ROLE (AI deployer)", aiDeployer);
        console2.log("beacon", beacon);
        console2.log("guardian", guardian);
        console2.log("fee recipient", feeRecipient);
        console2.log("cooldown (s)", SparkPointVaultFactoryV3(address(factory)).cooldown());
        console2.log("");
        console2.log(
            "VERIFY: roles via hasRole + cooldown == 86400 + ProxyAdmin owner == timelock."
        );
        console2.log(
            "NEXT: record under `wrapper.factoryV3` in contracts/deployments/4663/addresses.json"
        );
        console2.log("      and packages/shared, then V.4 sunset of the V2 factory.");
    }
}
