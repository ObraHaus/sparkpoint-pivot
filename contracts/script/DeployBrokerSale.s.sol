// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { BrokerSale } from "../src/broker/BrokerSale.sol";

/// @title DeployBrokerSale — the free, open mint for Sparky Broker.
///
/// @notice Deploys `BrokerSale` and records it under `.BrokerSale` in
///         `deployments/<chainid>/addresses.json`. Wiring it as the NFT's `minter` is a SEPARATE,
///         deliberate step from the collection owner's wallet — this script cannot do it and should
///         not: `setMinter` is the moment 10,000 brokers become mintable.
///
/// @dev Environment:
///        BROKER_ADDRESS      the deployed SparkyBroker on THIS chain
///        PER_WALLET_CAP      how many one address may mint (owner-settable afterwards)
///        SALE_OPEN           "true" to open at deploy; anything else deploys CLOSED
///
///      Deploying closed and opening deliberately is the safer default: it separates "the contract
///      exists" from "the mint is live", so the wiring can be verified before anyone can mint.
///
///      Run from `contracts/`:
///        forge script script/DeployBrokerSale.s.sol:DeployBrokerSale \
///          --rpc-url $ROBINHOOD_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
contract DeployBrokerSale is Script {
    error BrokerAddressMissing();
    error PerWalletCapMissing();

    function run() external returns (BrokerSale sale) {
        address broker = vm.envAddress("BROKER_ADDRESS");
        uint256 perWalletCap = vm.envUint("PER_WALLET_CAP");
        bool open = vm.envOr("SALE_OPEN", false);

        if (broker == address(0)) revert BrokerAddressMissing();
        if (perWalletCap == 0) revert PerWalletCapMissing();

        console2.log("chain id       ", block.chainid);
        console2.log("broker (NFT)   ", broker);
        console2.log("per-wallet cap ", perWalletCap);
        console2.log("open at deploy ", open);

        vm.startBroadcast();
        sale = new BrokerSale(broker, perWalletCap, open);
        vm.stopBroadcast();

        console2.log("BrokerSale     ", address(sale));
        console2.log("  owner        ", sale.owner());
        console2.log("  perWalletCap ", sale.perWalletCap());
        console2.log("  saleOpen     ", sale.saleOpen());
        console2.log("");
        console2.log("NEXT, from the NFT owner wallet (this script deliberately does not):");
        console2.log("  cast send <broker> 'setMinter(address)' <sale>");
        console2.log("That call is what makes 10,000 brokers mintable. Record it.");

        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        vm.writeJson(string.concat('"', vm.toString(address(sale)), '"'), path, ".BrokerSale");
        console2.log("wrote .BrokerSale to", path);
    }
}
