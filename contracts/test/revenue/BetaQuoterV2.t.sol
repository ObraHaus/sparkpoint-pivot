// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { BetaQuoterV2 } from "../../src/revenue/BetaQuoterV2.sol";

/// @dev A same-slot upgrade target; only the constructor and a new function differ.
contract BetaQuoterV2Next is BetaQuoterV2 {
    constructor(address factory_, address weth_) BetaQuoterV2(factory_, weth_) { }

    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @dev Offline guards for the quoter: wiring, UUPS ownership, argument validation and the
/// missing-pool path. The real quote math is proven against the live pool in
/// `test/fork/BetaQuoterFork.t.sol`.
contract BetaQuoterV2Test is Test {
    address internal constant FACTORY = address(0xFAC70);
    address internal constant WETH = address(0x4E7);
    address internal constant USDG = address(0x055D6);

    BetaQuoterV2 internal impl;
    BetaQuoterV2 internal q;

    address internal owner = address(this);

    function setUp() public {
        impl = new BetaQuoterV2(FACTORY, WETH);
        q = BetaQuoterV2(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(BetaQuoterV2.initialize, ()))
                ))
        );
    }

    function test_constructor_rejectsZeroWiring() public {
        vm.expectRevert(BetaQuoterV2.ZeroAddress.selector);
        new BetaQuoterV2(address(0), WETH);

        vm.expectRevert(BetaQuoterV2.ZeroAddress.selector);
        new BetaQuoterV2(FACTORY, address(0));
    }

    function test_initialize_bindsOwnerAndDisablesTheImplementation() public view {
        assertEq(q.owner(), owner, "the proxy's initializer did not bind the owner");
        assertEq(impl.owner(), address(0), "the implementation must stay unowned");
        assertEq(q.factory(), FACTORY);
        assertEq(q.WETH9(), WETH);
    }

    function test_initialize_secondCallReverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        q.initialize();
    }

    function test_quote_rejectsZeroAmount() public {
        vm.expectRevert(BetaQuoterV2.ZeroAmount.selector);
        q.quoteExactInputSingle(
            BetaQuoterV2.QuoteExactInputSingleParams({
                tokenIn: WETH, tokenOut: USDG, amountIn: 0, fee: 100, sqrtPriceLimitX96: 0
            })
        );
    }

    function test_quote_revertsWhenThePoolDoesNotExist() public {
        vm.expectRevert(BetaQuoterV2.InvalidPool.selector);
        q.quoteExactInputSingle(
            BetaQuoterV2.QuoteExactInputSingleParams({
                tokenIn: WETH, tokenOut: USDG, amountIn: 1e15, fee: 100, sqrtPriceLimitX96: 0
            })
        );
    }

    function test_upgrade_onlyOwner_andSurvives() public {
        BetaQuoterV2Next next = new BetaQuoterV2Next(FACTORY, WETH);

        vm.prank(address(0xA11CE));
        vm.expectRevert(BetaQuoterV2.NotOwner.selector);
        q.upgradeToAndCall(address(next), "");

        q.upgradeToAndCall(address(next), "");
        assertEq(BetaQuoterV2Next(payable(address(q))).version(), 2, "the upgrade did not land");
        assertEq(q.owner(), owner);
    }

    function test_transferOwnership_onlyOwner() public {
        vm.prank(address(0xA11CE));
        vm.expectRevert(BetaQuoterV2.NotOwner.selector);
        q.transferOwnership(address(0xA11CE));

        vm.expectRevert(BetaQuoterV2.ZeroAddress.selector);
        q.transferOwnership(address(0));

        q.transferOwnership(address(0xA11CE));
        assertEq(q.owner(), address(0xA11CE));
    }

    function test_rescue_onlyOwner() public {
        vm.deal(address(q), 1 ether);

        vm.prank(address(0xA11CE));
        vm.expectRevert(BetaQuoterV2.NotOwner.selector);
        q.rescueEth(address(0xA11CE), 1 ether);

        q.rescueEth(address(0xA11CE), 1 ether);
        assertEq(address(0xA11CE).balance, 1 ether);
        assertEq(address(q).balance, 0);
    }

    function test_rescue_rejectsZeroRecipient() public {
        vm.expectRevert(BetaQuoterV2.ZeroAddress.selector);
        q.rescueEth(address(0), 0);

        vm.expectRevert(BetaQuoterV2.ZeroAddress.selector);
        q.rescueToken(address(0x1), address(0), 0);
    }
}
