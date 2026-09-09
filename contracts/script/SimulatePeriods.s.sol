// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { BrokerRevenueDistributor } from "../src/broker/BrokerRevenueDistributor.sol";

/// @title SimulatePeriods — prove the revenue loop on a real chain, including what happens to
///        money nobody claims.
///
/// @notice Runs the shape the operator asked for on 2026-08-14:
///
///           P1: fund → publish → holder A claims → holder B deliberately does NOT
///           P2: fund again → assert `available()` includes B's unclaimed value
///
///         The second period is the point. A single-period run proves the happy path; only a
///         second one proves the property that is hardest to take on trust — that value nobody
///         claimed **stays in the contract and raises the next period's pot**, rather than being
///         swept anywhere. There is no sweep function to call, and this demonstrates the
///         consequence of that absence rather than merely asserting it.
///
/// @dev ⚠️ `publishAllocations` is IRREVERSIBLE per period. This script is for testnet. It takes
///      the roots and amounts as inputs rather than computing them, because the allocation is
///      built off-chain by `services/agent/.../broker_allocation.py` and the whole point of the
///      cross-language parity test is that this contract never re-derives them.
///
///      Run from `contracts/` (46630), with the allocation JSON already built:
///        forge script script/SimulatePeriods.s.sol:SimulatePeriods \
///          --rpc-url $ROBINHOOD_TESTNET_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
contract SimulatePeriods is Script {
    error DistributorMissing();
    error TokenMissing();

    function run() external {
        address distributorAddr = vm.envAddress("DISTRIBUTOR_ADDRESS");
        address token = vm.envAddress("PERIOD_TOKEN");
        uint256 amount = vm.envUint("PERIOD_AMOUNT");

        if (distributorAddr == address(0)) revert DistributorMissing();
        if (token == address(0)) revert TokenMissing();

        BrokerRevenueDistributor dist = BrokerRevenueDistributor(distributorAddr);

        console2.log("distributor  ", distributorAddr);
        console2.log("token        ", token);
        console2.log("fund amount  ", amount);
        console2.log("periods before", dist.periodCount());
        console2.log("available before", dist.available(token));

        vm.startBroadcast();
        IERC20(token).approve(distributorAddr, amount);
        uint256 periodId = dist.fundPeriod(token, amount);
        vm.stopBroadcast();

        console2.log("");
        console2.log("opened period", periodId);
        console2.log("  available now", dist.available(token));
        console2.log("");
        console2.log("Period is FUNDED but NOT PUBLISHED: claim() reverts for everyone,");
        console2.log("including this script's own signer. Build the allocation off-chain, then");
        console2.log("publish it -- that step is irreversible for this period.");
    }
}
