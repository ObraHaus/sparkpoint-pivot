// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { FeeRouter } from "../src/revenue/FeeRouter.sol";

/// @title DeployFeeRouter
/// @notice Deploy the beta **fee-router** (UUPS proxy) for Robinhood Chain 4663: the 0.20% swap fee
/// on the user-signed swap, paid to the `RevenueSplitter`.
///
/// **Beta channel only** — the defaults below are the 4663 Uniswap V3 WETH/USDG venue, and the
/// contract charges a fee, so it must never be wired on alpha (Base Sepolia).
///
/// Env:
///   FEE_RECIPIENT        (required) — the RevenueSplitter. Must be a CONTRACT: the fee may never
///                                    go to an EOA (constitution v3.2.0).
///   WETH_ADDRESS         (default 4663 WETH)
///   SWAP_ROUTER_ADDRESS  (default 4663 SwapRouter02)
///   FEE_CEILING_BPS      (default 100 = 1%; the immutable ceiling, ≥ FEE_BPS=20, ≤ 100)
///
/// Usage (dry run first, then append the broadcast flag):
///   FEE_RECIPIENT=0xD4dD7E2CAfBcC40f25d2D5Fb975B8E6E033609C1 \
///     forge script script/DeployFeeRouter.s.sol --rpc-url $LIVE --slow --account sparkybeta-deployer
contract DeployFeeRouter is Script {
    /// @dev 4663 WETH (a proxy over a standard WETH9; `deposit`/`withdraw` verified on-chain).
    address internal constant WETH_4663 = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    /// @dev 4663 Uniswap V3 SwapRouter02 (no `sweepWithFee`; `exactInputSingle` has no deadline).
    address internal constant SWAP_ROUTER_4663 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    function run() external {
        if (block.chainid != 4663) {
            revert("DeployFeeRouter: beta fee-router is Robinhood Chain 4663 only");
        }

        address weth = vm.envOr("WETH_ADDRESS", WETH_4663);
        address swapRouter = vm.envOr("SWAP_ROUTER_ADDRESS", SWAP_ROUTER_4663);
        address splitter = vm.envAddress("FEE_RECIPIENT");
        uint256 feeCeilingBps = vm.envOr("FEE_CEILING_BPS", uint256(100));

        if (splitter == address(0)) {
            revert("DeployFeeRouter: FEE_RECIPIENT must be set");
        }
        if (splitter.code.length == 0) {
            revert("DeployFeeRouter: FEE_RECIPIENT must be a contract (never an EOA)");
        }

        vm.startBroadcast();

        FeeRouter impl = new FeeRouter(weth, swapRouter, splitter, feeCeilingBps);
        FeeRouter router = FeeRouter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(FeeRouter.initialize, ()))
                ))
        );

        vm.stopBroadcast();

        console2.log("== Beta fee-router deployed ==");
        console2.log("chainId", block.chainid);
        console2.log("router (proxy)", address(router)); // wire THIS in the 4663 book
        console2.log("impl", address(impl));
        console2.log("weth", weth);
        console2.log("swapRouter", swapRouter);
        console2.log("fee recipient (splitter)", splitter);
        console2.log("feeBps", router.feeBps());
        console2.log("feeCeilingBps", feeCeilingBps);
        console2.log("owner (deployer)", msg.sender);
        console2.log("NEXT: record the proxy under beta.feeRouter in contracts/deployments/4663/");
        console2.log("      addresses.json, mirror it in packages/shared/addresses, then bind the");
        console2.log("      swap page route to it.");
    }
}
