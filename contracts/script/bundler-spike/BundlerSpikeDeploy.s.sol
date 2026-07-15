// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

import { SparkPointAccount } from "../../src/account/SparkPointAccount.sol";
import { SessionKeyValidator } from "../../src/account/SessionKeyValidator.sol";
import { PolicyModule } from "../../src/account/PolicyModule.sol";
import { AccountFactory } from "../../src/account/AccountFactory.sol";

/// @title BundlerSpikeDeploy — ITEM 8 (R10/OQ-2) bundler-spike infra deploy (SPIKE-ONLY, local fork).
/// @notice Deploys the account stack (PolicyModule, SessionKeyValidator, SparkPointAccount impl,
///         AccountFactory) onto a LOCAL Anvil fork of Base Sepolia, creates ONE account owned by
///         `SPIKE_OWNER`, and prefunds its EntryPoint gas deposit. This mirrors the setUp of
///         test/account/integration/SessionDepositFork.t.sol but broadcasts to the local node so a
///         real ERC-4337 bundler (Alto) can bundle a UserOp against it. It NEVER touches mainnet and
///         is not part of the deployed vault runtime — it is a de-risking spike for Phase-3 AA.
/// @dev Env: SPIKE_OWNER (address, also the broadcaster), SPIKE_DEPLOYER_PK (uint). Run against the
///      local Anvil RPC only. The v0.7 EntryPoint singleton must already exist on the fork (it does on
///      Base Sepolia). Addresses are emitted via console2 for the orchestrator to parse.
contract BundlerSpikeDeploy is Script {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032; // v0.7 singleton

    function run() external {
        address owner = vm.envAddress("SPIKE_OWNER");
        uint256 deployerPk = vm.envUint("SPIKE_DEPLOYER_PK");
        require(ENTRYPOINT.code.length > 0, "EntryPoint v0.7 singleton missing on fork");

        vm.startBroadcast(deployerPk);

        PolicyModule policy = new PolicyModule(owner);
        SessionKeyValidator validator = new SessionKeyValidator(address(policy));
        policy.setSessionValidator(address(validator));

        SparkPointAccount impl =
            new SparkPointAccount(IEntryPoint(ENTRYPOINT), address(validator), address(policy));
        AccountFactory factory = new AccountFactory(address(impl));

        address account = factory.createAccount(owner, 0);

        // Prefund the account's EntryPoint gas deposit so the bundler can be repaid at handleOps time.
        IEntryPoint(ENTRYPOINT).depositTo{ value: 1 ether }(account);

        vm.stopBroadcast();

        // Machine-parseable markers (grepped by run-spike.sh).
        console2.log("SPIKE_POLICY=%s", address(policy));
        console2.log("SPIKE_VALIDATOR=%s", address(validator));
        console2.log("SPIKE_IMPL=%s", address(impl));
        console2.log("SPIKE_FACTORY=%s", address(factory));
        console2.log("SPIKE_ACCOUNT=%s", account);
        console2.log("SPIKE_OWNER_OUT=%s", owner);
    }
}
