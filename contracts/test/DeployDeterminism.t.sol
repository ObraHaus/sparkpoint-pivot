// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { KillSwitch } from "../src/governance/KillSwitch.sol";

/// @title DeployDeterminismTest — proves the deploy script's fixed CREATE2 salt gives DETERMINISTIC
///        addresses, so redeploys of the same bytecode + constructor args + deployer don't churn
///        contract addresses. CREATE2 changes only the deploy METHOD; the runtime bytecode is
///        unchanged and nothing becomes upgradeable (the vault stays immutable + non-custodial).
contract DeployDeterminismTest is Test {
    // Must match DeploySepolia.SALT.
    bytes32 internal constant SALT = keccak256("sparkpoint-core-v1");
    address internal guardian = makeAddr("guardian");

    function test_create2AddressIsDeterministic() public {
        KillSwitch a = new KillSwitch{ salt: SALT }(guardian);
        // The deployed address is a PURE function of (salt, initcode, deployer) — so the same
        // bytecode + args + salt + deployer always lands at the SAME address (no churn on redeploy).
        bytes32 initHash = keccak256(abi.encodePacked(type(KillSwitch).creationCode, abi.encode(guardian)));
        // 3-arg form: this test contract is the CREATE2 deployer here (in the real script it's the
        // canonical 0x4e59… factory, which is likewise deterministic).
        assertEq(
            address(a),
            vm.computeCreate2Address(SALT, initHash, address(this)),
            "not the deterministic address"
        );
    }

    function test_differentArgsYieldDifferentAddress() public {
        KillSwitch a = new KillSwitch{ salt: SALT }(guardian);
        KillSwitch b = new KillSwitch{ salt: SALT }(makeAddr("other-guardian"));
        // A genuinely different deployment (different constructor args) correctly gets a new address.
        assertTrue(address(a) != address(b), "different args must yield a different address");
    }
}
