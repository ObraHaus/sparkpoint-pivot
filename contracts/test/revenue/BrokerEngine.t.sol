// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { BrokerEngine } from "../../src/revenue/BrokerEngine.sol";
import { BrokerVault } from "../../src/revenue/BrokerVault.sol";

/// @dev ERC-721 slice the engine uses, with OZ-v5 semantics: `ownerOf` REVERTS for a burned id.
contract MockNFT {
    mapping(uint256 => address) private _owners;

    function ownerOf(uint256 id) public view returns (address) {
        address o = _owners[id];
        require(o != address(0), "ERC721: nonexistent");
        return o;
    }

    function mint(address to, uint256 id) external {
        _owners[id] = to;
    }

    function burn(uint256 id) external {
        delete _owners[id];
    }

    function transfer(address to, uint256 id) external {
        _owners[id] = to;
    }
}

contract MockToken is ERC20 {
    constructor() ERC20("Sparky", "SPARKY") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}

contract BrokerEngineTest is Test {
    uint256 constant ROUND = 3600;

    MockNFT nft;
    MockToken token;
    BrokerEngine engine;
    BrokerVault vault;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        nft = new MockNFT();
        token = new MockToken();

        BrokerEngine impl = new BrokerEngine();
        engine = BrokerEngine(
            payable(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeCall(BrokerEngine.initialize, (address(nft), ROUND))
                    )
                )
            )
        );

        vault = new BrokerVault(address(nft), address(engine));
        engine.setVault(address(vault));
        engine.setToken(address(token));

        token.mint(alice, 1_000);
        token.mint(bob, 1_000);
        vm.prank(alice);
        token.approve(address(engine), type(uint256).max);
        vm.prank(bob);
        token.approve(address(engine), type(uint256).max);

        nft.mint(alice, 1);
        nft.mint(alice, 2);
        nft.mint(bob, 3);
    }

    function _clockIn(address who, uint256 id) private {
        vm.prank(who);
        engine.clockIn(id);
    }

    // ---------------------------------------------------------------- verbs

    function test_clockIn_burnsActivatesAndWeights() public {
        _clockIn(alice, 1);

        assertTrue(engine.isActive(1));
        assertEq(engine.activator(1), alice);
        assertEq(engine.rankOf(1), 1);
        assertEq(engine.weightOf(1), 100);
        assertEq(engine.totalWeight(), 100);
        assertEq(token.balanceOf(alice), 999); // single-digit price: 1
        assertEq(token.totalSupply(), 2000 - 1);
    }

    function test_clockIn_twiceReverts() public {
        _clockIn(alice, 1);
        vm.prank(alice);
        vm.expectRevert(BrokerEngine.AlreadyActive.selector);
        engine.clockIn(1);
    }

    function test_clockIn_requiresOwnership() public {
        vm.prank(bob);
        vm.expectRevert(BrokerEngine.NotBrokerOwner.selector);
        engine.clockIn(1);
    }

    function test_promote_burnsDifferential_andQueuesWeight() public {
        _clockIn(alice, 1);
        vm.prank(alice);
        engine.promote(1, 2);

        assertEq(engine.rankOf(1), 2);
        assertEq(engine.tierBurned(1), 2);
        assertEq(token.balanceOf(alice), 998); // 1 activation + 1 differential
        assertEq(engine.weightOf(1), 100); // earning at the old weight
        assertEq(engine.pendingWeightOf(1), 200); // new weight from next round

        // close the round, then any crystallise applies the queued weight
        vm.warp(block.timestamp + ROUND);
        engine.settle();
        engine.deliver(_ids1(1));
        assertEq(engine.weightOf(1), 200);
        assertEq(engine.totalWeight(), 200);
    }

    function test_promote_rejectsOrderAndBadRank() public {
        _clockIn(alice, 1);
        vm.prank(alice);
        vm.expectRevert(BrokerEngine.BadTier.selector);
        engine.promote(1, 1);
        vm.prank(alice);
        vm.expectRevert(BrokerEngine.BadTier.selector);
        engine.promote(1, 4);
    }

    function test_fuse_absorbsCarriesWeightAndBonus() public {
        _clockIn(alice, 1);
        _clockIn(alice, 2);
        uint256 burnedBefore = 2000 - token.totalSupply();

        vm.prank(alice);
        engine.fuse(_ids2(1, 2));

        assertEq(engine.parts(1), 2);
        assertEq(engine.absorbedWeight(1), 100);
        assertEq(engine.rawWeight(1), 200);
        assertEq(engine.deriveWeight(1), 250); // +25%
        assertEq(token.balanceOf(alice), 996); // +2 fuse burn
        assertEq(2000 - token.totalSupply(), burnedBefore + 2);
        vm.expectRevert(); // absorbed id is burned (ownerOf reverts)
        nft.ownerOf(2);
    }

    function test_fuse_rejectsFusedBroker() public {
        _clockIn(alice, 1);
        _clockIn(alice, 2);
        vm.prank(alice);
        engine.fuse(_ids2(1, 2));
        vm.prank(alice);
        vm.expectRevert(BrokerEngine.AlreadyFused.selector);
        engine.fuse(_ids2(1, 2));
    }

    // ---------------------------------------------------------------- revenue, AS-IS

    function test_ethRevenue_deliveredAsEth() public {
        _clockIn(alice, 1);

        vm.deal(address(this), 1 ether);
        (bool ok,) = address(engine).call{ value: 1 ether }("");
        assertTrue(ok);
        assertEq(engine.pendingPot(address(0)), 1 ether);

        vm.warp(block.timestamp + ROUND);
        engine.settle();
        engine.deliver(_ids1(1));

        assertEq(vault.balanceOf(1, address(0)), 1 ether);
        assertEq(engine.pendingPot(address(0)), 0);
        assertEq(address(engine).balance, 0);

        // the broker's owner withdraws it
        address[] memory assets = new address[](1);
        assets[0] = address(0);
        vm.prank(alice);
        vault.withdraw(1, assets);
        assertEq(alice.balance, 1 ether);
    }

    function test_erc20Revenue_deliveredAsIs() public {
        _clockIn(alice, 1);
        engine.addAsset(address(token));

        token.mint(bob, 5e18);
        vm.prank(bob);
        engine.depositAsset(address(token), 5e18);

        vm.warp(block.timestamp + ROUND);
        engine.settle();
        engine.deliver(_ids1(1));

        assertEq(vault.balanceOf(1, address(token)), 5e18);
        assertEq(token.balanceOf(address(vault)), 5e18);
        assertEq(token.balanceOf(address(engine)), 0);
    }

    function test_revenue_splitsProRataAcrossWeights() public {
        _clockIn(alice, 1); // 100
        _clockIn(alice, 2);
        vm.prank(alice);
        engine.fuse(_ids2(1, 2)); // survivor 1 → 250
        _clockIn(bob, 3); // 100

        vm.warp(block.timestamp + ROUND);
        engine.settle(); // promote the survivor's queued weight before revenue
        engine.deliver(_ids2(1, 3));

        vm.deal(address(this), 1 ether);
        (bool ok,) = address(engine).call{ value: 1 ether }("");
        assertTrue(ok);

        vm.warp(block.timestamp + ROUND);
        engine.settle();
        engine.deliver(_ids2(1, 3));

        uint256 w1 = engine.weightOf(1); // 250
        uint256 w3 = engine.weightOf(3); // 100
        uint256 total = w1 + w3;
        assertEq(vault.balanceOf(1, address(0)), (1 ether * w1) / total);
        assertEq(vault.balanceOf(3, address(0)), (1 ether * w3) / total);
    }

    function test_soldBroker_isDroppedAndSalvaged() public {
        _clockIn(alice, 1);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(engine).call{ value: 1 ether }("");
        assertTrue(ok);
        vm.warp(block.timestamp + ROUND);
        engine.settle();

        // sold: owner changes before deliver — the accrual rides to the token's new owner
        nft.transfer(bob, 1);
        engine.deliver(_ids1(1));
        assertEq(vault.balanceOf(1, address(0)), 1 ether); // ghost-window credit rides along
        assertFalse(engine.isActive(1));

        // burned: no owner → the accrual is salvaged into the pot
        _clockIn(bob, 3);
        vm.deal(address(this), 1 ether);
        (bool ok2,) = address(engine).call{ value: 1 ether }("");
        assertTrue(ok2);
        vm.warp(block.timestamp + ROUND);
        engine.settle();
        nft.burn(3);
        engine.deliver(_ids1(3));
        assertEq(vault.balanceOf(3, address(0)), 0);
        assertEq(engine.pendingPot(address(0)), 1 ether); // salvaged, re-accrues next settle
    }

    function test_settle_skipsRoundsWithoutWeightOrRevenue() public {
        vm.warp(block.timestamp + ROUND * 3);
        engine.settle(); // no weight at all
        assertEq(engine.settledRound(), 3);
        assertEq(engine.accPerWeight(address(0)), 0);
    }

    function test_deliver_batchLimit() public {
        uint256[] memory ids = new uint256[](81);
        vm.expectRevert(BrokerEngine.BatchTooLarge.selector);
        engine.deliver(ids);
    }

    // ---------------------------------------------------------------- admin

    function test_setToken_isOneShot() public {
        vm.expectRevert(BrokerEngine.TokenAlreadySet.selector);
        engine.setToken(address(token));
    }

    function test_setToken_rejectsZero() public {
        BrokerEngine fresh = _freshEngine();
        vm.expectRevert(BrokerEngine.ZeroAddress.selector);
        fresh.setToken(address(0));
    }

    function test_renounce_refusesWhileTokenUnset() public {
        BrokerEngine fresh = _freshEngine();
        vm.expectRevert(BrokerEngine.TokenNotSet.selector);
        fresh.renounceOwnership();
    }

    function test_rankBurns_orderingRule() public {
        vm.expectRevert(BrokerEngine.BadBurnOrder.selector);
        engine.setRankBurns(2, 1, 3);
    }

    function test_addAsset_boundedAndUnique() public {
        engine.addAsset(address(token));
        vm.expectRevert(BrokerEngine.AssetAlreadyRegistered.selector);
        engine.addAsset(address(token));
        vm.expectRevert(BrokerEngine.ZeroAddress.selector);
        engine.addAsset(address(0));
    }

    function test_depositAsset_requiresRegistration() public {
        vm.expectRevert(BrokerEngine.AssetNotRegistered.selector);
        engine.depositAsset(address(token), 1);
    }

    function test_rescue_onlyOwner() public {
        vm.deal(address(engine), 1 ether);
        vm.expectRevert(BrokerEngine.NotOwner.selector);
        vm.prank(bob);
        engine.rescueEth(bob, 1 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _ids1(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids2(uint256 a, uint256 b) private pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    function _freshEngine() private returns (BrokerEngine fresh) {
        BrokerEngine impl = new BrokerEngine();
        fresh = BrokerEngine(
            payable(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeCall(BrokerEngine.initialize, (address(nft), ROUND))
                    )
                )
            )
        );
    }
}
