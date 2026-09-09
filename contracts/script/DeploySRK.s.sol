// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { SparkPointTestToken } from "../src/token/SparkPointTestToken.sol";

/// @title DeploySRK — deploy the SparkPoint test SRK ERC-20 to a testnet (Base Sepolia 84532) and
///        record its address WITHOUT clobbering the existing core deployment file.
/// @notice The entire fixed supply mints to the broadcaster (the deployer) at construction — no faucet.
/// @dev Mirrors DeploySepolia.s.sol. Records the address with the 3-ARG keyed `vm.writeJson`, which
///      updates ONLY the `.SRK` key of `deployments/<chainid>/addresses.json` and preserves every
///      other entry (SparkPointVault/TimelockController/guardian/feeRecipient). A 2-ARG write would
///      overwrite the whole file. The value is a quoted JSON string so the key stores "0x…" exactly
///      like the sibling address entries. Run:
///        forge script script/DeploySRK.s.sol:DeploySRK --rpc-url <base_sepolia> --private-key <key> --broadcast --slow
contract DeploySRK is Script {
    function run() external returns (address srkAddr) {
        vm.startBroadcast();
        SparkPointTestToken srk = new SparkPointTestToken();
        vm.stopBroadcast();
        srkAddr = address(srk);

        console2.log("SparkPointTestToken", srkAddr);
        console2.log("  name             ", srk.name());
        console2.log("  symbol           ", srk.symbol());
        console2.log("  decimals         ", srk.decimals());
        console2.log("  totalSupply      ", srk.totalSupply());
        console2.log("  holder(deployer) ", msg.sender);

        // Add ONLY the .SRK key to the existing core address file — never a 2-arg (whole-file) write.
        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        string memory value = string.concat('"', vm.toString(srkAddr), '"');
        vm.writeJson(value, path, ".SRK");
        console2.log("wrote .SRK to", path);
    }
}
