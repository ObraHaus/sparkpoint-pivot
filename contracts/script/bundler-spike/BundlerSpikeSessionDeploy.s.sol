// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

import { SparkPointAccount } from "../../src/account/SparkPointAccount.sol";
import { SessionKeyValidator } from "../../src/account/SessionKeyValidator.sol";
import { PolicyModule } from "../../src/account/PolicyModule.sol";
import { AccountFactory } from "../../src/account/AccountFactory.sol";
import { IPolicyModule } from "../../src/interfaces/IPolicyModule.sol";

/// @title BundlerSpikeSessionDeploy — SESSION-KEY variant of the bundler spike (item 6 / P1.5).
/// @notice Same stack as BundlerSpikeDeploy, but ADDITIONALLY: (a) seeds the global allowlist for the
///         vault `deposit(uint256,address)` selector, and (b) authorizes ONE session key with a policy
///         permitting that deposit. This lets us submit a MODE-0x01 (session-key) UserOp through a REAL
///         bundler in SAFE-MODE and observe whether the `recordSpend`-in-validation write to the
///         (external) PolicyModule violates the ERC-7562 validation storage rules — the exact question
///         the SessionKeyValidator's "bundler-compliant (account-associated storage)" claim asserts.
///
///         SPIKE-ONLY, local Anvil fork; NEVER broadcasts to any mainnet. The session validation is
///         self-contained (policy checks + the recordSpend storage write) — it does not call the vault —
///         so the 7562 storage-rule outcome is independent of whether the deposit could execute.
/// @dev Env: SPIKE_OWNER (address, broadcaster), SPIKE_DEPLOYER_PK (uint), SPIKE_SESSION_KEY (address).
contract BundlerSpikeSessionDeploy is Script {
    address internal constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032; // v0.7 singleton
    // The live Base-Sepolia SparkPointVault (exists on the fork). Only used as the allowlisted deposit
    // TARGET for the session policy; validation decodes the calldata + checks policy, it does not call it.
    address internal constant VAULT = 0x15D269B1D4fb3581E5a47482A70215e63Ed547f2;
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)

    function run() external {
        address owner = vm.envAddress("SPIKE_OWNER");
        uint256 deployerPk = vm.envUint("SPIKE_DEPLOYER_PK");
        address sessionKey = vm.envAddress("SPIKE_SESSION_KEY");
        require(ENTRYPOINT.code.length > 0, "EntryPoint v0.7 singleton missing on fork");

        vm.startBroadcast(deployerPk);

        // admin == owner (PolicyModule(owner)); the account's owner == owner too.
        PolicyModule policy = new PolicyModule(owner);
        SessionKeyValidator validator = new SessionKeyValidator(address(policy));
        policy.setSessionValidator(address(validator));

        SparkPointAccount impl =
            new SparkPointAccount(IEntryPoint(ENTRYPOINT), address(validator), address(policy));
        AccountFactory factory = new AccountFactory(address(impl));
        address account = factory.createAccount(owner, 0);

        // (a) seed the global allowlist for the vault deposit (admin surface).
        policy.setAllowedTarget(VAULT, SEL_VAULT_DEPOSIT, true);

        // (b) authorize ONE session key with a policy that admits the deposit (owner-only → the account
        //     calls registerSession). Window is a day out (validUntil != 0), caps generous, slippage n/a.
        IPolicyModule.Policy memory p = IPolicyModule.Policy({
            sessionKey: sessionKey,
            validAfter: 0,
            validUntil: uint48(block.timestamp + 1 days),
            perTxCap: 500e6,
            cumulativeCap: 5000e6,
            spent: 0,
            maxSlippageBps: 50,
            revoked: false
        });
        SparkPointAccount(payable(account)).authorizeSessionKey(p);

        // Prefund the account's EntryPoint gas deposit so the bundler can be repaid at handleOps time.
        IEntryPoint(ENTRYPOINT).depositTo{ value: 1 ether }(account);

        vm.stopBroadcast();

        console2.log("SPIKE_POLICY=%s", address(policy));
        console2.log("SPIKE_VALIDATOR=%s", address(validator));
        console2.log("SPIKE_FACTORY=%s", address(factory));
        console2.log("SPIKE_ACCOUNT=%s", account);
        console2.log("SPIKE_VAULT=%s", VAULT);
        console2.log("SPIKE_SESSION_KEY_OUT=%s", sessionKey);
    }
}
