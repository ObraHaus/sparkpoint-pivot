// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { BrokerEngine } from "../src/revenue/BrokerEngine.sol";
import { BrokerVault } from "../src/revenue/BrokerVault.sol";
import { RevenueSplitter } from "../src/revenue/RevenueSplitter.sol";
import { RoyaltySink } from "../src/revenue/RoyaltySink.sol";

/// @title DeployBetaRevenue
/// @notice Deploy the beta revenue subsystem for Sparky Broker on Robinhood Chain 4663.
/// **Beta channel only** — alpha (Base Sepolia) keeps its existing Broker/SRK surfaces.
///
/// Order is dependency-driven: engine (needs the NFT) → vault (needs the engine) → splitter (needs
/// the escrow + engine + treasury) → sink (needs the splitter). The Pons token is launched AFTER
/// this, with `creatorFeeRecipient` = the splitter proxy; `setToken` is a later one-shot.
///
/// Env:
///   NFT_ADDRESS          (required) — the broker collection the engine binds
///   FEE_ESCROW_ADDRESS   (required) — Pons V2FeeEscrow (0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e on 4663)
///   TREASURY_ADDRESS     (required) — the 10% leg; effectively permanent (no setter anywhere)
///   ROUND_SECONDS        (default 3600; 4663 REQUIRES 3600)
///
/// Usage (dry run, then append the broadcast flag):
///   NFT_ADDRESS=0x… FEE_ESCROW_ADDRESS=0xd3AF… TREASURY_ADDRESS=0x… ROUND_SECONDS=3600 \
///     forge script script/DeployBetaRevenue.s.sol --rpc-url $LIVE --slow --account sparkybeta-deployer
contract DeployBetaRevenue is Script {
    function run() external {
        uint256 chainId = block.chainid;
        address nft = vm.envAddress("NFT_ADDRESS");
        address escrow = vm.envAddress("FEE_ESCROW_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 roundSeconds = vm.envOr("ROUND_SECONDS", uint256(3600));

        if (nft == address(0) || escrow == address(0) || treasury == address(0)) {
            revert("DeployBetaRevenue: NFT/FEE_ESCROW/TREASURY must be set");
        }
        if (chainId == 4663 && roundSeconds != 3600) {
            revert("DeployBetaRevenue: ROUND_SECONDS must be 3600 on 4663");
        }

        address deployer = msg.sender;
        vm.startBroadcast();

        // 1 · engine — implementation + ERC1967 proxy; owner = the broadcaster.
        BrokerEngine engineImpl = new BrokerEngine();
        BrokerEngine engine = BrokerEngine(
            payable(
                address(
                    new ERC1967Proxy(
                        address(engineImpl),
                        abi.encodeCall(BrokerEngine.initialize, (nft, roundSeconds))
                    )
                )
            )
        );

        // 2 · vault — immutable; bound to the NFT and the engine proxy.
        BrokerVault vault = new BrokerVault(nft, address(engine));
        engine.setVault(address(vault));

        // 3 · splitter — immutable; the 90/10 sink. Becomes the token's creatorFeeRecipient.
        RevenueSplitter splitter = new RevenueSplitter(escrow, address(engine), treasury);

        // 4 · royalty sink — immutable; OpenSea royalties land here and flush to the splitter.
        RoyaltySink sink = new RoyaltySink(address(splitter));

        // Single-digit beta economics.
        engine.setClockInBurn(1);
        engine.setRankBurns(1, 2, 3);
        engine.setFuseBurns(2, 3);

        vm.stopBroadcast();

        console2.log("== Beta revenue deployed ==");
        console2.log("chainId", chainId);
        console2.log("deployer", deployer);
        console2.log("nft", nft);
        console2.log("engine (proxy)", address(engine)); // proxy — wire THIS
        console2.log("engineImpl", address(engineImpl));
        console2.log("vault", address(vault));
        console2.log("splitter", address(splitter)); // immutable, not a proxy
        console2.log("sink", address(sink));
        console2.log("escrow", escrow);
        console2.log("treasury", treasury);
        console2.log("round(s)", roundSeconds);
        console2.log("prices: activate 1 | ranks 1/2/3 | fuse 2/3");
        console2.log("NEXT: point OpenSea royalties at the sink; launch the token with");
        console2.log("      creatorFeeRecipient = the splitter; then setToken(token).");
    }
}
