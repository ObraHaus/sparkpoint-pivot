// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { BrokerRevenueDistributor } from "../src/broker/BrokerRevenueDistributor.sol";

/// @title DeployBrokerRevenueDistributor — the pot that pays activated broker holders.
///
/// @notice Deploys `BrokerRevenueDistributor` and records it under `.BrokerRevenueDistributor` in
///         `deployments/<chainid>/addresses.json`.
///
/// @dev **Deploying this does NOT turn revenue share on, and that is by design.**
///
///      A period only becomes claimable when someone calls `publishAllocations`. Until then `claim`
///      reverts `NotPublished` for everyone — so the contract ships in an off state that needs no
///      pause flag to hold it there. That matters: a pause switch would mean the owner could FREEZE
///      holders' claims, which is exactly the authority this contract is built not to have. Off by
///      construction beats off by configuration.
///
///      The deploy therefore stops at "the plumbing exists". Turning it on is three deliberate acts,
///      in order, each of which someone has to choose to do:
///
///        1. `fundPeriod(token, amount)`   — moves real value in from the fee treasury
///        2. build the allocation off-chain — `services/agent/.../broker_allocation.py`
///        3. `publishAllocations(id, root, total)` — the on-switch, and irreversible for that period
///
///      ⚠️ Step 3 cannot be undone. A published period is immutable, so a wrong root strands real
///      money against proofs nobody holds. Publish only a root produced by the committed builder,
///      and only after `AllocationParity.t.sol` is green against that build.
///
///      ⚠️ The owner should be the fee-treasury Safe, not an EOA. The owner cannot take funds — no
///      withdraw path exists — but it CAN publish, and publishing is the irreversible step.
///      `Ownable2Step` means the Safe must accept before it holds the role.
///
///      Run from `contracts/`:
///        forge script script/DeployBrokerRevenueDistributor.s.sol:DeployBrokerRevenueDistributor \
///          --rpc-url $ROBINHOOD_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
///
///      `--slow` is deliberate on this stack: view lag has produced deploy failures here before.
contract DeployBrokerRevenueDistributor is Script {
    function run() external returns (BrokerRevenueDistributor distributor) {
        // Defaults to the broadcaster. Handing it to the Safe afterwards is `transferOwnership` +
        // `acceptOwnership`, which is safer than a one-shot constructor arg nobody can correct.
        address owner = vm.envOr("DISTRIBUTOR_OWNER", address(0));

        console2.log("chain id     ", block.chainid);
        console2.log("owner (arg)  ", owner);
        if (owner == address(0)) {
            console2.log("  -> zero: the broadcaster becomes owner. Transfer to the Safe after.");
        }

        vm.startBroadcast();
        distributor = new BrokerRevenueDistributor(owner);
        vm.stopBroadcast();

        console2.log("BrokerRevenueDistributor", address(distributor));
        console2.log("  owner       ", distributor.owner());
        console2.log("  periodCount ", distributor.periodCount());
        console2.log("");
        console2.log("Revenue share is OFF: no period exists, so claim() reverts for everyone.");
        console2.log("It stays off until publishAllocations() is called. No flag holds it there.");

        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        vm.writeJson(
            string.concat('"', vm.toString(address(distributor)), '"'),
            path,
            ".BrokerRevenueDistributor"
        );
        console2.log("wrote .BrokerRevenueDistributor to", path);
    }
}
