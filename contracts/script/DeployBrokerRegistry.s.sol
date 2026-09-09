// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { BrokerActivationRegistry } from "../src/broker/BrokerActivationRegistry.sol";

/// @title DeployBrokerRegistry — the contract that retires SRK and activates a Sparky Broker.
///
/// @notice Deploys `BrokerActivationRegistry` and records it under `.BrokerActivationRegistry` in
///         `deployments/<chainid>/addresses.json`. Wiring it as the NFT's `activator` is a SEPARATE,
///         deliberate step taken from the collection's owner wallet — this script cannot do it and
///         should not: `setActivator` is the moment the collection stops being fail-closed.
///
/// @dev The four constructor arguments are things you cannot change your mind about cheaply, so they
///      are read from the environment and echoed before broadcast rather than hard-coded:
///
///        BROKER_ADDRESS     the deployed SparkyBroker on THIS chain
///        SRK_ADDRESS        the SRK retired on activation, on the SAME chain as the broker
///        DEAD_ADDRESS       where retired SRK goes; NOT address(0) (ERC-20 transfers there revert)
///        MAX_ACTIVATION_PRICE   the PERMANENT ceiling on EVERY tier's price — immutable
///        PRICE_ANALYST / PRICE_ASSOCIATE / PRICE_PARTNER   the three tier prices (base units)
///        WEIGHT_ANALYST / WEIGHT_ASSOCIATE / WEIGHT_PARTNER   weights in bps of 1.0x (10000 = 1.0x)
///
///      ⚠️ All three tiers grant IDENTICAL Premium. A higher tier buys only `weightBps`, which is
///      recorded for a revenue share that IS NOT BUILT — nothing pays out. Deploying this does not
///      create an income stream, and no surface may imply it does.
///
///      Records with the 3-ARG keyed `vm.writeJson`, which updates ONLY its own key and preserves
///      every other entry — a 2-arg write would clobber the file.
///
///      Run from `contracts/`:
///        forge script script/DeployBrokerRegistry.s.sol:DeployBrokerRegistry \
///          --rpc-url $ROBINHOOD_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
///
///      `--slow` is deliberate on this stack: view lag has produced deploy failures here before.
contract DeployBrokerRegistry is Script {
    error BrokerAddressMissing();
    error SrkAddressMissing();
    /// @dev Named so the revert is the instruction: a standard ERC-20 `transfer` to `address(0)`
    ///      reverts, so the zero address cannot be the retirement sink even if it were preferable.
    error DeadAddressMustNotBeZero();
    error MaxPriceMissing();

    function run() external returns (BrokerActivationRegistry registry) {
        address broker = vm.envAddress("BROKER_ADDRESS");
        address srk = vm.envAddress("SRK_ADDRESS");
        address dead = vm.envOr("DEAD_ADDRESS", address(0x000000000000000000000000000000000000dEaD));
        uint256 maxPrice = vm.envUint("MAX_ACTIVATION_PRICE");
        uint256[3] memory prices = [
            vm.envUint("PRICE_ANALYST"), vm.envUint("PRICE_ASSOCIATE"), vm.envUint("PRICE_PARTNER")
        ];
        uint32[3] memory weights = [
            uint32(vm.envUint("WEIGHT_ANALYST")),
            uint32(vm.envUint("WEIGHT_ASSOCIATE")),
            uint32(vm.envUint("WEIGHT_PARTNER"))
        ];

        if (broker == address(0)) revert BrokerAddressMissing();
        if (srk == address(0)) revert SrkAddressMissing();
        if (dead == address(0)) revert DeadAddressMustNotBeZero();
        if (maxPrice == 0) revert MaxPriceMissing();

        console2.log("chain id        ", block.chainid);
        console2.log("broker (NFT)    ", broker);
        console2.log("srk             ", srk);
        console2.log("dead address    ", dead);
        console2.log("max price (wei) ", maxPrice);
        for (uint256 i = 0; i < 3; i++) {
            console2.log("  tier", i + 1);
            console2.log("    price ", prices[i]);
            console2.log("    weight", weights[i]);
        }

        vm.startBroadcast();
        registry = new BrokerActivationRegistry(broker, srk, dead, maxPrice, prices, weights);
        vm.stopBroadcast();

        console2.log("BrokerActivationRegistry", address(registry));
        console2.log("  owner         ", registry.owner());
        console2.log("  maxPrice      ", registry.maxPrice());
        for (uint8 t = 1; t <= 3; t++) {
            (uint256 p, uint32 w) = registry.tierConfig(t);
            console2.log("  tier price/weight", p, w);
        }
        console2.log("");
        console2.log("NEXT, from the NFT owner wallet (this script deliberately does not):");
        console2.log("  cast send <broker> 'setActivator(address)' <registry>");
        console2.log("That call is what stops the collection being fail-closed. Record it.");

        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        vm.writeJson(
            string.concat('"', vm.toString(address(registry)), '"'),
            path,
            ".BrokerActivationRegistry"
        );
        console2.log("wrote .BrokerActivationRegistry to", path);
    }
}
