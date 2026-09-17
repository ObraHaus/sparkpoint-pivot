// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Errors } from "@openzeppelin/contracts/utils/Errors.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { FeeRouter } from "../../src/revenue/FeeRouter.sol";
import { ISwapRouter02 } from "../../src/revenue/interfaces/ISwapRouter02.sol";

// ---------------------------------------------------------------- mocks

/// @dev Minimal WETH9: `deposit`/`withdraw` plus the ERC-20 half the router approves and the mock
/// swap router pulls from. `mint` fabricates inventory; `setUp` pre-funds the contract with native
/// so every fabricated WETH can actually be withdrawn.
contract MockWeth {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "weth: balance");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{ value: amount }("");
        require(ok, "weth: send failed");
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "weth: allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        require(balanceOf[from] >= amount, "weth: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev The external `SwapRouter02` slice: pulls the exact input, pays `amountIn * outRate / 1e18`
/// of the output, and optionally enforces the caller's floor. `ignoreMinimum` is the hostile case
/// the router's own `InsufficientOutput` check exists for; `reenter` calls back into the router
/// from the swap, which the reentrancy guard must refuse.
contract MockSwapRouter {
    MockWeth public immutable weth;

    uint256 public outRate = 1e18;
    bool public ignoreMinimum;
    bool public reenter;
    FeeRouter public target;

    address public lastTokenIn;
    address public lastTokenOut;
    address public lastRecipient;
    uint256 public lastAmountIn;
    uint256 public lastAmountOutMinimum;
    uint24 public lastFee;

    constructor(MockWeth weth_) {
        weth = weth_;
    }

    function setOutRate(uint256 rate) external {
        outRate = rate;
    }

    function setIgnoreMinimum(bool ignore) external {
        ignoreMinimum = ignore;
    }

    function setReenter(FeeRouter target_) external {
        target = target_;
        reenter = true;
    }

    function exactInputSingle(ISwapRouter02.ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        if (reenter) {
            reenter = false;
            target.swapExactInputSingle(
                FeeRouter.ExactInputSingleParams({
                    tokenIn: params.tokenIn,
                    tokenOut: params.tokenOut,
                    fee: params.fee,
                    recipient: params.recipient,
                    amountIn: 1,
                    amountOutMinimum: 0,
                    deadline: block.timestamp
                })
            );
        }

        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * outRate) / 1e18;
        if (!ignoreMinimum) require(amountOut >= params.amountOutMinimum, "Too little received");

        lastTokenIn = params.tokenIn;
        lastTokenOut = params.tokenOut;
        lastRecipient = params.recipient;
        lastAmountIn = params.amountIn;
        lastAmountOutMinimum = params.amountOutMinimum;
        lastFee = params.fee;

        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}

/// @dev The splitter's fee surface, mirroring its immutable 90/10: ETH accrues in `receive()` and
/// waits for `distribute()`; an ERC-20 fee is swept to the engine + treasury immediately.
contract MockSplitter {
    using SafeERC20 for IERC20;

    address public immutable engine;
    address public immutable treasury;

    uint256 public sweepCount;
    address public lastSwept;

    constructor(address engine_, address treasury_) {
        engine = engine_;
        treasury = treasury_;
    }

    receive() external payable { }

    function sweepToken(address token) external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 toTreasury = (balance * 1_000) / 10_000;
        ++sweepCount;
        lastSwept = token;
        IERC20(token).safeTransfer(engine, balance - toTreasury);
        IERC20(token).safeTransfer(treasury, toTreasury);
    }
}

