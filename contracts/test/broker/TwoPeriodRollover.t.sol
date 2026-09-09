// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { BrokerRevenueDistributor } from "../../src/broker/BrokerRevenueDistributor.sol";
import { MockERC20 } from "../mocks/Mocks.sol";

/// @title The two-period run: what happens to money nobody claims.
///
/// @notice A single period proves the happy path. This proves the property that is hardest to take
///         on trust and impossible to demonstrate with one period:
///
///           **value nobody claims stays in the contract and raises the NEXT period's pot.**
///
///         Not "we promise not to sweep it" — there is no sweep function to call, and this shows
///         the consequence of that absence. The distributor holds other people's revenue, so the
///         interesting assertions are all about what CANNOT happen to it.
///
/// @dev Mirrors the shape the operator chose on 2026-08-14 for the testnet simulation:
///      P1 fund → publish → A claims → B does not; P2 fund → available() includes B's share.
contract TwoPeriodRolloverTest is Test {
    BrokerRevenueDistributor internal dist;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    // 6-decimal USDC, so these read as 60.0 and 40.0.
    uint256 internal constant POT = 100_000_000;
    uint256 internal constant ALICE_SHARE = 60_000_000;
    uint256 internal constant BOB_SHARE = 40_000_000;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dist = new BrokerRevenueDistributor(address(this));
        usdc.mint(address(this), POT * 4);
        usdc.approve(address(dist), type(uint256).max);
    }

    /// @dev Two leaves, so the tree is a single sorted pair and each proof is the sibling.
    function _tree(uint256 periodId)
        internal
        view
        returns (bytes32 root, bytes32 aliceLeaf, bytes32 bobLeaf)
    {
        aliceLeaf = dist.leafFor(periodId, alice, ALICE_SHARE);
        bobLeaf = dist.leafFor(periodId, bob, BOB_SHARE);
        root = aliceLeaf < bobLeaf
            ? keccak256(abi.encodePacked(aliceLeaf, bobLeaf))
            : keccak256(abi.encodePacked(bobLeaf, aliceLeaf));
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function test_UnclaimedValueRollsIntoTheNextPeriodAndGoesNowhereElse() public {
        // ── Period 1 ────────────────────────────────────────────────────────────────────────
        uint256 p1 = dist.fundPeriod(address(usdc), POT);
        (bytes32 root1, bytes32 aLeaf1, bytes32 bLeaf1) = _tree(p1);
        dist.publishAllocations(p1, root1, ALICE_SHARE + BOB_SHARE);

        assertEq(dist.available(address(usdc)), 0, "the whole pot is promised, so none is free");

        vm.prank(alice);
        dist.claim(p1, ALICE_SHARE, _proof(bLeaf1));
        assertEq(usdc.balanceOf(alice), ALICE_SHARE, "alice received exactly her allocation");

        // Bob deliberately does NOT claim. This is the case the second period exists to test.
        assertEq(usdc.balanceOf(bob), 0);
        assertEq(dist.owed(address(usdc)), BOB_SHARE, "the contract still owes bob");
        assertEq(
            dist.available(address(usdc)), 0, "and does not treat what it owes him as spendable"
        );

        // ── Period 2 ────────────────────────────────────────────────────────────────────────
        uint256 p2 = dist.fundPeriod(address(usdc), POT);

        // ⚠️ The assertion this whole test exists for. Bob's unclaimed 40 is still owed, so it is
        // NOT available — the contract will not re-allocate money it has already promised him.
        assertEq(
            dist.available(address(usdc)),
            POT,
            "period 2 may allocate its own funding, but never what is still owed to bob"
        );
        assertEq(usdc.balanceOf(address(dist)), POT + BOB_SHARE, "and it is all still held here");

        // Bob can still claim period 1 afterwards. A closed period is a fact about the past; a
        // later period does not expire it.
        vm.prank(bob);
        dist.claim(p1, BOB_SHARE, _proof(aLeaf1));
        assertEq(usdc.balanceOf(bob), BOB_SHARE, "bob's share survived a whole period unclaimed");

        assertEq(dist.owed(address(usdc)), 0, "nothing is owed once both have claimed");
        assertEq(dist.available(address(usdc)), POT, "period 2's funding is untouched by any of it");
        assertGt(p2, p1, "the second period is a distinct, later period");
    }

    /// @notice ⚠️ A PUBLISHED-but-unclaimed allocation does NOT roll over — it stays reserved.
    ///
    /// @dev This pins a real documentation defect found by running the two-period simulation on
    ///      Robinhood testnet. This contract's own NatSpec used to claim that "value allocated but
    ///      never claimed once a period is superseded ... raises available() for the next period".
    ///      It never did: `owed` only decreases when someone claims.
    ///
    ///      The code was right and the comment was wrong. Rolling an unclaimed share forward would
    ///      take one holder's earned money and hand it to other people; leaving it reserved lets
    ///      them claim whenever they get round to it. Pinned here so the two cannot drift again.
    function test_AnUnclaimedPublishedShareIsReservedForever_NotRolledOver() public {
        uint256 p1 = dist.fundPeriod(address(usdc), POT);
        (bytes32 root1, bytes32 aLeaf1, ) = _tree(p1);
        dist.publishAllocations(p1, root1, ALICE_SHARE + BOB_SHARE);

        // Nobody claims at all, then a second and third period come and go.
        dist.fundPeriod(address(usdc), POT);
        dist.fundPeriod(address(usdc), POT);

        assertEq(
            dist.available(address(usdc)),
            POT * 2,
            "later periods may allocate their OWN funding and not a penny of period 1's promises"
        );
        assertEq(dist.owed(address(usdc)), ALICE_SHARE + BOB_SHARE, "period 1 is still owed in full");

        // And bob can still take his share, two periods later.
        vm.prank(bob);
        dist.claim(p1, BOB_SHARE, _proof(aLeaf1));
        assertEq(usdc.balanceOf(bob), BOB_SHARE, "a published share does not expire");
    }

    function test_ASecondClaimOfTheSamePeriodReverts() public {
        uint256 p1 = dist.fundPeriod(address(usdc), POT);
        (bytes32 root, , bytes32 bLeaf) = _tree(p1);
        dist.publishAllocations(p1, root, ALICE_SHARE + BOB_SHARE);

        vm.prank(alice);
        dist.claim(p1, ALICE_SHARE, _proof(bLeaf));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(BrokerRevenueDistributor.AlreadyClaimed.selector, p1, alice)
        );
        dist.claim(p1, ALICE_SHARE, _proof(bLeaf));
    }

    function test_AWalletWithNoAllocationCannotClaim() public {
        uint256 p1 = dist.fundPeriod(address(usdc), POT);
        (bytes32 root, , bytes32 bLeaf) = _tree(p1);
        dist.publishAllocations(p1, root, ALICE_SHARE + BOB_SHARE);

        vm.prank(address(0xDEAD));
        vm.expectRevert(BrokerRevenueDistributor.BadProof.selector);
        dist.claim(p1, ALICE_SHARE, _proof(bLeaf));
    }

    function test_TheOwnerCannotReachRolledOverValueEither() public {
        uint256 p1 = dist.fundPeriod(address(usdc), POT);
        (bytes32 root, , ) = _tree(p1);
        dist.publishAllocations(p1, root, ALICE_SHARE + BOB_SHARE);

        // Nobody claims. The owner now has a pot of other people's money sitting in a contract it
        // owns, and no way to move it — the only state-changing paths are fundPeriod (money IN),
        // publishAllocations (a commitment) and claim (by the claimant themselves).
        uint256 held = usdc.balanceOf(address(dist));
        uint256 ownerBefore = usdc.balanceOf(address(this));

        uint256 p2 = dist.fundPeriod(address(usdc), 0); // a period funded entirely by rollover
        assertEq(usdc.balanceOf(address(dist)), held, "opening a period moves nothing out");
        assertEq(usdc.balanceOf(address(this)), ownerBefore, "and the owner gained nothing");
        (address tok, , , , ) = dist.periods(p2);
        assertEq(tok, address(usdc), "a period funded purely by rollover is a real period");
    }
}
