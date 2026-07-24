// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

import { PolicyModule } from "../src/account/PolicyModule.sol";
import { SessionKeyValidator } from "../src/account/SessionKeyValidator.sol";
import { SparkPointAccount } from "../src/account/SparkPointAccount.sol";
import { AccountFactory } from "../src/account/AccountFactory.sol";
import { SessionScopeLib } from "../src/account/SessionScopeLib.sol";

/// @title DeploySessionStack — Base Sepolia (84532) deploy of the US6 ERC-4337 session-key stack.
/// @notice Deploys, in one broadcast: the (stateless) PolicyModule (global arming allowlist), the
///         view-only SessionKeyValidator parity mirror, the SparkPointAccount implementation, and the
///         CREATE2 AccountFactory — then arms the global `(target,selector)` allowlist so an owner can
///         later draw a session scope from it. This is the "Path A" stack (feature 022): all per-session
///         state lives in the account's own storage, so `validateUserOp` is ERC-7562-compliant and the
///         session-key UserOp validates on the real Alchemy Base-Sepolia bundler.
/// @dev NO key here is a fund path (N1/N3). The PolicyModule admin (arming authority) is the deployer;
///      it can ONLY arm/disarm allowlist pairs (it holds no assets and can never move funds). Env:
///      DEPLOYER_PRIVATE_KEY (broadcaster, via --private-key or keystore); ENTRYPOINT (default = the v0.7
///      singleton); SPARKPOINT_VAULT_ADDRESS (default = the live Base-Sepolia vault); optional
///      AAVE_POOL / AERODROME_ROUTER to also arm those pairs. Deploy gotcha: a delegated EOA needs
///      `--slow`. Run (NO broadcast) first: `forge script script/DeploySessionStack.s.sol --rpc-url $RPC`.
contract DeploySessionStack is Script {
    /// @dev EntryPoint v0.7 singleton — confirmed live on Base Sepolia (eth_supportedEntryPoints).
    address internal constant DEFAULT_ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    /// @dev The live Base-Sepolia SparkPointVault (ERC-4626) — the launch session-scope target.
    address internal constant DEFAULT_VAULT = 0x15D269B1D4fb3581E5a47482A70215e63Ed547f2;

    /// @dev CREATE2 salt — a fixed version tag keeps redeploys of the SAME bytecode + args at the SAME
    ///      addresses (no churn). Bump only to intentionally mint a fresh, distinct stack.
    bytes32 internal constant SALT = keccak256("sparkpoint-session-stack-v1");

    function run() external {
        address entryPoint = vm.envOr("ENTRYPOINT", DEFAULT_ENTRYPOINT);
        address vault = vm.envOr("SPARKPOINT_VAULT_ADDRESS", DEFAULT_VAULT);
        address aavePool = vm.envOr("AAVE_POOL", address(0));
        address aeroRouter = vm.envOr("AERODROME_ROUTER", address(0));
        require(entryPoint.code.length > 0, "EntryPoint singleton missing on this chain");

        vm.startBroadcast();
        address deployer = msg.sender;

        // 1 ── Stateless global arming allowlist (admin = deployer; holds no assets, no fund path).
        PolicyModule policy = new PolicyModule{ salt: SALT }(deployer);
        // 2 ── View-only parity mirror (informational pointer to the arming allowlist).
        SessionKeyValidator validator = new SessionKeyValidator{ salt: SALT }(address(policy));
        // 3 ── Account implementation (immutable EntryPoint pin + validator + policy references).
        SparkPointAccount impl = new SparkPointAccount{ salt: SALT }(
            IEntryPoint(entryPoint), address(validator), address(policy)
        );
        // 4 ── CREATE2 factory (one counterfactual account per (owner, salt); N3).
        AccountFactory factory = new AccountFactory{ salt: SALT }(address(impl));

        // 5 ── Arm the global allowlist. The launch scope is the vault's ERC-4626 enter/exit selectors;
        //      Aave + Aerodrome pairs are armed only if their targets are provided (still session-scoped
        //      per grant). approve/transfer/transferFrom/empty can never be armed (guarded by construction).
        policy.setAllowedTarget(vault, SessionScopeLib.SEL_VAULT_DEPOSIT, true);
        policy.setAllowedTarget(vault, SessionScopeLib.SEL_VAULT_REDEEM, true);
        policy.setAllowedTarget(vault, SessionScopeLib.SEL_VAULT_WITHDRAW, true);
        if (aavePool != address(0)) {
            policy.setAllowedTarget(aavePool, SessionScopeLib.SEL_AAVE_SUPPLY, true);
            policy.setAllowedTarget(aavePool, SessionScopeLib.SEL_AAVE_WITHDRAW, true);
        }
        if (aeroRouter != address(0)) {
            policy.setAllowedTarget(aeroRouter, SessionScopeLib.SEL_AERO_SWAP, true);
        }

        vm.stopBroadcast();

        console2.log("EntryPoint          ", entryPoint);
        console2.log("PolicyModule        ", address(policy));
        console2.log("SessionKeyValidator ", address(validator));
        console2.log("SparkPointAccountImpl", address(impl));
        console2.log("AccountFactory      ", address(factory));
        console2.log("armed vault         ", vault);
        console2.log("armed aavePool      ", aavePool);
        console2.log("armed aeroRouter    ", aeroRouter);
        console2.log("policy admin        ", deployer);

        _writeAddresses(entryPoint, address(policy), address(validator), address(impl), address(factory), vault);
    }

    function _writeAddresses(
        address entryPoint,
        address policy,
        address validator,
        address impl,
        address factory,
        address vault
    ) internal {
        string memory dir = string.concat("deployments/", vm.toString(block.chainid));
        vm.createDir(dir, true);
        string memory key = "sparkpoint-session-stack";
        vm.serializeAddress(key, "EntryPoint", entryPoint);
        vm.serializeAddress(key, "PolicyModule", policy);
        vm.serializeAddress(key, "SessionKeyValidator", validator);
        vm.serializeAddress(key, "SparkPointAccountImpl", impl);
        vm.serializeAddress(key, "AccountFactory", factory);
        string memory json = vm.serializeAddress(key, "armedVault", vault);
        string memory path = string.concat(dir, "/session-stack.json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
