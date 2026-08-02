// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SrkFaucet } from "../src/token/SrkFaucet.sol";

/// @title DeploySrkFaucet — deploy the standalone SRK dispenser and fund it from the deployer's float.
/// @notice `SparkPointTestToken` has a fixed supply and no mint path (a spec-012 property with a fuzz
///         test asserting it), so the faucet is a SEPARATE contract holding pre-transferred SRK. This
///         script deploys it, seeds the admin roster (deployer + the client demo admin wallet) and
///         transfers the float in the same broadcast.
/// @dev Records the address with the 3-ARG keyed `vm.writeJson`, which updates ONLY `.SrkFaucet` in
///      `deployments/<chainid>/addresses.json` and preserves every other entry — a 2-arg write would
///      clobber the whole file.
///
///      Base Sepolia deployer is a DELEGATED EOA (EIP-7702): `--slow` is REQUIRED or the nonce
///      handling races. Run from `contracts/`:
///        forge script script/DeploySrkFaucet.s.sol:DeploySrkFaucet \
///          --rpc-url <base_sepolia> --private-key <deployer_key> --broadcast --slow
///
///      Re-running is safe but NOT idempotent: it deploys a fresh faucet. To only top the float up,
///      set FAUCET_ADDRESS and the script skips deployment.
contract DeploySrkFaucet is Script {
    /// @notice SRK per claim (18 dp) — the client-decided 5,000 SRK.
    uint256 public constant CLAIM_AMOUNT = 5_000 ether;
    /// @notice Per-address cooldown — 24 hours.
    uint256 public constant COOLDOWN = 24 hours;
    /// @notice Float transferred at deploy: 10,000,000 SRK = 2,000 claims.
    uint256 public constant FLOAT = 10_000_000 ether;
    /// @notice The client's demo admin wallet, seeded as a parameter admin alongside the deployer.
    address public constant CLIENT_DEMO_ADMIN = 0x32Ed4400C5BBB394712c482F1207886d8C22e8b5;

    function run() external returns (address faucetAddr) {
        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), "/addresses.json");
        address srk = vm.parseJsonAddress(vm.readFile(path), ".SRK");
        require(srk != address(0), "SRK address missing from the deployment record");

        address deployer = msg.sender;
        uint256 deployerBalance = IERC20(srk).balanceOf(deployer);
        console2.log("chainId          ", block.chainid);
        console2.log("SRK              ", srk);
        console2.log("deployer         ", deployer);
        console2.log("deployer SRK bal ", deployerBalance);
        require(deployerBalance >= FLOAT, "deployer holds less SRK than the intended float");

        faucetAddr = vm.envOr("FAUCET_ADDRESS", address(0));

        vm.startBroadcast();

        if (faucetAddr == address(0)) {
            address[] memory initialAdmins = new address[](2);
            initialAdmins[0] = deployer;
            initialAdmins[1] = CLIENT_DEMO_ADMIN;
            SrkFaucet faucet = new SrkFaucet(srk, CLAIM_AMOUNT, COOLDOWN, initialAdmins);
            faucetAddr = address(faucet);
            console2.log("SrkFaucet deployed", faucetAddr);
        } else {
            console2.log("SrkFaucet (existing, top-up only)", faucetAddr);
        }

        IERC20(srk).transfer(faucetAddr, FLOAT);

        vm.stopBroadcast();

        SrkFaucet f = SrkFaucet(faucetAddr);
        console2.log("  token          ", address(f.token()));
        console2.log("  owner          ", f.owner());
        console2.log("  claimAmount    ", f.claimAmount());
        console2.log("  cooldown       ", f.cooldown());
        console2.log("  float          ", f.available());
        console2.log("  claimsRemaining", f.claimsRemaining());
        console2.log("  admin(deployer)", f.isAdmin(deployer));
        console2.log("  admin(client)  ", f.isAdmin(CLIENT_DEMO_ADMIN));

        string memory value = string.concat('"', vm.toString(faucetAddr), '"');
        vm.writeJson(value, path, ".SrkFaucet");
        console2.log("wrote .SrkFaucet to", path);
    }
}
