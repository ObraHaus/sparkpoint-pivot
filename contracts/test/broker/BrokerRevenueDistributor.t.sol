// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { BrokerRevenueDistributor } from "../../src/broker/BrokerRevenueDistributor.sol";
import { SparkPointTestToken } from "../../src/token/SparkPointTestToken.sol";

/// @notice Unit + FUZZ for the revenue distributor (feature 044).
///
///         This contract holds protocol revenue that belongs to holders, so the tests are mostly
///         about what must be IMPOSSIBLE. The property that matters most is solvency —
///         `owed <= balance` for every token, at every point — because the failure it prevents is
///         the contract promising money it does not have and the last claimant finding an empty pot.
contract BrokerRevenueDistributorTest is Test {
    SparkPointTestToken internal usdc;
    BrokerRevenueDistributor internal dist;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal stranger = address(0xBEEF);

    event PeriodFunded(
        uint256 indexed periodId, address indexed token, uint256 added, uint256 available
    );
    event AllocationsPublished(
        uint256 indexed periodId, bytes32 merkleRoot, uint256 totalAllocated
    );
    event Claimed(
        uint256 indexed periodId, address indexed account, address indexed token, uint256 amount
    );

    function setUp() public {
        usdc = new SparkPointTestToken(); // stands in for the fee token; whole supply to this test
        dist = new BrokerRevenueDistributor(owner);
        usdc.approve(address(dist), type(uint256).max);
    }

    // ── a two-leaf tree, built the way the off-chain builder will ───────────────────────────

    function _leaf(uint256 periodId, address account, uint256 amount)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(periodId, account, amount));
    }

    /// OZ's MerkleProof sorts pairs, so the builder must too.
    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// Root of exactly two leaves, plus each one's proof.
    function _tree2(bytes32 l0, bytes32 l1)
        internal
        pure
        returns (bytes32 root, bytes32[] memory p0, bytes32[] memory p1)
    {
        root = _pair(l0, l1);
        p0 = new bytes32[](1);
        p0[0] = l1;
        p1 = new bytes32[](1);
        p1[0] = l0;
    }

    /// The worked example: Analyst 1.0x and Partner 3.3x sharing 4,300 units, 1000:3300.
    function _fundAndPublish(uint256 pot, uint256 aliceAmt, uint256 bobAmt)
        internal
        returns (uint256 periodId, bytes32[] memory pa, bytes32[] memory pb)
    {
        periodId = dist.fundPeriod(address(usdc), pot);
        bytes32 root;
        (root, pa, pb) = _tree2(_leaf(periodId, alice, aliceAmt), _leaf(periodId, bob, bobAmt));
        dist.publishAllocations(periodId, root, aliceAmt + bobAmt);
    }

    // ── the happy path ──────────────────────────────────────────────────────────────────────

    function test_AHolderClaimsExactlyWhatWasAllocated() public {
        (uint256 id, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);

        vm.expectEmit(true, true, true, true, address(dist));
        emit Claimed(id, alice, address(usdc), 1000);
        vm.prank(alice);
        dist.claim(id, 1000, pa);

        assertEq(usdc.balanceOf(alice), 1000);
        assertTrue(dist.claimed(id, alice));
    }

    /// The tier ratio, end to end: 1.0x and 3.3x split 4,300 as 1,000 : 3,300.
    function test_TheSplitFollowsTheTierWeights() public {
        (uint256 id, bytes32[] memory pa, bytes32[] memory pb) = _fundAndPublish(4300, 1000, 3300);
        vm.prank(alice);
        dist.claim(id, 1000, pa);
        vm.prank(bob);
        dist.claim(id, 3300, pb);

        assertEq(usdc.balanceOf(bob) * 10 / usdc.balanceOf(alice), 33, "3.3x, not 3x");
        assertEq(dist.owed(address(usdc)), 0, "everything promised was paid");
    }

    function test_ClaimingTwiceReverts() public {
        (uint256 id, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);
        vm.startPrank(alice);
        dist.claim(id, 1000, pa);
        vm.expectRevert(
            abi.encodeWithSelector(BrokerRevenueDistributor.AlreadyClaimed.selector, id, alice)
        );
        dist.claim(id, 1000, pa);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 1000, "and nothing more was paid");
    }

    // ── a proof cannot be bent ──────────────────────────────────────────────────────────────

    function test_SomeoneElsesProofDoesNotWork() public {
        (uint256 id, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);
        // Carol has no leaf; alice's proof does not become hers, because the caller IS the account.
        vm.prank(carol);
        vm.expectRevert(BrokerRevenueDistributor.BadProof.selector);
        dist.claim(id, 1000, pa);
        assertEq(usdc.balanceOf(carol), 0);
    }

    function test_ClaimingMoreThanAllocatedFails() public {
        (uint256 id, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);
        vm.prank(alice);
        vm.expectRevert(BrokerRevenueDistributor.BadProof.selector);
        dist.claim(id, 1001, pa);
    }

    function test_AProofFromOnePeriodDoesNotWorkInAnother() public {
        (, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);
        (uint256 id2,,) = _fundAndPublish(4300, 1000, 3300);
        // The periodId is inside the leaf, so a proof is bound to its period.
        vm.prank(alice);
        vm.expectRevert(BrokerRevenueDistributor.BadProof.selector);
        dist.claim(id2, 1000, pa);
    }

    // ── SOLVENCY: the property this contract exists to keep ─────────────────────────────────

    /// The contract may NEVER owe more than it holds — for any funding and any allocation.
    function testFuzz_OwedNeverExceedsBalance(uint96 pot, uint96 a, uint96 b) public {
        uint256 potV = bound(uint256(pot), 0, 1_000_000 ether);
        uint256 aV = bound(uint256(a), 0, 1_000_000 ether);
        uint256 bV = bound(uint256(b), 0, 1_000_000 ether);

        uint256 id = dist.fundPeriod(address(usdc), potV);
        (bytes32 root,,) = _tree2(_leaf(id, alice, aV), _leaf(id, bob, bV));

        uint256 free = dist.available(address(usdc));
        if (aV + bV > free) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    BrokerRevenueDistributor.AllocationExceedsAvailable.selector, aV + bV, free
                )
            );
            dist.publishAllocations(id, root, aV + bV);
        } else {
            dist.publishAllocations(id, root, aV + bV);
        }

        assertLe(
            dist.owed(address(usdc)),
            usdc.balanceOf(address(dist)),
            "THE CONTRACT MUST NEVER OWE MORE THAN IT HOLDS"
        );
    }

    function test_PublishingMoreThanIsHereReverts() public {
        uint256 id = dist.fundPeriod(address(usdc), 1000);
        (bytes32 root,,) = _tree2(_leaf(id, alice, 900), _leaf(id, bob, 200));
        vm.expectRevert(
            abi.encodeWithSelector(
                BrokerRevenueDistributor.AllocationExceedsAvailable.selector, 1100, 1000
            )
        );
        dist.publishAllocations(id, root, 1100);
    }

    /// Two live periods cannot double-spend the same balance.
    function test_ASecondPeriodCannotAllocateWhatTheFirstAlreadyPromised() public {
        (uint256 id1,,) = _fundAndPublish(1000, 600, 400); // all 1000 promised
        uint256 id2 = dist.fundPeriod(address(usdc), 0); // rollover only — nothing free
        assertEq(dist.available(address(usdc)), 0, "the first period's promise is not available");

        (bytes32 root,,) = _tree2(_leaf(id2, alice, 1), _leaf(id2, bob, 0));
        vm.expectRevert(
            abi.encodeWithSelector(
                BrokerRevenueDistributor.AllocationExceedsAvailable.selector, 1, 0
            )
        );
        dist.publishAllocations(id2, root, 1);
        assertGt(id1, 0);
    }

    // ── rollover happens by default ─────────────────────────────────────────────────────────

    function test_UnallocatedValueRollsIntoTheNextPeriod() public {
        uint256 id1 = dist.fundPeriod(address(usdc), 1000);
        (bytes32 root,,) = _tree2(_leaf(id1, alice, 600), _leaf(id1, bob, 0));
        dist.publishAllocations(id1, root, 600); // 400 left unallocated

        uint256 id2 = dist.fundPeriod(address(usdc), 0); // add NOTHING
        assertEq(dist.available(address(usdc)), 400, "the leftover is simply still here");

        (bytes32 r2, bytes32[] memory pc,) = _tree2(_leaf(id2, carol, 400), _leaf(id2, bob, 0));
        dist.publishAllocations(id2, r2, 400);
        vm.prank(carol);
        dist.claim(id2, 400, pc);
        assertEq(usdc.balanceOf(carol), 400, "a period can run purely on rollover");
    }

    // ── what must be impossible ─────────────────────────────────────────────────────────────

    /// The one that matters: there is NO path by which anyone but a claimant removes value.
    function test_NoWithdrawSweepOrRescueExistsForAnyone() public {
        dist.fundPeriod(address(usdc), 5000);
        uint256 before = usdc.balanceOf(address(dist));

        string[7] memory forbidden = [
            "withdraw()",
            "withdraw(address,uint256)",
            "sweep(address)",
            "rescue(address,uint256)",
            "recoverERC20(address,uint256)",
            "migrate(address)",
            "emergencyWithdraw()"
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(dist)
                .call(
                    abi.encodePacked(
                        bytes4(keccak256(bytes(forbidden[i]))),
                        uint256(uint160(owner)),
                        uint256(before)
                    )
                );
            assertFalse(ok, forbidden[i]);
        }
        assertEq(usdc.balanceOf(address(dist)), before, "not one unit left");
    }

    function test_TheOwnerCannotClaimSomeoneElsesAllocation() public {
        (uint256 id, bytes32[] memory pa,) = _fundAndPublish(4300, 1000, 3300);
        vm.expectRevert(BrokerRevenueDistributor.BadProof.selector);
        dist.claim(id, 1000, pa); // as owner
    }

    function test_EtherCannotBeSentHere() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(dist).call{ value: 1 ether }("");
        assertFalse(ok, "no payable path");
        assertEq(address(dist).balance, 0);
    }

    // ── a published period is a fact ────────────────────────────────────────────────────────

    function test_APublishedPeriodCannotBeRepublished() public {
        (uint256 id,,) = _fundAndPublish(4300, 1000, 3300);
        (bytes32 other,,) = _tree2(_leaf(id, carol, 4300), _leaf(id, bob, 0));
        vm.expectRevert(
            abi.encodeWithSelector(BrokerRevenueDistributor.AlreadyPublished.selector, id)
        );
        dist.publishAllocations(id, other, 4300);
    }

    function test_ClaimingBeforePublicationReverts() public {
        uint256 id = dist.fundPeriod(address(usdc), 1000);
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BrokerRevenueDistributor.NotPublished.selector, id));
        dist.claim(id, 1, empty);
    }

    function test_AnUnknownPeriodReverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BrokerRevenueDistributor.UnknownPeriod.selector, 99));
        dist.claim(99, 1, empty);
    }

    // ── an EMPTY period is a normal state, not an error (the state we are actually in) ──────

    function test_APeriodWithNoRevenueIsFineAndPaysNothing() public {
        uint256 id = dist.fundPeriod(address(usdc), 0);
        assertEq(dist.available(address(usdc)), 0);
        (bytes32 root, bytes32[] memory pa,) = _tree2(_leaf(id, alice, 0), _leaf(id, bob, 0));
        dist.publishAllocations(id, root, 0);

        vm.prank(alice);
        dist.claim(id, 0, pa); // succeeds, pays nothing, marks claimed
        assertEq(usdc.balanceOf(alice), 0);
        assertTrue(dist.claimed(id, alice), "an empty period still closes cleanly");
    }

    // ── ownership ───────────────────────────────────────────────────────────────────────────

    function test_OnlyTheOwnerFundsAndPublishes() public {
        vm.startPrank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        dist.fundPeriod(address(usdc), 1);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        dist.publishAllocations(1, bytes32(uint256(1)), 1);
        vm.stopPrank();
    }

    function test_OwnershipHandoverIsTwoStep() public {
        dist.transferOwnership(stranger);
        assertEq(dist.owner(), owner);
        vm.prank(stranger);
        dist.acceptOwnership();
        assertEq(dist.owner(), stranger);
    }

    /// The encoding the off-chain builder must match. A distributor whose builder and contract
    /// disagree about the leaf is the classic way one of these ships broken.
    function test_TheLeafEncodingIsExposedSoTheBuilderCannotDrift() public view {
        assertEq(dist.leafFor(7, alice, 1234), _leaf(7, alice, 1234));
    }
}
