// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { SparkPointTestToken } from "../../src/token/SparkPointTestToken.sol";
import { SrkFaucet } from "../../src/token/SrkFaucet.sol";

/// @notice Unit + FUZZ for the standalone SRK dispenser (feature 026). Proves: a claim pays exactly
///         `claimAmount` out of the pre-funded float; the per-address cooldown is enforced and names
///         the wait; parameter setters are gated to owner-OR-admin while the float + admin roster are
///         owner-only; every parameter change emits; withdraw returns the float; and — the property
///         that matters — the faucet can never create SRK, so the token's fixed supply is untouched.
contract SrkFaucetTest is Test {
    SparkPointTestToken internal srk;
    SrkFaucet internal faucet;

    address internal owner = address(this);
    address internal adminA = address(0xA11CE);
    address internal stranger = address(0xBEEF);
    address internal claimant = address(0xC1A1);

    uint256 internal constant CLAIM_AMOUNT = 5_000 ether;
    uint256 internal constant COOLDOWN = 24 hours;
    uint256 internal constant FLOAT = 10_000_000 ether;

    event Claimed(address indexed claimant, uint256 amount, uint256 nextClaimAt);
    event ClaimAmountSet(address indexed by, uint256 previousAmount, uint256 newAmount);
    event CooldownSet(address indexed by, uint256 previousCooldown, uint256 newCooldown);
    event AdminSet(address indexed by, address indexed admin, bool allowed);
    event Withdrawn(address indexed by, address indexed to, uint256 amount);

    function setUp() public {
        srk = new SparkPointTestToken(); // whole fixed supply mints to this test contract
        address[] memory initialAdmins = new address[](1);
        initialAdmins[0] = adminA;
        faucet = new SrkFaucet(address(srk), CLAIM_AMOUNT, COOLDOWN, initialAdmins);
        srk.transfer(address(faucet), FLOAT);
        // Timestamps start at 1 in forge; move well past 0 so "never claimed" is unambiguous.
        vm.warp(1_700_000_000);
    }

    /* ---------------------------------- wiring ---------------------------------- */

    function test_ConstructorWiring() public view {
        assertEq(address(faucet.token()), address(srk));
        assertEq(faucet.owner(), owner);
        assertEq(faucet.claimAmount(), CLAIM_AMOUNT);
        assertEq(faucet.cooldown(), COOLDOWN);
        assertTrue(faucet.admins(adminA));
        assertFalse(faucet.admins(stranger));
        assertTrue(faucet.isAdmin(owner), "owner is implicitly an admin");
        assertTrue(faucet.isAdmin(adminA));
        assertFalse(faucet.isAdmin(stranger));
        assertEq(faucet.available(), FLOAT);
        assertEq(faucet.claimsRemaining(), FLOAT / CLAIM_AMOUNT);
    }

    function test_ConstructorRejectsZeroTokenAndOverlongCooldown() public {
        address[] memory none = new address[](0);
        vm.expectRevert(SrkFaucet.ZeroAddress.selector);
        new SrkFaucet(address(0), CLAIM_AMOUNT, COOLDOWN, none);

        uint256 tooLong = 366 days;
        vm.expectRevert(
            abi.encodeWithSelector(SrkFaucet.CooldownTooLong.selector, tooLong, 365 days)
        );
        new SrkFaucet(address(srk), CLAIM_AMOUNT, tooLong, none);
    }

    function test_ConstructorRejectsZeroAdmin() public {
        address[] memory bad = new address[](1);
        bad[0] = address(0);
        vm.expectRevert(SrkFaucet.ZeroAddress.selector);
        new SrkFaucet(address(srk), CLAIM_AMOUNT, COOLDOWN, bad);
    }

    /* ---------------------------------- claiming --------------------------------- */

    function test_ClaimPaysExactlyClaimAmountAndEmits() public {
        vm.expectEmit(true, false, false, true, address(faucet));
        emit Claimed(claimant, CLAIM_AMOUNT, block.timestamp + COOLDOWN);

        vm.prank(claimant);
        uint256 got = faucet.claim();

        assertEq(got, CLAIM_AMOUNT);
        assertEq(srk.balanceOf(claimant), CLAIM_AMOUNT);
        assertEq(faucet.available(), FLOAT - CLAIM_AMOUNT);
        assertEq(faucet.lastClaimAt(claimant), block.timestamp);
        assertEq(faucet.nextClaimAt(claimant), block.timestamp + COOLDOWN);
    }

    function test_CanClaimBeforeAndAfter() public {
        assertTrue(faucet.canClaim(claimant));
        assertEq(faucet.secondsUntilClaim(claimant), 0);

        vm.prank(claimant);
        faucet.claim();

        assertFalse(faucet.canClaim(claimant));
        assertEq(faucet.secondsUntilClaim(claimant), COOLDOWN);
    }

    function test_SecondClaimWithinCooldownRevertsNamingTheWait() public {
        vm.prank(claimant);
        faucet.claim();
        uint256 availableAt = block.timestamp + COOLDOWN;

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                SrkFaucet.CooldownActive.selector, availableAt, availableAt - block.timestamp
            )
        );
        vm.prank(claimant);
        faucet.claim();
    }

    function test_ClaimSucceedsExactlyAtTheBoundary() public {
        vm.prank(claimant);
        faucet.claim();
        uint256 availableAt = faucet.nextClaimAt(claimant);

        // one second short — still blocked
        vm.warp(availableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.CooldownActive.selector, availableAt, 1));
        vm.prank(claimant);
        faucet.claim();

        // exactly at the boundary — allowed
        vm.warp(availableAt);
        vm.prank(claimant);
        faucet.claim();
        assertEq(srk.balanceOf(claimant), 2 * CLAIM_AMOUNT);
    }

    /// @dev The cooldown is PER ADDRESS — one claimant must never block another.
    function test_CooldownIsPerAddress() public {
        vm.prank(claimant);
        faucet.claim();

        vm.prank(stranger);
        faucet.claim();

        assertEq(srk.balanceOf(stranger), CLAIM_AMOUNT);
    }

    function test_ClaimRevertsWhenPaused() public {
        faucet.setClaimAmount(0);
        assertFalse(faucet.canClaim(claimant));

        vm.expectRevert(SrkFaucet.FaucetPaused.selector);
        vm.prank(claimant);
        faucet.claim();
    }

    function test_ClaimRevertsWhenFloatIsShort() public {
        faucet.withdraw(owner, 0); // drain
        assertEq(faucet.available(), 0);
        assertFalse(faucet.canClaim(claimant));

        vm.expectRevert(
            abi.encodeWithSelector(SrkFaucet.InsufficientFloat.selector, 0, CLAIM_AMOUNT)
        );
        vm.prank(claimant);
        faucet.claim();
    }

    /* -------------------------------- admin gating ------------------------------- */

    function test_OwnerAndAdminCanSetParams_StrangerCannot() public {
        vm.expectEmit(true, false, false, true, address(faucet));
        emit ClaimAmountSet(owner, CLAIM_AMOUNT, 1_000 ether);
        faucet.setClaimAmount(1_000 ether);
        assertEq(faucet.claimAmount(), 1_000 ether);

        vm.expectEmit(true, false, false, true, address(faucet));
        emit CooldownSet(adminA, COOLDOWN, 1 hours);
        vm.prank(adminA);
        faucet.setCooldown(1 hours);
        assertEq(faucet.cooldown(), 1 hours);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotAdmin.selector, stranger));
        vm.prank(stranger);
        faucet.setClaimAmount(1);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotAdmin.selector, stranger));
        vm.prank(stranger);
        faucet.setCooldown(1);
    }

    function test_SetCooldownRejectsOverlongValue() public {
        uint256 tooLong = 400 days;
        vm.expectRevert(
            abi.encodeWithSelector(SrkFaucet.CooldownTooLong.selector, tooLong, 365 days)
        );
        faucet.setCooldown(tooLong);
    }

    /// @dev An admin may retune params but must NOT be able to touch the float or the admin roster.
    function test_AdminCannotWithdrawOrGrantAdmin() public {
        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotOwner.selector, adminA));
        vm.prank(adminA);
        faucet.withdraw(adminA, 1);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotOwner.selector, adminA));
        vm.prank(adminA);
        faucet.setAdmin(stranger, true);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotOwner.selector, adminA));
        vm.prank(adminA);
        faucet.transferOwnership(adminA);
    }

    function test_OwnerGrantsAndRevokesAdmin() public {
        vm.expectEmit(true, true, false, true, address(faucet));
        emit AdminSet(owner, stranger, true);
        faucet.setAdmin(stranger, true);
        assertTrue(faucet.isAdmin(stranger));

        vm.prank(stranger);
        faucet.setClaimAmount(7 ether);
        assertEq(faucet.claimAmount(), 7 ether);

        faucet.setAdmin(stranger, false);
        assertFalse(faucet.isAdmin(stranger));
        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotAdmin.selector, stranger));
        vm.prank(stranger);
        faucet.setClaimAmount(8 ether);
    }

    function test_SetAdminRejectsZeroAddress() public {
        vm.expectRevert(SrkFaucet.ZeroAddress.selector);
        faucet.setAdmin(address(0), true);
    }

    function test_TransferOwnership() public {
        faucet.transferOwnership(adminA);
        assertEq(faucet.owner(), adminA);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotOwner.selector, owner));
        faucet.withdraw(owner, 1);

        vm.prank(adminA);
        faucet.withdraw(adminA, 1 ether);
        assertEq(srk.balanceOf(adminA), 1 ether);
    }

    function test_TransferOwnershipRejectsZeroAddress() public {
        vm.expectRevert(SrkFaucet.ZeroAddress.selector);
        faucet.transferOwnership(address(0));
    }

    /* ---------------------------------- withdraw --------------------------------- */

    function test_WithdrawPartialAndAll() public {
        vm.expectEmit(true, true, false, true, address(faucet));
        emit Withdrawn(owner, stranger, 100 ether);
        faucet.withdraw(stranger, 100 ether);
        assertEq(srk.balanceOf(stranger), 100 ether);
        assertEq(faucet.available(), FLOAT - 100 ether);

        uint256 sent = faucet.withdraw(owner, 0); // 0 == everything left
        assertEq(sent, FLOAT - 100 ether);
        assertEq(faucet.available(), 0);
    }

    function test_WithdrawOverFloatReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(SrkFaucet.InsufficientFloat.selector, FLOAT, FLOAT + 1)
        );
        faucet.withdraw(owner, FLOAT + 1);
    }

    function test_WithdrawRejectsZeroAddress() public {
        vm.expectRevert(SrkFaucet.ZeroAddress.selector);
        faucet.withdraw(address(0), 1);
    }

    /* ------------------------------------ fuzz ----------------------------------- */

    /// @dev Cooldown boundary: claiming is blocked for every second BEFORE `nextClaimAt` and allowed
    ///      at or after it — for any cooldown the admin can set.
    function testFuzz_CooldownBoundary(uint256 cd, uint256 elapsed) public {
        cd = bound(cd, 1, faucet.MAX_COOLDOWN());
        faucet.setCooldown(cd);

        vm.prank(claimant);
        faucet.claim();
        uint256 start = block.timestamp;
        uint256 availableAt = start + cd;

        elapsed = bound(elapsed, 0, 2 * cd);
        vm.warp(start + elapsed);

        if (block.timestamp < availableAt) {
            assertFalse(faucet.canClaim(claimant));
            assertEq(faucet.secondsUntilClaim(claimant), availableAt - block.timestamp);
            vm.expectRevert(
                abi.encodeWithSelector(
                    SrkFaucet.CooldownActive.selector, availableAt, availableAt - block.timestamp
                )
            );
            vm.prank(claimant);
            faucet.claim();
        } else {
            assertTrue(faucet.canClaim(claimant));
            assertEq(faucet.secondsUntilClaim(claimant), 0);
            vm.prank(claimant);
            faucet.claim();
            assertEq(srk.balanceOf(claimant), 2 * CLAIM_AMOUNT);
        }
    }

    /// @dev Shortening the cooldown applies to an ALREADY-recorded claim (nextClaimAt is derived,
    ///      not stored), so an admin can always unblock testers.
    function testFuzz_ShorteningCooldownUnblocksExistingClaimants(uint256 cd) public {
        vm.prank(claimant);
        faucet.claim();
        uint256 start = block.timestamp;

        cd = bound(cd, 0, COOLDOWN);
        faucet.setCooldown(cd);
        assertEq(faucet.nextClaimAt(claimant), start + cd);

        vm.warp(start + cd);
        assertTrue(faucet.canClaim(claimant));
    }

    /// @dev A claim moves float to the claimant and NEVER changes SRK's total supply — the faucet has
    ///      no mint path and the token has none either (spec-012 fixed-supply property).
    function testFuzz_ClaimPreservesTotalSupply(address who, uint256 amount) public {
        vm.assume(who != address(0) && who != address(faucet) && who != owner);
        amount = bound(amount, 1, FLOAT);
        faucet.setClaimAmount(amount);

        uint256 supply = srk.totalSupply();
        uint256 floatBefore = faucet.available();

        vm.prank(who);
        faucet.claim();

        assertEq(srk.totalSupply(), supply, "faucet must never change SRK supply");
        assertEq(faucet.available(), floatBefore - amount);
        assertEq(srk.balanceOf(who), amount);
    }

    /// @dev Non-admins can never move the parameters, whoever they are.
    function testFuzz_NonAdminCannotSetParams(address caller, uint256 value) public {
        vm.assume(caller != owner && caller != adminA);
        value = bound(value, 0, faucet.MAX_COOLDOWN());

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotAdmin.selector, caller));
        vm.prank(caller);
        faucet.setCooldown(value);

        vm.expectRevert(abi.encodeWithSelector(SrkFaucet.NotAdmin.selector, caller));
        vm.prank(caller);
        faucet.setClaimAmount(value);
    }
}
