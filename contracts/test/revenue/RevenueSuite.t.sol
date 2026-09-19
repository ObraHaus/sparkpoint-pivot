// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { RevenueSplitter } from "../../src/revenue/RevenueSplitter.sol";
import { RoyaltySink } from "../../src/revenue/RoyaltySink.sol";
import { BrokerVault } from "../../src/revenue/BrokerVault.sol";
import { MockERC20 } from "../mocks/Mocks.sol";

// ------------------------------------------------------------------ mocks

/// @dev Accepts ETH and remembers it — stands in for the engine and the treasury in splitter tests.
contract EthSink {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}

/// @dev Pons' V2FeeEscrow behaviour that matters: `claim()` pays the caller its whole balance.
contract MockFeeEscrow {
    receive() external payable { }

    function claim() external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) return 0;
        (bool ok,) = msg.sender.call{ value: amount }("");
        require(ok, "claim");
    }
}

/// @dev Curve/hook behaviour that matters: the sweep credits the escrow rather than paying us.
contract MockCurve {
    MockFeeEscrow public immutable escrow;
    uint256 public sweepable;

    constructor(MockFeeEscrow escrow_) {
        escrow = escrow_;
    }

    function fund() external payable {
        sweepable += msg.value;
    }

    function sweepFees(uint256) external {
        uint256 amount = sweepable;
        sweepable = 0;
        if (amount == 0) return;
        (bool ok,) = address(escrow).call{ value: amount }("");
        require(ok, "credit");
    }
}

/// @dev Minimal ERC-721 slice the vault needs: ownerOf, burn, and a test transfer.
contract MockBrokerNFT {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function burn(uint256 id) external {
        delete ownerOf[id];
    }

    function transfer(address to, uint256 id) external {
        ownerOf[id] = to;
    }
}

// ------------------------------------------------------------------ RoyaltySink

contract RoyaltySinkTest is Test {
    EthSink private splitter;
    RoyaltySink private sink;

    function setUp() public {
        splitter = new EthSink();
        sink = new RoyaltySink(address(splitter));
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(RoyaltySink.ZeroAddress.selector);
        new RoyaltySink(address(0));
    }

    function test_receiveHolds_flushForwardsEverything() public {
        vm.deal(address(this), 3 ether);
        (bool ok,) = address(sink).call{ value: 1.5 ether }("");
        assertTrue(ok);
        assertEq(address(sink).balance, 1.5 ether);

        sink.flush();
        assertEq(splitter.received(), 1.5 ether);
        assertEq(address(sink).balance, 0);
    }

    function test_flushWithNothingReverts() public {
        vm.expectRevert(RoyaltySink.NothingToFlush.selector);
        sink.flush();
    }
}

// ------------------------------------------------------------------ RevenueSplitter

contract RevenueSplitterTest is Test {
    MockFeeEscrow private escrow;
    EthSink private engine;
    EthSink private treasury;
    RevenueSplitter private splitter;

    function setUp() public {
        escrow = new MockFeeEscrow();
        engine = new EthSink();
        treasury = new EthSink();
        splitter = new RevenueSplitter(address(escrow), address(engine), address(treasury));
    }

    function test_constructorRejectsZeroAndSameLegs() public {
        vm.expectRevert(RevenueSplitter.ZeroAddress.selector);
        new RevenueSplitter(address(0), address(engine), address(treasury));
        vm.expectRevert(RevenueSplitter.BadDestination.selector);
        new RevenueSplitter(address(escrow), address(engine), address(engine));
    }

    function test_distributeSplits90_10() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(splitter).call{ value: 10 ether }("");
        assertTrue(ok);

        splitter.distribute();
        assertEq(engine.received(), 9 ether);
        assertEq(treasury.received(), 1 ether);
        assertEq(address(splitter).balance, 0);
    }

    function test_distributeWithNothingReverts() public {
        vm.expectRevert(RevenueSplitter.NothingToDistribute.selector);
        splitter.distribute();
    }

    function test_pullClaimsFromEscrowThenSplits() public {
        vm.deal(address(escrow), 2 ether);
        splitter.pull();
        assertEq(engine.received(), 1.8 ether);
        assertEq(treasury.received(), 0.2 ether);
    }

    function test_sweepCurveClaimsTheEscrowCreditAndSplits() public {
        MockCurve curve = new MockCurve(escrow);
        curve.fund{ value: 1 ether }();

        splitter.sweepCurve(address(curve), 0);
        assertEq(engine.received(), 0.9 ether);
        assertEq(treasury.received(), 0.1 ether);
    }

    function test_sweepTargetGuard() public {
        vm.expectRevert(RevenueSplitter.BadSweepTarget.selector);
        splitter.sweepCurve(address(0), 0);
        vm.expectRevert(RevenueSplitter.BadSweepTarget.selector);
        splitter.sweepCurve(address(splitter), 0);
        vm.expectRevert(RevenueSplitter.BadSweepTarget.selector);
        splitter.sweepCurve(address(escrow), 0);
    }

    function test_sweepTokenSplitsAnErc20() public {
        MockERC20 token = new MockERC20("Stray", "STR", 18);
        token.mint(address(splitter), 100e18);

        splitter.sweepToken(address(token));
        assertEq(token.balanceOf(address(engine)), 90e18);
        assertEq(token.balanceOf(address(treasury)), 10e18);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function test_sweepTokenWithNothingReverts() public {
        MockERC20 token = new MockERC20("Stray", "STR", 18);
        vm.expectRevert(RevenueSplitter.NothingToSweep.selector);
        splitter.sweepToken(address(token));
    }
}

