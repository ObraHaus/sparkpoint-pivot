// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { BrokerActivationRegistry } from "../../src/broker/BrokerActivationRegistry.sol";
import { SparkPointTestToken } from "../../src/token/SparkPointTestToken.sol";
import { MockSparkyBroker } from "../mocks/MockSparkyBroker.sol";

/// @notice Unit + FUZZ for the activation registry (feature 043 phase B).
///
///         The property that matters most is I2, and it is a fuzz rather than a unit test: **no
///         failure may leave a holder having paid SRK without an activated broker.** Every other
///         test here is ordinary correctness; that one is the reason a same-chain registry was
///         chosen over an attested activation with a backend key.
///
///         Second is I10 — an activation does NOT change SRK's total supply. The token has no burn,
///         so the SRK is moved out of circulation rather than destroyed, and that is precisely why
///         every user-facing surface says "retired" and never "burned".
contract BrokerActivationRegistryTest is Test {
    SparkPointTestToken internal srk;
    MockSparkyBroker internal broker;
    BrokerActivationRegistry internal registry;

    address internal owner = address(this);
    address internal holder = address(0xC1A1);
    address internal stranger = address(0xBEEF);

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MAX_PRICE = 100_000 ether;
    uint256 internal constant PRICE = 10_000 ether;

    event Activated(address indexed holder, uint256 indexed tokenId, uint256 srkRetired);
    event PriceSet(uint256 previousPrice, uint256 newPrice);

    function setUp() public {
        srk = new SparkPointTestToken(); // whole fixed supply mints to this test contract
        broker = new MockSparkyBroker();
        registry =
            new BrokerActivationRegistry(address(broker), address(srk), DEAD, MAX_PRICE, PRICE);
        broker.setActivator(address(registry));

        srk.transfer(holder, 1_000_000 ether);
        vm.prank(holder);
        srk.approve(address(registry), type(uint256).max);
    }

    function _mintTo(address to) internal returns (uint256 id) {
        id = broker.mint(to);
    }

    // ── the happy path, and what it must leave behind ───────────────────────────────────────

    function test_ActivateRetiresSrkAndFlipsActivation() public {
        uint256 id = _mintTo(holder);
        uint256 before = srk.balanceOf(holder);
        uint256 deadBefore = srk.balanceOf(DEAD);

        vm.expectEmit(true, true, false, true, address(registry));
        emit Activated(holder, id, PRICE);
        vm.prank(holder);
        registry.activate(id);

        assertEq(srk.balanceOf(holder), before - PRICE, "holder pays exactly price");
        assertEq(srk.balanceOf(DEAD), deadBefore + PRICE, "the SRK is out of circulation");
        assertTrue(broker.isActivated(id), "the broker is activated");
    }

    /// I1 — the registry never holds value, not even for one instruction.
    function test_I1_RegistryHoldsNothingAfterActivation() public {
        uint256 id = _mintTo(holder);
        vm.prank(holder);
        registry.activate(id);

        assertEq(srk.balanceOf(address(registry)), 0, "registry must hold no SRK");
        assertNotEq(broker.ownerOf(id), address(registry), "registry must hold no broker");
        assertEq(broker.ownerOf(id), holder, "the broker never leaves the holder");
    }

    /// I10 — SRK is retired, not burned. The word matters, so the property is asserted.
    function testFuzz_I10_ActivationNeverChangesTotalSupply(uint256 newPrice) public {
        newPrice = bound(newPrice, 0, MAX_PRICE);
        registry.setPrice(newPrice);
        srk.transfer(holder, MAX_PRICE); // make sure the holder can always cover it

        uint256 supplyBefore = srk.totalSupply();
        uint256 id = _mintTo(holder);
        vm.prank(holder);
        registry.activate(id);

        assertEq(srk.totalSupply(), supplyBefore, "an activation must NOT change total supply");
    }

    // ── I2 — THE ONE THAT MATTERS: no partial outcome, ever ─────────────────────────────────

    /// @dev Fuzzes the whole failure set. For each, both the holder's SRK balance and the token's
    ///      activation state must be EXACTLY as they were. There must be no input under which SRK
    ///      has left the holder and the broker is not activated.
    function testFuzz_I2_AnyRevertLeavesBalanceAndActivationUntouched(uint8 mode, uint256 seed)
        public
    {
        uint256 id = _mintTo(holder);
        uint256 balanceBefore;
        uint64 activatedBefore;
        address caller;

        uint8 which = mode % 4;

        if (which == 0) {
            // not the owner
            caller = address(uint160(bound(seed, 1, type(uint160).max)));
            vm.assume(caller != holder);
        } else if (which == 1) {
            // already activated
            vm.prank(holder);
            registry.activate(id);
            caller = holder;
        } else if (which == 2) {
            caller = holder;
            // insufficient balance. NOTE: the amount is read BEFORE the prank — `vm.prank` applies
            // to the next call, and an inner `balanceOf` would consume it, leaving the holder
            // undrained and this arm silently passing. That is exactly how this test first lied.
            uint256 everything = srk.balanceOf(holder);
            vm.prank(holder);
            srk.transfer(stranger, everything);
        } else {
            // insufficient allowance
            caller = holder;
            uint256 short = bound(seed, 0, PRICE - 1);
            vm.prank(holder);
            srk.approve(address(registry), short);
        }

        balanceBefore = srk.balanceOf(caller);
        activatedBefore = broker.activatedAt(id);

        vm.prank(caller);
        try registry.activate(id) {
            // Every arm above is a failure mode. A success means the arrangement did not actually
            // arrange the failure — which is how this test lied the first time (a `vm.prank` eaten
            // by an inner `balanceOf` left the holder undrained). Fail loudly rather than pass.
            fail("no failure-mode input may succeed: check the arrangement, not the contract");
        } catch {
            assertEq(srk.balanceOf(caller), balanceBefore, "NO SRK MAY MOVE ON A FAILED ACTIVATION");
            assertEq(broker.activatedAt(id), activatedBefore, "activation state must be untouched");
        }
    }

    /// I3 — the ownership check reads the NFT, not the caller's claim.
    function test_I3_NonOwnerCannotActivateAndPaysNothing() public {
        uint256 id = _mintTo(holder);
        srk.transfer(stranger, PRICE * 2);
        vm.prank(stranger);
        srk.approve(address(registry), type(uint256).max);

        uint256 before = srk.balanceOf(stranger);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                BrokerActivationRegistry.NotBrokerOwner.selector, id, holder, stranger
            )
        );
        registry.activate(id);

        assertEq(srk.balanceOf(stranger), before, "a rejected caller pays nothing");
        assertFalse(broker.isActivated(id));
    }

    /// I4 — paying twice for the same broker is impossible.
    function test_I4_AlreadyActivatedRevertsAndChargesNothing() public {
        uint256 id = _mintTo(holder);
        vm.prank(holder);
        registry.activate(id);

        uint256 before = srk.balanceOf(holder);
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(BrokerActivationRegistry.AlreadyActivated.selector, id)
        );
        registry.activate(id);
        assertEq(srk.balanceOf(holder), before, "a second activation charges nothing");
    }

    // ── re-activation after a sale is a FEATURE, and costs again ────────────────────────────

    function test_TransferClearsActivationAndReactivationCostsAgain() public {
        uint256 id = _mintTo(holder);
        vm.prank(holder);
        registry.activate(id);
        assertTrue(broker.isActivated(id));

        // A real sale.
        vm.prank(holder);
        broker.transferFrom(holder, stranger, id);
        assertFalse(broker.isActivated(id), "the sale clears the activation");

        // The buyer burns their own.
        srk.transfer(stranger, PRICE * 2);
        vm.startPrank(stranger);
        srk.approve(address(registry), type(uint256).max);
        uint256 before = srk.balanceOf(stranger);
        registry.activate(id);
        vm.stopPrank();

        assertTrue(broker.isActivated(id));
        assertEq(srk.balanceOf(stranger), before - PRICE, "the buyer pays their own");
    }

    // ── I7 — the candidate set is a SUPERSET, never a subset ────────────────────────────────

    function test_I7_ActivationsByIsASupersetNeverASubset() public {
        uint256 a = _mintTo(holder);
        uint256 b = _mintTo(holder);
        vm.startPrank(holder);
        registry.activate(a);
        registry.activate(b);
        vm.stopPrank();

        uint256[] memory listed = registry.activationsBy(holder);
        assertEq(listed.length, 2);
        assertEq(listed[0], a);
        assertEq(listed[1], b);
        assertEq(registry.activationCountBy(holder), 2);

        // Selling one does NOT shrink the list — the registry cannot observe a transfer, and that is
        // exactly why every reader must narrow it with a live ownerOf + activatedAt.
        vm.prank(holder);
        broker.transferFrom(holder, stranger, a);

        uint256[] memory afterSale = registry.activationsBy(holder);
        assertEq(afterSale.length, 2, "the hint is allowed to go stale");
        assertFalse(broker.isActivated(a), "but the CHAIN says it is no longer activated");
    }

    /// @dev Found by the LIVE verification on 46630, not by this suite: activate, sell, reacquire,
    ///      re-activate returned `[3, 3]`. Readers scan a bounded prefix (the agent caps at 32), so
    ///      duplicates could push a real activated broker out of range and cost a holder the Premium
    ///      they are entitled to. The list must be duplicate-free.
    function test_ReactivatingTheSameBrokerDoesNotAppendADuplicate() public {
        uint256 id = _mintTo(holder);
        srk.transfer(stranger, PRICE * 4);

        vm.prank(holder);
        registry.activate(id);
        assertEq(registry.activationsBy(holder).length, 1);

        // sold away (clears activation), then reacquired
        vm.prank(holder);
        broker.transferFrom(holder, stranger, id);
        vm.prank(stranger);
        broker.transferFrom(stranger, holder, id);
        assertFalse(broker.isActivated(id), "coming back does not restore the activation");

        vm.prank(holder);
        registry.activate(id);

        uint256[] memory listed = registry.activationsBy(holder);
        assertEq(listed.length, 1, "the same token must appear ONCE however often it is activated");
        assertEq(listed[0], id);
        assertEq(registry.activationCountBy(holder), 1);
        assertTrue(broker.isActivated(id));
    }

    function test_DistinctBrokersEachAppearOnce() public {
        uint256 a = _mintTo(holder);
        uint256 b = _mintTo(holder);
        vm.startPrank(holder);
        registry.activate(a);
        registry.activate(b);
        vm.stopPrank();
        assertEq(registry.activationsBy(holder).length, 2, "distinct tokens are still both listed");
    }

    function test_I7_AWalletThatNeverActivatedHasAnEmptyList() public view {
        assertEq(registry.activationsBy(stranger).length, 0);
        assertEq(registry.activationCountBy(stranger), 0);
    }

    // ── I5 / I6 — the price is capped, and cannot change mid-call ───────────────────────────

    function test_I5_SetPriceAboveTheCapReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BrokerActivationRegistry.PriceAboveCap.selector, MAX_PRICE + 1, MAX_PRICE
            )
        );
        registry.setPrice(MAX_PRICE + 1);
        assertEq(registry.price(), PRICE, "a rejected setPrice changes nothing");
    }

    function testFuzz_I5_AnyPriceAtOrBelowTheCapIsAccepted(uint256 newPrice) public {
        newPrice = bound(newPrice, 0, MAX_PRICE);
        vm.expectEmit(false, false, false, true, address(registry));
        emit PriceSet(PRICE, newPrice);
        registry.setPrice(newPrice);
        assertEq(registry.price(), newPrice);
    }

    /// I6 — one call charges exactly the price that was live when it started.
    function test_I6_AHolderIsChargedExactlyThePriceTheyRead() public {
        uint256 id = _mintTo(holder);
        uint256 quoted = registry.price();
        uint256 before = srk.balanceOf(holder);

        vm.prank(holder);
        registry.activate(id);
        assertEq(before - srk.balanceOf(holder), quoted, "charged exactly the quoted price");
    }

    function test_AZeroPriceActivatesWithoutMovingAnySrk() public {
        registry.setPrice(0);
        uint256 id = _mintTo(holder);
        uint256 before = srk.balanceOf(holder);

        vm.prank(holder);
        registry.activate(id);

        assertTrue(broker.isActivated(id));
        assertEq(srk.balanceOf(holder), before, "a zero price moves nothing at all");
    }

    function test_OnlyTheOwnerCanSetThePrice() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        registry.setPrice(1 ether);
    }

    // ── I9 / non-custody surface ────────────────────────────────────────────────────────────

    /// I9 — there is no reachable path that moves a broker, and no way to get value out.
    /// @dev Asserted BEHAVIOURALLY, by calling each selector and requiring it to fail. The obvious
    ///      structural check — grepping the runtime bytecode for the selector — is wrong here and
    ///      says so loudly: the registry EMBEDS `transferFrom(address,address,uint256)` because it
    ///      CALLS it on SRK. A selector appearing in bytecode is not the same as it being dispatched.
    function test_I9_TheRegistryExposesNoWithdrawSweepOrRescue() public {
        string[6] memory forbidden = [
            "withdraw()",
            "sweep(address)",
            "rescue(address,uint256)",
            "recoverERC20(address,uint256)",
            "transferFrom(address,address,uint256)",
            "sweepETH()"
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            bytes4 sel = bytes4(keccak256(bytes(forbidden[i])));
            // Padded with plenty of zero args so a real function would decode rather than revert on
            // calldata length — the failure must come from there being no such function.
            (bool ok,) =
                address(registry).call(abi.encodePacked(sel, uint256(0), uint256(0), uint256(0)));
            assertFalse(ok, forbidden[i]);
        }
        assertEq(srk.balanceOf(address(registry)), 0);
    }

    /// @dev The registry has no `receive`/`fallback` and no payable function, so ETH cannot reach it
    ///      and therefore cannot be stranded in it — the `locked-ether` class the scanners flagged
    ///      on the NFT.
    function test_EtherCannotBeSentToTheRegistry() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(registry).call{ value: 1 ether }("");
        assertFalse(ok, "the registry must not accept ETH");
        assertEq(address(registry).balance, 0);
    }

    // ── constructor + ownership ─────────────────────────────────────────────────────────────

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(BrokerActivationRegistry.ZeroAddress.selector);
        new BrokerActivationRegistry(address(0), address(srk), DEAD, MAX_PRICE, PRICE);

        vm.expectRevert(BrokerActivationRegistry.ZeroAddress.selector);
        new BrokerActivationRegistry(address(broker), address(0), DEAD, MAX_PRICE, PRICE);

        // The dead address must not be address(0): a standard ERC-20 transfer there reverts, so an
        // activation would be impossible rather than free.
        vm.expectRevert(BrokerActivationRegistry.ZeroAddress.selector);
        new BrokerActivationRegistry(address(broker), address(srk), address(0), MAX_PRICE, PRICE);
    }

    function test_ConstructorRejectsAnInitialPriceAboveTheCap() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BrokerActivationRegistry.PriceAboveCap.selector, MAX_PRICE + 1, MAX_PRICE
            )
        );
        new BrokerActivationRegistry(address(broker), address(srk), DEAD, MAX_PRICE, MAX_PRICE + 1);
    }

    function test_ConstructorRejectsAZeroCap() public {
        vm.expectRevert(BrokerActivationRegistry.ZeroMaxPrice.selector);
        new BrokerActivationRegistry(address(broker), address(srk), DEAD, 0, 0);
    }

    function test_ImmutablesAreWhatWasDeployed() public view {
        assertEq(address(registry.broker()), address(broker));
        assertEq(address(registry.srk()), address(srk));
        assertEq(registry.deadAddress(), DEAD);
        assertEq(registry.maxPrice(), MAX_PRICE);
    }

    /// Ownership is 2-step: a fat-fingered handover cannot orphan the price setter.
    function test_OwnershipHandoverIsTwoStep() public {
        registry.transferOwnership(stranger);
        assertEq(registry.owner(), owner, "not owner until accepted");
        assertEq(registry.pendingOwner(), stranger);

        vm.prank(stranger);
        registry.acceptOwnership();
        assertEq(registry.owner(), stranger);
    }
}
