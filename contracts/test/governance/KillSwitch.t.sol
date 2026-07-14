// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { KillSwitch } from "../../src/governance/KillSwitch.sol";

contract KillSwitchTest is Test {
    KillSwitch internal kill;
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        kill = new KillSwitch(guardian);
    }

    function test_guardianCanPauseAndUnpause() public {
        assertFalse(kill.paused());
        vm.prank(guardian);
        kill.pause();
        assertTrue(kill.paused());
        vm.prank(guardian);
        kill.unpause();
        assertFalse(kill.paused());
    }

    function test_onlyGuardianCanPause() public {
        vm.prank(stranger);
        vm.expectRevert(KillSwitch.NotGuardian.selector);
        kill.pause();
    }
}
