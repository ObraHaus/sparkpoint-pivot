// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { BrokerSale } from "../../src/broker/BrokerSale.sol";
import { MockSparkyBroker } from "../mocks/MockSparkyBroker.sol";

/// @notice A recipient that re-enters the sale from `onERC721Received`.
/// @dev `SparkyBroker` mints with `_safeMint`, so a contract recipient gets a callback mid-mint and
///      can call back in. If the sale incremented its counter AFTER the external call, this contract
///      would mint the whole collection in one transaction. It exists to prove it cannot.
contract ReentrantMinter {
    BrokerSale private immutable sale;
    uint256 public attempts;
    bool private reentering;

    constructor(BrokerSale sale_) {
        sale = sale_;
    }

    function go() external {
        sale.mint();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!reentering) {
            reentering = true;
            attempts++;
            // Re-enter. Must revert on the cap; swallowed so the outer mint still completes and the
            // test can assert on the resulting state rather than on a bubbled revert.
            try sale.mint() { } catch { }
            reentering = false;
        }
        return this.onERC721Received.selector;
    }
}

/// @notice Unit + FUZZ for the free, open mint (feature 043 phase C).
///
///         The property worth the most here is the re-entrancy one: the NFT uses `_safeMint`, so the
///         per-wallet cap is only real if the counter moves before the external call.
contract BrokerSaleTest is Test {
    MockSparkyBroker internal broker;
    BrokerSale internal sale;

    address internal owner = address(this);
    address internal minter = address(0xC1A1);
    address internal stranger = address(0xBEEF);

    uint256 internal constant CAP = 3;

    event Minted(address indexed to, uint256 indexed tokenId);
    event SaleOpenSet(bool open);
    event PerWalletCapSet(uint256 previousCap, uint256 newCap);

    function setUp() public {
        broker = new MockSparkyBroker();
        sale = new BrokerSale(address(broker), CAP, true);
        broker.setMinter(address(sale));
    }

    // ── free and open ───────────────────────────────────────────────────────────────────────

    function test_AnyoneCanMintAndItCostsNothing() public {
        uint256 balBefore = minter.balance;

        vm.expectEmit(true, true, false, false, address(sale));
        emit Minted(minter, 1);
        vm.prank(minter);
        uint256 id = sale.mint();

        assertEq(id, 1);
        assertEq(broker.ownerOf(id), minter);
        assertEq(sale.mintedBy(minter), 1);
        assertEq(minter.balance, balBefore, "the mint is free");
    }

    /// I8 — minting NEVER activates. Activation is bought separately, by retiring SRK.
    function test_I8_AFreshlyMintedBrokerIsNotActivated() public {
        vm.prank(minter);
        uint256 id = sale.mint();
        assertFalse(broker.isActivated(id), "a mint must never confer activation");
        assertEq(broker.activatedAt(id), 0);
    }

    function testFuzz_I8_NoMintEverActivates(uint8 count) public {
        // Bounded by the COLLECTION's cap, not an arbitrary number: past it the NFT reverts
        // SupplyExhausted, which is a different (and correct) failure than the wallet cap.
        uint256 n = bound(count, 1, broker.MAX_SUPPLY());
        sale.setPerWalletCap(n);
        vm.startPrank(minter);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = sale.mint();
            assertEq(broker.activatedAt(id), 0, "no minted broker may arrive activated");
        }
        vm.stopPrank();
    }

    // ── the per-wallet cap ──────────────────────────────────────────────────────────────────

    function test_TheCapIsEnforcedAndNamesTheNumbers() public {
        vm.startPrank(minter);
        sale.mint();
        sale.mint();
        sale.mint();
        assertEq(sale.remainingFor(minter), 0);

        vm.expectRevert(
            abi.encodeWithSelector(BrokerSale.WalletCapReached.selector, minter, CAP, CAP)
        );
        sale.mint();
        vm.stopPrank();

        assertEq(sale.mintedBy(minter), CAP, "a rejected mint changes nothing");
    }

    function test_TheCapIsPerWalletNotGlobal() public {
        vm.prank(minter);
        sale.mint();
        vm.prank(stranger);
        sale.mint();
        assertEq(sale.mintedBy(minter), 1);
        assertEq(sale.mintedBy(stranger), 1);
        assertEq(broker.totalMinted(), 2);
    }

    /// I12 — THE ONE THAT MATTERS: the cap survives a re-entrant recipient.
    /// @dev `_safeMint` hands control to the recipient mid-mint. If `mintedBy` were incremented
    ///      after `broker.mint(...)`, this contract would recurse to the collection cap in one
    ///      transaction. It is incremented first, so the re-entrant call sees the new count.
    function test_I12_ACapCannotBeBypassedByReenteringFromOnERC721Received() public {
        sale.setPerWalletCap(1);
        ReentrantMinter attacker = new ReentrantMinter(sale);

        attacker.go();

        assertEq(attacker.attempts(), 1, "the callback did fire: the test is exercising the path");
        assertEq(sale.mintedBy(address(attacker)), 1, "a re-entrant mint must not exceed the cap");
        assertEq(broker.totalMinted(), 1, "exactly one broker exists");
    }

    function test_LoweringTheCapStopsFurtherMintsButClawsNothingBack() public {
        vm.startPrank(minter);
        sale.mint();
        sale.mint();
        vm.stopPrank();

        sale.setPerWalletCap(1);
        assertEq(sale.mintedBy(minter), 2, "already-minted brokers are untouched");
        assertEq(sale.remainingFor(minter), 0);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(BrokerSale.WalletCapReached.selector, minter, 2, 1));
        sale.mint();
    }

    function testFuzz_MintingUpToTheCapAlwaysSucceedsAndOneMoreAlwaysFails(uint8 cap) public {
        uint256 n = bound(cap, 1, broker.MAX_SUPPLY());
        sale.setPerWalletCap(n);

        vm.startPrank(minter);
        for (uint256 i = 0; i < n; i++) {
            sale.mint();
        }
        vm.expectRevert(abi.encodeWithSelector(BrokerSale.WalletCapReached.selector, minter, n, n));
        sale.mint();
        vm.stopPrank();

        assertEq(sale.mintedBy(minter), n);
    }

    // ── the collection's supply cap stays on the NFT ─────────────────────────────────────────

    function test_TheNftsSupplyCapIsTheAuthorityNotThisContract() public {
        // Exhaust the collection through the sale itself, then prove the NEXT mint fails at the NFT.
        uint256 max = broker.MAX_SUPPLY();
        sale.setPerWalletCap(max + 1);

        vm.startPrank(minter);
        for (uint256 i = 0; i < max; i++) {
            sale.mint();
        }
        assertEq(broker.totalMinted(), max);

        // The wallet cap is NOT what stops this — the NFT's immutable supply cap is.
        vm.expectRevert(MockSparkyBroker.SupplyExhausted.selector);
        sale.mint();
        vm.stopPrank();
    }

    // ── open / closed ───────────────────────────────────────────────────────────────────────

    function test_ClosingTheSaleStopsMinting() public {
        vm.expectEmit(false, false, false, true, address(sale));
        emit SaleOpenSet(false);
        sale.setSaleOpen(false);

        vm.prank(minter);
        vm.expectRevert(BrokerSale.SaleClosed.selector);
        sale.mint();

        sale.setSaleOpen(true);
        vm.prank(minter);
        sale.mint();
        assertEq(sale.mintedBy(minter), 1);
    }

    function test_ADeployedClosedSaleMintsNothingUntilOpened() public {
        BrokerSale closed = new BrokerSale(address(broker), CAP, false);
        broker.setMinter(address(closed));
        vm.prank(minter);
        vm.expectRevert(BrokerSale.SaleClosed.selector);
        closed.mint();
    }

    // ── ownership + surface ─────────────────────────────────────────────────────────────────

    function test_OnlyTheOwnerCanChangeTheSale() public {
        vm.startPrank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        sale.setSaleOpen(false);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        sale.setPerWalletCap(99);
        vm.stopPrank();
    }

    function test_ConstructorRejectsAZeroBrokerOrCap() public {
        vm.expectRevert(BrokerSale.ZeroAddress.selector);
        new BrokerSale(address(0), CAP, true);
        vm.expectRevert(BrokerSale.ZeroCap.selector);
        new BrokerSale(address(broker), 0, true);
    }

    function test_TheCapCannotBeSetToZero() public {
        vm.expectRevert(BrokerSale.ZeroCap.selector);
        sale.setPerWalletCap(0);
        assertEq(sale.perWalletCap(), CAP, "a rejected setter changes nothing");
    }

    /// I11 — no payment leg means nothing can be sent here, so nothing can be stranded here.
    function test_I11_TheSaleAcceptsNoEtherAndExposesNoWithdrawal() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(sale).call{ value: 1 ether }("");
        assertFalse(sent, "the sale must not accept ETH");
        assertEq(address(sale).balance, 0);

        string[3] memory forbidden = ["withdraw()", "sweep(address)", "rescue(address,uint256)"];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(sale)
                .call(
                    abi.encodePacked(bytes4(keccak256(bytes(forbidden[i]))), uint256(0), uint256(0))
                );
            assertFalse(ok, forbidden[i]);
        }
    }

    function test_TheSaleNeverHoldsABroker() public {
        vm.prank(minter);
        uint256 id = sale.mint();
        assertEq(broker.ownerOf(id), minter, "the broker goes straight to the minter");
        assertNotEq(broker.ownerOf(id), address(sale));
    }

    function test_OwnershipHandoverIsTwoStep() public {
        sale.transferOwnership(stranger);
        assertEq(sale.owner(), owner);
        vm.prank(stranger);
        sale.acceptOwnership();
        assertEq(sale.owner(), stranger);
    }
}
