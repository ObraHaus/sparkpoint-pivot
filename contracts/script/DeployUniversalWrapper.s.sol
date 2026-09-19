// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import { TransparentUpgradeableProxy } from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { SparkPointUniversalVault } from "../src/vault/SparkPointUniversalVault.sol";
import { SparkPointVaultFactoryV2 } from "../src/factory/SparkPointVaultFactoryV2.sol";

/// @title DeployUniversalWrapper
/// @notice Deploy the feature-049 universal wrapper fleet for Robinhood Chain (4663):
///         TimelockController → `UpgradeableBeacon` → `SparkPointUniversalVault` implementation →
///         `SparkPointVaultFactoryV2` behind a Transparent proxy.
///
/// **Operator-signed. Beta channel only** — this script reverts on any chain but 4663.
///
/// Authority rules enforced HERE (constitution v4.0.0), not by convention:
///   * `TIMELOCK_PROPOSER` and `TIMELOCK_CANCELLER` must be CONTRACTS (multisig Safes) — an EOA
///     reverts the run. They must differ (independent canceller).
///   * `TIMELOCK_MIN_DELAY` is floored at 72h.
///   * The timelock is deployed with NO open proposer/canceller roles: proposer is granted to the
///     proposer Safe, canceller to the independent guardian Safe, EXECUTOR is open (anyone may
///     execute after the delay), and the deployer RENOUNCES admin in the same run.
///   * The beacon owner and the factory owner are the timelock. The factory runs behind a
///     Transparent proxy, so the implementation itself has no upgrade and no payable surface.
///
/// Env:
///   TIMELOCK_PROPOSER     (required) — the 3-of-5 multisig Safe address.
///   TIMELOCK_CANCELLER    (required) — the INDEPENDENT guardian Safe (2-of-3) that can only cancel.
///   WRAPPER_FEE_RECIPIENT (default: the 4663 beta treasury) — receives performance-fee shares.
///   TIMELOCK_MIN_DELAY    (default 259200 = 72h; floored at 259200).
///
/// Usage (dry run first, then add --broadcast; verification is chain-dependent):
///   cd contracts
///   TIMELOCK_PROPOSER=0x… TIMELOCK_CANCELLER=0x… \
///     forge script script/DeployUniversalWrapper.s.sol \
///       --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --slow
///   # …then re-run the same command WITH --broadcast.
///
/// ⚠️ After broadcasting, two follow-up calls go through the TIMELOCK (see the NEXT lines the
/// script prints): `setDeployer(<AI deployer>, true)` and, once a child vault exists on 4663,
/// `setAllowlisted(<child>, true)`. Neither is callable by the deploying EOA.
contract DeployUniversalWrapper is Script {
    /// @dev 4663 beta treasury (contracts/deployments/4663/addresses.json → beta.treasury).
    address internal constant TREASURY_4663 = 0x376293DDb027555aB7F483c00e1D61b2a7757dE8;
    uint256 internal constant MIN_DELAY_FLOOR = 72 hours;

    function run() external {
        if (block.chainid != 4663) {
            revert("DeployUniversalWrapper: Robinhood Chain 4663 only");
        }

        address proposer = vm.envAddress("TIMELOCK_PROPOSER");
        address canceller = vm.envAddress("TIMELOCK_CANCELLER");
        address feeRecipient = vm.envOr("WRAPPER_FEE_RECIPIENT", TREASURY_4663);
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", MIN_DELAY_FLOOR);

        if (proposer.code.length == 0) {
            revert("DeployUniversalWrapper: TIMELOCK_PROPOSER must be a contract (multisig Safe)");
        }
        if (canceller.code.length == 0) {
            revert("DeployUniversalWrapper: TIMELOCK_CANCELLER must be a contract (multisig Safe)");
        }
        if (proposer == canceller) {
            revert("DeployUniversalWrapper: proposer and canceller must be INDEPENDENT");
        }
        if (minDelay < MIN_DELAY_FLOOR) {
            revert("DeployUniversalWrapper: TIMELOCK_MIN_DELAY below the 72h floor");
        }
        if (feeRecipient == address(0)) {
            revert("DeployUniversalWrapper: WRAPPER_FEE_RECIPIENT must be set");
        }

        vm.startBroadcast();

        // 1 · Timelock: no proposer/canceller at construction; roles granted explicitly, then the
        //     deployer renounces admin so the EOA holds NOTHING after this run.
        address[] memory noAddresses = new address[](0);
        address[] memory openExecutor = new address[](1);
        openExecutor[0] = address(0); // anyone may execute once the delay has elapsed
        TimelockController timelock =
            new TimelockController(minDelay, noAddresses, openExecutor, msg.sender);
        timelock.grantRole(timelock.PROPOSER_ROLE(), proposer);
        timelock.grantRole(timelock.CANCELLER_ROLE(), canceller);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), msg.sender);

        // 2 · Implementation + beacon (owner = timelock).
        SparkPointUniversalVault implementation = new SparkPointUniversalVault();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(implementation), address(timelock));

        // 3 · Deploy-only factory behind a Transparent proxy (ProxyAdmin owner = timelock). The
        //     factory implementation carries no upgrade and no payable surface.
        SparkPointVaultFactoryV2 factoryImpl = new SparkPointVaultFactoryV2();
        bytes memory initData = abi.encodeCall(
            SparkPointVaultFactoryV2.initialize,
            (address(timelock), address(beacon), address(timelock), feeRecipient)
        );
        SparkPointVaultFactoryV2 factory = SparkPointVaultFactoryV2(
            address(
                new TransparentUpgradeableProxy(address(factoryImpl), address(timelock), initData)
            )
        );

        vm.stopBroadcast();

        console2.log("== Universal wrapper fleet deployed (4663) ==");
        console2.log("timelock", address(timelock));
        console2.log("beacon", address(beacon));
        console2.log("implementation", address(implementation));
        console2.log("factory (proxy)  <-- record + wire THIS", address(factory));
        console2.log("factory impl", address(factoryImpl));
        console2.log("fee recipient", feeRecipient);
        console2.log("min delay (s)", minDelay);
        console2.log("proposer (3-of-5 Safe)", proposer);
        console2.log("canceller (independent Safe)", canceller);
        console2.log("");
        console2.log("NEXT 1: record these under a new `wrapper` section in");
        console2.log("        contracts/deployments/4663/addresses.json (+ the app book if wired).");
        console2.log("NEXT 2: through the TIMELOCK (schedule -> 72h -> execute):");
        console2.log("        factory.setDeployer(0xB555dbEc2cC5908c8B245ED84cb038D5d205D875, true)");
        console2.log("NEXT 3: once Gate 0 (a live ERC-4626 child on 4663) exists, through the timelock:");
        console2.log("        factory.setAllowlisted(<child>, true)");
        console2.log("NEXT 4: deploy the `SERVICE=deployer` runner with WRAPPER_FACTORY_ADDRESS=<proxy>.");
    }
}
