// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { BetaQuoterV2 } from "../src/revenue/BetaQuoterV2.sol";

/// @title DeployBetaQuoter
/// @notice Deploy the minimal single-hop `BetaQuoterV2` (UUPS proxy) for Robinhood Chain 4663.
///
/// **Beta channel only.** 4663 has no working QuoterV2 (every canonical address is a dead stub), so
/// the app cannot quote a swap without this. The contract is read-only in effect: its pool call is
/// always unwound by the callback's revert. The proxy keeps the address stable while quote features
/// (multi-hop, exact-output, …) can be upgraded in place — owner = the deploying EOA.
///
/// Env:
///   UNISWAP_V3_FACTORY  (default: the REAL 4663 factory, the pools' own `factory()`)
///   WETH_ADDRESS        (default: 4663 WETH)
///
/// Usage (dry run first, then append the broadcast flag):
///   forge script script/DeployBetaQuoter.s.sol --rpc-url $LIVE --slow --account sparkybeta-deployer
contract DeployBetaQuoter is Script {
    /// @dev The real factory: the WETH/USDG fee-100 pool's `factory()` (the book's old canonical
    /// address is a stub on this chain).
    address internal constant FACTORY_4663 = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant WETH_4663 = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function run() external {
        if (block.chainid != 4663) {
            revert("DeployBetaQuoter: beta channel is Robinhood Chain 4663 only");
        }

        address factory = vm.envOr("UNISWAP_V3_FACTORY", FACTORY_4663);
        address weth = vm.envOr("WETH_ADDRESS", WETH_4663);

        vm.startBroadcast();

        BetaQuoterV2 impl = new BetaQuoterV2(factory, weth);
        BetaQuoterV2 quoter = BetaQuoterV2(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(BetaQuoterV2.initialize, ()))
                ))
        );

        vm.stopBroadcast();

        console2.log("== BetaQuoterV2 (UUPS) deployed ==");
        console2.log("quoter (proxy)", address(quoter)); // wire THIS
        console2.log("impl", address(impl));
        console2.log("factory", factory);
        console2.log("weth", weth);
        console2.log("owner (deployer)", msg.sender);
        console2.log("NEXT: record the proxy in contracts/deployments/4663/addresses.json and");
        console2.log("      wire packages/shared robinhoodMainnet.uniswapV3QuoterV2.");
    }
}