/// @dev Re-enters the router from the ETH-out delivery callback.
contract ReentrantRecipient {
    FeeRouter public router;
    bool public armed;

    function arm(FeeRouter router_) external {
        router = router_;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        router.swapExactInputSingle(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(router.weth()),
                tokenOut: address(0xDEAD),
                fee: 100,
                recipient: address(this),
                amountIn: 1,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
    }
}

/// @dev A same-slot upgrade target; only the constructor and a new function differ.
contract FeeRouterV2 is FeeRouter {
    constructor(address weth_, address swapRouter_, address splitter_, uint256 feeCeilingBps_)
        FeeRouter(weth_, swapRouter_, splitter_, feeCeilingBps_)
    { }

    function version() external pure returns (uint256) {
        return 2;
    }
}

// ---------------------------------------------------------------- tests

contract FeeRouterTest is Test {
    uint256 constant FEE_CEILING = 100;
    uint256 constant FEE_BPS = 20;

    MockWeth weth;
    MockToken usdg;
    MockToken spark;
    MockSplitter splitter;
    MockSwapRouter swapRouter;
    FeeRouter router;
    FeeRouter impl;

    address owner = address(this);
    address alice = address(0xA11CE);
    address treasury = address(0x7EA5);
    address engine = address(0xE1161);

    event FeeRouted(address indexed asset, uint256 amount, bool inEth);
    event SwapExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 fee,
        uint256 amountOut,
        address recipient
    );

    function setUp() public {
        weth = new MockWeth();
        usdg = new MockToken("Global Dollar", "USDG");
        spark = new MockToken("Sparky", "SPARKY");
        splitter = new MockSplitter(engine, treasury);
        swapRouter = new MockSwapRouter(weth);
        swapRouter.setOutRate(2e18); // 1 input → 2 output, so fee and output are both visible

        impl = new FeeRouter(address(weth), address(swapRouter), address(splitter), FEE_CEILING);
        router = FeeRouter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(FeeRouter.initialize, ()))
                ))
        );

        // Fund fabricated WETH (minted to the mock router below) so it can always be withdrawn.
        vm.deal(address(weth), 10_000 ether);
        weth.mint(address(swapRouter), 1_000_000e18); // WETH inventory for ETH-out trades
        usdg.mint(address(swapRouter), 1_000_000e18); // USDG inventory
        spark.mint(address(swapRouter), 1_000_000e18); // SPARKY inventory

        vm.deal(alice, 100 ether);
    }

    function _ethIn(uint256 amountIn, uint256 value, uint256 deadline)
        private
        returns (uint256 amountOut)
    {
        vm.prank(alice);
        amountOut = router.swapExactInputSingle{ value: value }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: amountIn,
                amountOutMinimum: 0,
                deadline: deadline
            })
        );
    }

    // ---------------------------------------------------------------- wiring

    function test_initialize_bindsOwnerAndDisablesTheImplementation() public view {
        assertEq(router.owner(), owner, "the proxy's initializer did not bind the owner");
        assertEq(impl.owner(), address(0), "the implementation must stay unowned");
    }

    function test_initialize_secondCallReverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        router.initialize();
    }

    function test_wiring_constantsAndImmutables() public view {
        assertEq(router.FEE_BPS(), 20, "FEE_BPS must be 0.20%");
        assertEq(router.feeBps(), 20, "feeBps() must mirror FEE_BPS");
        assertEq(router.BPS_DENOMINATOR(), 10_000);
        assertLe(router.FEE_BPS(), router.feeCeilingBps(), "fee above its ceiling");
        assertLe(router.feeCeilingBps(), router.MAX_FEE_CEILING_BPS(), "ceiling above the hard cap");
        assertEq(router.feeCeilingBps(), FEE_CEILING);
        assertEq(address(router.weth()), address(weth));
        assertEq(address(router.swapRouter()), address(swapRouter));
        assertEq(router.splitter(), address(splitter), "the fee destination must be the splitter");
    }

    function test_constructor_rejectsZeroWiring() public {
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(0), address(swapRouter), address(splitter), FEE_CEILING);

        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(weth), address(0), address(splitter), FEE_CEILING);

        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        new FeeRouter(address(weth), address(swapRouter), address(0), FEE_CEILING);
    }

    function test_constructor_rejectsBadCeiling() public {
        vm.expectRevert(FeeRouter.BadFeeCeiling.selector);
        new FeeRouter(address(weth), address(swapRouter), address(splitter), FEE_BPS - 1);

        vm.expectRevert(FeeRouter.BadFeeCeiling.selector);
        new FeeRouter(address(weth), address(swapRouter), address(splitter), 101);
    }

    // ---------------------------------------------------------------- fee math

    function test_feeMath_truncatesInTheProtocolsFavour() public {
        // 999 wei input → floor(999 × 20 / 10000) = 1 wei fee, 998 wei swapped.
        (uint256 toHoldersBefore, uint256 toTreasuryBefore, uint256 splitterEthBefore) =
            _splitterSnapshots();

        uint256 aliceBefore = alice.balance;
        uint256 out = _ethIn(999, 999, block.timestamp);

        assertEq(out, ((999 - 1) * 2e18) / 1e18, "the swap did not use the net input");
        assertEq(swapRouter.lastAmountIn(), 998, "the router must swap amountIn minus fee");
        assertEq(
            splitterEthBefore + 1,
            address(splitter).balance,
            "the 1 wei fee must reach the splitter"
        );
        assertEq(alice.balance, aliceBefore - 999, "the caller must pay exactly the input");

        (uint256 toHoldersAfter, uint256 toTreasuryAfter, uint256 splitterEthAfter) =
            _splitterSnapshots();
        assertEq(
            toHoldersAfter, toHoldersBefore, "an ETH fee must wait in the splitter for distribute()"
        );
        assertEq(
            toTreasuryAfter,
            toTreasuryBefore,
            "an ETH fee must wait in the splitter for distribute()"
        );
        assertEq(splitterEthAfter, splitterEthBefore + 1);
    }

    function test_feeMath_zeroFeeBelowOneBasisPointOfDust() public {
        // 499 wei × 20 / 10000 = 0 → no fee leg at all, the whole input swaps.
        uint256 splitterBefore = address(splitter).balance;
        uint256 out = _ethIn(499, 499, block.timestamp);

        assertEq(out, (499 * 2e18) / 1e18);
        assertEq(
            swapRouter.lastAmountIn(), 499, "nothing may be deducted when the fee truncates to 0"
        );
        assertEq(address(splitter).balance, splitterBefore, "no dust fee may be charged");
    }

    // ---------------------------------------------------------------- ETH-in

    function test_ethIn_routesFeeToTheSplitterAndSwapsTheNet() public {
        uint256 amountIn = 1 ether;
        uint256 fee = (amountIn * FEE_BPS) / 10_000; // 0.002 ether
        uint256 netIn = amountIn - fee;

        uint256 splitterBefore = address(splitter).balance;
        uint256 aliceBefore = alice.balance;

        vm.expectEmit(true, false, false, true, address(router));
        emit FeeRouted(address(0), fee, true);
        vm.expectEmit(true, true, true, true, address(router));
        emit SwapExecuted(alice, address(weth), address(usdg), amountIn, fee, netIn * 2, alice);

        uint256 out = _ethIn(amountIn, amountIn, block.timestamp);

        assertEq(out, netIn * 2, "the quote must be built on the net input");
        assertEq(
            address(splitter).balance, splitterBefore + fee, "exactly 0.20% must reach the splitter"
        );
        assertEq(alice.balance, aliceBefore - amountIn, "the caller must pay exactly the input");
        assertEq(usdg.balanceOf(alice), netIn * 2, "the recipient did not receive the output");
        assertEq(swapRouter.lastTokenIn(), address(weth), "ETH-in must swap WETH");
        assertEq(swapRouter.lastAmountIn(), netIn);
        assertEq(swapRouter.lastRecipient(), alice);
        assertEq(address(router).balance, 0, "the router may not keep native value");
        assertEq(weth.balanceOf(address(router)), 0, "the router may not keep WETH");
    }

    function test_ethIn_refundsUnspentValue() public {
        uint256 aliceBefore = alice.balance;

        _ethIn(1 ether, 1.5 ether, block.timestamp);

        assertEq(alice.balance, aliceBefore - 1 ether, "the unspent 0.5 ether must be refunded");
        assertEq(address(router).balance, 0);
    }

    // ---------------------------------------------------------------- ETH-out

    function test_ethOut_unwrapsAndPaysTheRecipient() public {
        uint256 amountIn = 1_000e6;
        uint256 fee = (amountIn * FEE_BPS) / 10_000;
        uint256 netIn = amountIn - fee;
        uint256 expectedOut = (netIn * swapRouter.outRate()) / 1e18;

        usdg.mint(alice, amountIn);
        vm.prank(alice);
        usdg.approve(address(router), amountIn);

        uint256 engineBefore = usdg.balanceOf(engine);
        uint256 treasuryBefore = usdg.balanceOf(treasury);
        uint256 aliceEthBefore = alice.balance;

        vm.prank(alice);
        uint256 out = router.swapExactInputSingle(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(weth),
                fee: 100,
                recipient: alice,
                amountIn: amountIn,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );

        assertEq(out, expectedOut, "the WETH output must be unwrapped to ETH");
        assertEq(
            alice.balance, aliceEthBefore + expectedOut, "native output must reach the recipient"
        );
        assertEq(usdg.balanceOf(alice), 0, "the full input must be pulled in");

        // The ERC-20 fee leg: the splitter sweeps it 90/10 in the same transaction.
        uint256 toTreasury = (fee * 1_000) / 10_000;
        assertEq(splitter.sweepCount(), 1, "the ERC-20 fee must settle through the splitter");
        assertEq(splitter.lastSwept(), address(usdg));
        assertEq(usdg.balanceOf(engine), engineBefore + fee - toTreasury, "the engine leg is 90%");
        assertEq(usdg.balanceOf(treasury), treasuryBefore + toTreasury, "the treasury leg is 10%");
        assertEq(usdg.balanceOf(address(splitter)), 0, "the splitter keeps nothing");
        assertEq(usdg.balanceOf(address(router)), 0, "the router may not keep the input");
        assertEq(weth.balanceOf(address(router)), 0, "the router may not keep WETH");
        assertEq(address(router).balance, 0, "the router may not keep native value");
    }

    // ---------------------------------------------------------------- token → token

    function test_tokenToToken_feeIsInputSide() public {
        uint256 amountIn = 500e6;
        uint256 fee = (amountIn * FEE_BPS) / 10_000;
        uint256 netIn = amountIn - fee;

        usdg.mint(alice, amountIn);
        vm.prank(alice);
        usdg.approve(address(router), amountIn);

        vm.expectEmit(true, false, false, true, address(router));
        emit FeeRouted(address(usdg), fee, false);

        vm.prank(alice);
        uint256 out = router.swapExactInputSingle(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(spark),
                fee: 100,
                recipient: alice,
                amountIn: amountIn,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );

        assertEq(out, netIn * 2);
        assertEq(spark.balanceOf(alice), netIn * 2, "the output goes to the caller-named recipient");
        assertEq(swapRouter.lastTokenIn(), address(usdg));
        assertEq(swapRouter.lastTokenOut(), address(spark));
        assertEq(swapRouter.lastAmountIn(), netIn, "only the net input is swapped");
        assertEq(splitter.sweepCount(), 1);
    }

    // ---------------------------------------------------------------- validation

    function test_revert_expiredDeadline() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.DeadlineExpired.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                deadline: block.timestamp - 1
            })
        );
    }

    function test_deadline_atTheBoundaryIsAccepted() public {
        _ethIn(1 ether, 1 ether, block.timestamp);
    }

    function test_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.ZeroAmount.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 0,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
    }

    function test_revert_zeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: address(0),
                amountIn: 1 ether,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
    }

    function test_revert_badPair() public {
        // WETH on both sides (native in AND native out) — nonsense.
        vm.prank(alice);
        vm.expectRevert(FeeRouter.BadPair.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(weth),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );

        // The same token on both sides (no native side at all) — no pool can exist.
        usdg.mint(alice, 1e6);
        vm.startPrank(alice);
        usdg.approve(address(router), 1e6);
        vm.expectRevert(FeeRouter.BadPair.selector);
        router.swapExactInputSingle(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1e6,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
        vm.stopPrank();
    }

    function test_revert_valueOnTokenIn() public {
        usdg.mint(alice, 1e6);
        vm.startPrank(alice);
        usdg.approve(address(router), 1e6);
        vm.expectRevert(FeeRouter.UnexpectedValue.selector);
        router.swapExactInputSingle{ value: 1 }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(spark),
                fee: 100,
                recipient: alice,
                amountIn: 1e6,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
        vm.stopPrank();
    }

    function test_revert_insufficientValue() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.InsufficientValue.selector);
        router.swapExactInputSingle{ value: 0.5 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
    }

    function test_revert_slippageLeavesNoFee() public {
        uint256 splitterBefore = address(splitter).balance;

        // The mock router enforces the floor: output (1×) < floor (2×) ⇒ revert.
        vm.prank(alice);
        vm.expectRevert(bytes("Too little received"));
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 2 ether,
                deadline: block.timestamp
            })
        );

        assertEq(address(splitter).balance, splitterBefore, "a failed swap must not charge a fee");
    }

    function test_revert_insufficientOutput_whenTheRouterIgnoresTheFloor() public {
        swapRouter.setIgnoreMinimum(true);

        vm.prank(alice);
        vm.expectRevert(FeeRouter.InsufficientOutput.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 3 ether,
                deadline: block.timestamp
            })
        );
    }

    function test_revert_reentrancy() public {
        swapRouter.setReenter(router);

        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.swapExactInputSingle{ value: 1 ether }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: 100,
                recipient: alice,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
    }

    /// @dev An ETH-out recipient that re-enters from `receive()`: the nested swap is refused by the
    /// guard, so the delivery fails and `Address.sendValue` reverts the whole swap (nothing settles
    /// half-way, and no fee is charged).
    function test_revert_reentrantRecipientFailsTheDelivery() public {
        ReentrantRecipient attacker = new ReentrantRecipient();
        attacker.arm(router);

        usdg.mint(alice, 1e6);
        vm.startPrank(alice);
        usdg.approve(address(router), 1e6);
        vm.expectRevert(Errors.FailedCall.selector);
        router.swapExactInputSingle(
            FeeRouter.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(weth),
                fee: 100,
                recipient: address(attacker),
                amountIn: 1e6,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- admin

    function test_upgrade_onlyOwner_andSurvives() public {
        FeeRouterV2 v2 =
            new FeeRouterV2(address(weth), address(swapRouter), address(splitter), FEE_CEILING);

        vm.prank(alice);
        vm.expectRevert(FeeRouter.NotOwner.selector);
        router.upgradeToAndCall(address(v2), "");

        router.upgradeToAndCall(address(v2), "");
        assertEq(FeeRouterV2(payable(address(router))).version(), 2, "the upgrade did not land");
        assertEq(router.owner(), owner, "the upgrade must not disturb the owner");

        // The upgraded router still swaps.
        uint256 out = _ethIn(1 ether, 1 ether, block.timestamp);
        assertGt(out, 0);
    }

    function test_transferOwnership_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(FeeRouter.NotOwner.selector);
        router.transferOwnership(alice);

        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.transferOwnership(address(0));

        router.transferOwnership(alice);
        assertEq(router.owner(), alice);

        // The old owner lost upgrade authority.
        FeeRouterV2 v2 =
            new FeeRouterV2(address(weth), address(swapRouter), address(splitter), FEE_CEILING);
        vm.expectRevert(FeeRouter.NotOwner.selector);
        router.upgradeToAndCall(address(v2), "");
    }

    function test_rescue_onlyOwner() public {
        vm.deal(address(router), 1 ether);
        weth.mint(address(router), 10e18);
        usdg.mint(address(router), 10e6);

        vm.startPrank(alice);
        vm.expectRevert(FeeRouter.NotOwner.selector);
        router.rescueEth(alice, 1 ether);
        vm.expectRevert(FeeRouter.NotOwner.selector);
        router.rescueToken(address(usdg), alice, 1e6);
        vm.stopPrank();

        router.rescueEth(alice, 1 ether);
        router.rescueToken(address(usdg), alice, 10e6);
        router.rescueToken(address(weth), alice, 10e18);

        assertEq(alice.balance, 100 ether + 1 ether, "rescue must move the value out");
        assertEq(usdg.balanceOf(alice), 10e6);
        assertEq(weth.balanceOf(alice), 10e18);
        assertEq(address(router).balance, 0);
    }

    function test_rescue_rejectsZeroRecipient() public {
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.rescueEth(address(0), 0);

        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.rescueToken(address(usdg), address(0), 0);
    }

    function test_receive_acceptsOnlyForcedValue() public {
        // Plain sends are accepted (the WETH unwrap path needs this) and are recoverable.
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(router).call{ value: 1 ether }("");
        assertTrue(ok);
        assertEq(address(router).balance, 1 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _splitterSnapshots() private view returns (uint256, uint256, uint256) {
        return (usdg.balanceOf(engine), usdg.balanceOf(treasury), address(splitter).balance);
    }
}
