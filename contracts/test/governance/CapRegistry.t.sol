// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";

contract CapRegistryTest is Test {
    CapRegistry internal caps;
    address internal governance = makeAddr("governance");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        caps = new CapRegistry(governance, 5_000e6, 1_000_000e6, 1_000_000e6);
    }

    function test_defaultsAndCeilings() public view {
        assertEq(caps.perUserCap(), 5_000e6);
        assertEq(caps.totalCap(), 1_000_000e6);
        assertEq(caps.vaultCap(), 1_000_000e6);
        assertEq(caps.PER_USER_CEILING(), 10_000e6);
        assertEq(caps.TOTAL_CEILING(), 5_000_000e6);
        assertEq(caps.VAULT_CEILING(), 5_000_000e6);
    }

    function test_constructorRevertsAboveCeiling() public {
        vm.expectRevert(CapRegistry.CapAboveCeiling.selector);
        new CapRegistry(governance, 10_000e6 + 1, 1_000_000e6, 1_000_000e6);
    }

    function test_governanceCanRaiseWithinCeiling() public {
        vm.prank(governance);
        caps.setPerUserCap(10_000e6);
        assertEq(caps.perUserCap(), 10_000e6);
    }

    function test_setterRevertsAboveCeiling() public {
        vm.prank(governance);
        vm.expectRevert(CapRegistry.CapAboveCeiling.selector);
        caps.setPerUserCap(10_000e6 + 1);
    }

    function test_onlyGovernanceCanSet() public {
        vm.prank(stranger);
        vm.expectRevert(CapRegistry.NotGovernance.selector);
        caps.setPerUserCap(1);
    }
}