// ------------------------------------------------------------------ BrokerVault

contract BrokerVaultTest is Test {
    MockBrokerNFT private nft;
    BrokerVault private vault;
    MockERC20 private token;
    uint256 private ownerPk = 0xA11CE;
    address private owner;
    address private stranger = address(0xB0B);

    function setUp() public {
        owner = vm.addr(ownerPk);
        nft = new MockBrokerNFT();
        vault = new BrokerVault(address(nft), address(this)); // this test contract is the engine
        token = new MockERC20("Reward", "RWD", 18);
        nft.mint(owner, 7);
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(BrokerVault.NotEngine.selector);
        new BrokerVault(address(0), address(this));
    }

    function test_creditAndCreditEth() public {
        token.mint(address(this), 5e18);
        token.approve(address(vault), 5e18);
        // engine transfers after crediting, like the engine will
        vault.credit(7, address(token), 5e18);
        token.transfer(address(vault), 5e18);

        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);

        assertEq(vault.balanceOf(7, address(token)), 5e18);
        assertEq(vault.balanceOf(7, address(0)), 1 ether);

        address[] memory assets = vault.assetsOf(7);
        assertEq(assets.length, 2);
    }

    function test_creditRejectsEthSentinel() public {
        vm.expectRevert(BrokerVault.UseCreditEth.selector);
        vault.credit(7, address(0), 1);
    }

    function test_creditOnlyEngine() public {
        vm.prank(stranger);
        vm.expectRevert(BrokerVault.NotEngine.selector);
        vault.credit(7, address(token), 1);
    }

    function test_mergeMovesEveryAsset() public {
        token.mint(address(this), 10e18);
        token.transfer(address(vault), 10e18);
        vault.credit(7, address(token), 10e18);
        vm.deal(address(this), 2 ether);
        vault.creditEth{ value: 1 ether }(7);
        vault.creditEth{ value: 1 ether }(8);

        vault.merge(7, 8);

        assertEq(vault.balanceOf(7, address(token)), 0);
        assertEq(vault.balanceOf(7, address(0)), 0);
        assertEq(vault.balanceOf(8, address(token)), 10e18);
        assertEq(vault.balanceOf(8, address(0)), 2 ether);
    }

    function test_withdrawPaysOwner() public {
        token.mint(address(this), 4e18);
        token.transfer(address(vault), 4e18);
        vault.credit(7, address(token), 4e18);
        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);

        address[] memory assets = new address[](2);
        assets[0] = address(token);
        assets[1] = address(0);

        vm.prank(owner);
        vault.withdraw(7, assets);

        assertEq(token.balanceOf(owner), 4e18);
        assertEq(owner.balance, 1 ether);
        assertEq(vault.balanceOf(7, address(token)), 0);
    }

    function test_withdrawRejectsNonOwner() public {
        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        vm.prank(stranger);
        vm.expectRevert(BrokerVault.NotOwner.selector);
        vault.withdraw(7, assets);
    }

    function test_withdrawWithSig() public {
        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);

        address[] memory assets = new address[](1);
        assets[0] = address(0);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = vault.withdrawDigest(7, assets, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        vault.withdrawWithSig(7, assets, deadline, abi.encodePacked(r, s, v));

        assertEq(owner.balance, 1 ether);
        assertEq(vault.nonces(7), 1);
    }

    function test_withdrawWithSigRejectsBadSignature() public {
        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = vault.withdrawDigest(7, assets, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, digest);
        vm.expectRevert(BrokerVault.InvalidSignature.selector);
        vault.withdrawWithSig(7, assets, deadline, abi.encodePacked(r, s, v));
    }

    function test_withdrawNothingReverts() public {
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        vm.prank(owner);
        vm.expectRevert(BrokerVault.NothingToWithdraw.selector);
        vault.withdraw(7, assets);
    }

    function test_newOwnerCanWithdrawAfterTransfer() public {
        vm.deal(address(this), 1 ether);
        vault.creditEth{ value: 1 ether }(7);
        nft.transfer(stranger, 7);
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        vm.prank(stranger);
        vault.withdraw(7, assets);
        assertEq(stranger.balance, 1 ether);
    }
}
