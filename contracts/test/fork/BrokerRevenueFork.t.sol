// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { BrokerEngine } from "../../src/revenue/BrokerEngine.sol";
import { BrokerVault } from "../../src/revenue/BrokerVault.sol";
import { FeeRouter } from "../../src/revenue/FeeRouter.sol";
import { RevenueSplitter } from "../../src/revenue/RevenueSplitter.sol";
import { IPonsCurve } from "../../src/revenue/interfaces/IPons.sol";

/// @title BrokerRevenueFork — the full revenue loop on a **pinned Robinhood Chain (4663) fork**
/// (W.8 / C.9), against the REAL deployed contracts.
///
/// buy SPARKYTEST on the real Pons curve → clock in / fuse real brokers → sweep the real curve fees
/// through the real splitter → settle a real (daily) round → deliver into the real BrokerVault →
/// withdraw real ETH. The W.7 fee-router proof extends the same run: a user-signed ETH→USDG swap
/// through `FeeRouter` on the REAL WETH/USDG pool leaves exactly 0.20% in the splitter, and
/// `distribute()` carries that fee into `pendingPot` and through the loop. The only stubbed thing is
/// the **collection's ownership oracle**: the OpenSea drop has minted nothing at the pinned block,
/// so a minimal ERC-721 is etched at the real NFT address (see `BrokerNftStub`), and the test asserts
/// that premise first — the moment the real drop mints, the assertion fails and this stub must be
/// re-evaluated.
///
/// ⚠️ **The fork must use an ARCHIVE endpoint.** The public RPC prunes state after ~3h and anvil
/// fetches state lazily, so a stale pin fails as an unrelated revert instead of an expired pin.
///
/// Run it:
/// ```bash
/// export ROBINHOOD_MAINNET_RPC=<archive endpoint for 4663>
/// forge test --match-contract BrokerRevenueFork -vv
/// ```
/// It skips (loudly) when the variable is unset, so the default suite needs no network.
contract BrokerRevenueForkTest is Test {
    uint256 internal constant ROBINHOOD_MAINNET = 4663;

    /// @dev Pinned 2026-09-17, AFTER the engine upgrade (the fixed impl `0x6c36…5736` landed at
    /// block 65,126,350; USDG was registered at 65,126,399). The deployed revenue set is from
    /// 2026-09-16 and the drop is still unminted at this block — the test asserts that premise
    /// first. Re-pin deliberately, never silently — a pinned block makes a failure reproducible.
    uint256 internal constant FORK_BLOCK = 65_126_400;

    // The beta revenue set, from contracts/deployments/4663/addresses.json (verified on-chain).
    address internal constant TOKEN = 0x790316a2a1B403b55c6E8a6857Dd768078503553; // SPARKYTEST
    address internal constant NFT = 0x706b4b449d9b007B7fbD29866122e758d9903D3F; // Sparky Broker - Test
    address payable internal constant ENGINE = payable(0x08a578D2Fa194E24786f5644AFabC578f2daDB43); // proxy
    address internal constant VAULT = 0x4B0b09086Bd1D3c3D6eF94BC59D36ba8e37B8455;
    address payable internal constant SPLITTER =
        payable(0xD4dD7E2CAfBcC40f25d2D5Fb975B8E6E033609C1);
    address internal constant CURVE = 0xbE38eE16810d2ac0a9AA944fdDd68b07a5E17C53;
    address internal constant TREASURY = 0x376293DDb027555aB7F483c00e1D61b2a7757dE8;
    address internal constant ENGINE_OWNER = 0x376293DDb027555aB7F483c00e1D61b2a7757dE8;

    // The real 4663 swap venue the fee-router sits in front of (W.7c).
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; // 6 dp
    address internal constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    uint24 internal constant POOL_FEE = 100; // the live WETH/USDG tier

    address internal constant ZERO = address(0);

    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return; // test skips; the default suite stays offline
        vm.createSelectFork(rpc, FORK_BLOCK);

        assertEq(block.chainid, ROBINHOOD_MAINNET, "not forked onto Robinhood Chain 4663");
        assertGt(
            ENGINE.code.length,
            0,
            "no engine code at the pinned block - wrong chain or non-archive RPC"
        );

        // The premise that makes the stub legitimate: the real drop has minted nothing.
        (bool ok, bytes memory ret) = NFT.staticcall(abi.encodeWithSignature("totalSupply()"));
        assertTrue(
            ok, "the collection has no totalSupply() - re-check the stub against the real drop"
        );
        assertEq(
            abi.decode(ret, (uint256)), 0, "the drop has MINTED - stop stubbing, use real tokens"
        );

        // Etch the ownership oracle at the real address, with ERC721A-like revert-on-missing
        // semantics (the engine's `_reconcileOwner` try/catch depends on that distinction).
        BrokerNftStub stub = new BrokerNftStub();
        vm.etch(NFT, address(stub).code);

        forkReady = true;
    }

    // ---------------------------------------------------------------- the loop

    /// @notice buy → clock in → fuse → sweep → settle → deliver → withdraw, all real.
    function test_fork_fullRevenueLoop_endToEnd() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        address holder = _buyClockInAndFuseAfterTheRewind();

        (uint256 toHolders, uint256 toTreasury) = _sweepCurveFees();
        assertGt(toHolders, 0, "the buy accrued no sweeping fee - check the curve's fee path");
        // The splitter keeps nothing: 90% to the engine, 10% to the treasury, truncated to the wei.
        assertEq(
            toHolders,
            (toHolders + toTreasury) - ((toHolders + toTreasury) * 1000) / 10_000,
            "not 90/10"
        );
        uint256 banked = _settleRoundAndDeliver();
        assertGt(banked, 0, "nothing reached the vault");

        address[] memory eth = new address[](1);
        eth[0] = ZERO;

        // The vault pays `ownerOf(id)` and nobody else.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        BrokerVault(VAULT).withdraw(2, eth);

        uint256 holderBefore = holder.balance;
        vm.prank(holder);
        BrokerVault(VAULT).withdraw(2, eth);
        assertEq(holder.balance, holderBefore + banked, "the holder did not receive the balance");
        assertEq(BrokerVault(VAULT).balanceOf(2, ZERO), 0, "the vault still owes this broker");
    }

    // ---------------------------------------------------------------- the fee-router (W.7)

    /// @notice The 0.20% swap fee on the REAL WETH/USDG pool: a user-signed ETH→USDG swap through
    /// `FeeRouter` leaves exactly 0.20% of the input in the splitter as ETH (at `receive()`), then
    /// `distribute()` pushes the 90% holder leg into the engine's `pendingPot` — and the W.8 loop
    /// (settle → deliver → withdraw) pays it through to the broker holder.
    function test_fork_feeRouter_ethInFeeReachesTheSplitterAndTheLoop() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        address holder = _buyClockInAndFuseAfterTheRewind();
        FeeRouter router = _deployFeeRouter();
        assertEq(router.splitter(), SPLITTER, "the fee destination must be the real splitter");
        assertEq(router.feeBps(), 20, "the fee must be 0.20%");

        _swapEthToUsdgOnTheRealPool(router, holder);
        _distributeTheFee();

        // The existing W.8 loop pays it through: settle → deliver → withdraw.
        uint256 banked = _settleRoundAndDeliver();
        assertGt(banked, 0, "nothing reached the vault");

        address[] memory eth = new address[](1);
        eth[0] = ZERO;
        uint256 holderBefore = holder.balance;
        vm.prank(holder);
        BrokerVault(VAULT).withdraw(2, eth);
        assertEq(holder.balance, holderBefore + banked, "the holder did not receive the fee");
        assertEq(BrokerVault(VAULT).balanceOf(2, ZERO), 0, "the vault still owes this broker");
    }

    /// @dev A user-signed ETH→USDG swap through the fee-router against the REAL pool: output to the
    /// holder, exactly 0.20% of the input left in the splitter as ETH, nothing retained by the router.
    function _swapEthToUsdgOnTheRealPool(FeeRouter router, address holder) internal {
        uint256 amountIn = 0.01 ether;
        uint256 fee = (amountIn * router.feeBps()) / 10_000;
        uint256 splitterBefore = SPLITTER.balance;
        uint256 usdgBefore = IERC20(USDG).balanceOf(holder);

        vm.prank(holder);
        uint256 usdgOut = router.swapExactInputSingle{ value: amountIn }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: USDG,
                fee: POOL_FEE,
                recipient: holder,
                amountIn: amountIn,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );

        assertGt(usdgOut, 0, "the real WETH/USDG pool returned nothing - re-pin the fork");
        assertEq(
            IERC20(USDG).balanceOf(holder),
            usdgBefore + usdgOut,
            "the recipient received the output"
        );
        assertEq(
            SPLITTER.balance, splitterBefore + fee, "the splitter's ETH must grow by exactly 0.20%"
        );
        assertEq(address(router).balance, 0, "the router must keep no native value");
        assertEq(IERC20(WETH).balanceOf(address(router)), 0, "the router must keep no WETH");
    }

    /// @dev The fee waits in the splitter until anyone distributes it: 90% to the engine (whose
    /// receive() books pendingPot), 10% to the treasury. Deltas, never absolutes — the pinned block
    /// may already carry revenue.
    function _distributeTheFee() internal {
        uint256 engineBefore = ENGINE.balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 potBefore = BrokerEngine(ENGINE).pendingPot(ZERO);
        uint256 toSplit = SPLITTER.balance;

        RevenueSplitter(SPLITTER).distribute(); // permissionless

        uint256 toHolders = ENGINE.balance - engineBefore;
        uint256 toTreasury = TREASURY.balance - treasuryBefore;
        assertEq(toHolders + toTreasury, toSplit, "the splitter must keep nothing");
        assertEq(toHolders, toSplit - (toSplit * 1000) / 10_000, "not 90/10");
        assertEq(
            BrokerEngine(ENGINE).pendingPot(ZERO),
            potBefore + toHolders,
            "the fee leg did not reach pendingPot"
        );
    }

    /// @dev Deploy the fee-router against the real 4663 venue: the real WETH, the real SwapRouter02,
    /// and the real splitter as the immutable fee destination.
    function _deployFeeRouter() internal returns (FeeRouter) {
        FeeRouter impl = new FeeRouter(WETH, SWAP_ROUTER, SPLITTER, 100);
        return FeeRouter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(FeeRouter.initialize, ()))
                ))
        );
    }

    /// @dev Steps 1-3, in the corrected order: buy real tokens, own two stub brokers, clock both
    /// in, advance the grid PAST the rewind, then fuse.
    ///
    /// ⚠️ The advance matters against the DEPLOYED engine: in the rewind window a fuse records an
    /// already-closed promotion boundary (the defect pinned below). Once `currentRound()` is ahead
    /// of `settledRound()`, the queued weight keys on a future round and the increase applies from
    /// the next settled round — the intended economics.
    function _buyClockInAndFuseAfterTheRewind() internal returns (address holder) {
        holder = _fundAndBuy();
        _mintAndClockTwo(holder);
        _advancePastTheRewind();
        _fuseTwoIntoOne(holder);
    }

    function _fundAndBuy() internal returns (address holder) {
        holder = makeAddr("holder");
        vm.deal(holder, 10 ether);

        uint256 buyIn = 0.05 ether;
        vm.prank(holder);
        uint256 bought = IPonsCurveBuy(CURVE).buy{ value: buyIn }(buyIn, 0, holder);
        assertGt(bought, 0, "the curve sold nothing");
        assertEq(IERC20(TOKEN).balanceOf(holder), bought, "the buyer did not receive the tokens");
    }

    function _mintAndClockTwo(address holder) internal {
        BrokerNftStub(NFT).mint(holder, 1);
        BrokerNftStub(NFT).mint(holder, 2);

        vm.startPrank(holder);
        IERC20(TOKEN).approve(ENGINE, type(uint256).max);
        BrokerEngine(ENGINE).clockIn(1);
        BrokerEngine(ENGINE).clockIn(2);
        vm.stopPrank();

        assertTrue(BrokerEngine(ENGINE).isActive(1), "broker 1 is not active");
        assertEq(BrokerEngine(ENGINE).rankOf(1), 1, "clocking in grants rank 1");
    }

    function _fuseTwoIntoOne(address holder) internal {
        vm.startPrank(holder);
        BrokerNftStub(NFT).setApprovalForAll(ENGINE, true);
        uint256[] memory pair = new uint256[](2);
        pair[0] = 2;
        pair[1] = 1;
        BrokerEngine(ENGINE).fuse(pair);
        vm.stopPrank();

        assertEq(BrokerEngine(ENGINE).parts(2), 2, "the survivor is not a two-part fusion");
        // 100 (its rank) + 100 (absorbed raw weight) = 200 raw, +25% fusion bonus = 250.
        assertEq(BrokerEngine(ENGINE).deriveWeight(2), 250, "unexpected fused weight");
        assertEq(BrokerEngine(ENGINE).totalWeight(), 100, "the queued weight must not count yet");
    }

    /// @dev Step 4: the permissionless sweep of the real curve through the real splitter.
    /// ⚠️ The assertion is on the pot's DELTA: the engine already holds whatever earlier revenue
    /// left in it at the pinned block, so an absolute comparison would fail for the wrong reason.
    function _sweepCurveFees() internal returns (uint256 toHolders, uint256 toTreasury) {
        uint256 potBefore = BrokerEngine(ENGINE).pendingPot(ZERO);
        uint256 engineBefore = ENGINE.balance;
        uint256 treasuryBefore = TREASURY.balance;
        RevenueSplitter(SPLITTER).sweepCurve(CURVE, 0); // permissionless
        toHolders = ENGINE.balance - engineBefore;
        toTreasury = TREASURY.balance - treasuryBefore;
        assertEq(
            BrokerEngine(ENGINE).pendingPot(ZERO),
            potBefore + toHolders,
            "the pot does not hold the holder leg"
        );
    }

    /// @dev Warp to the first timestamp at which the next unsettled round can close. The engine's
    /// grid keys on `START` and the current `ROUND`, so the warp is computed, never guessed.
    function _warpToNextRound() internal returns (uint256 target) {
        target = BrokerEngine(ENGINE).settledRound() + 1;
        uint256 targetTime =
            BrokerEngine(ENGINE).START() + target * BrokerEngine(ENGINE).ROUND() + 1;
        if (block.timestamp < targetTime) vm.warp(targetTime);
    }

    /// @dev The grid must run ahead of `settledRound` before an increase is queued, or the
    /// rewind-window boundary lands in the past.
    function _advancePastTheRewind() internal {
        _warpToNextRound();
        assertGt(
            BrokerEngine(ENGINE).currentRound(),
            BrokerEngine(ENGINE).settledRound(),
            "still in the rewind window"
        );
    }

    /// @dev Steps 5-6: close the next (daily) round, settle, deliver the survivor into the vault.
    function _settleRoundAndDeliver() internal returns (uint256 banked) {
        uint256 target = _warpToNextRound();

        BrokerEngine(ENGINE).settle(); // permissionless
        assertEq(BrokerEngine(ENGINE).settledRound(), target, "the round did not close");
        assertEq(BrokerEngine(ENGINE).pendingPot(ZERO), 0, "the pot was not spent");

        uint256[] memory one = new uint256[](1);
        one[0] = 2;
        BrokerEngine(ENGINE).deliver(one); // permissionless

        banked = BrokerVault(VAULT).balanceOf(2, ZERO);
        assertEq(BrokerVault(VAULT).assetsOf(2)[0], ZERO, "ETH is not a recorded asset");
    }

    // ---------------------------------------------------------------- the rewind fix (post-upgrade)

    /// @notice ✅ **The rewind-window fix, proven against the UPGRADED engine (impl `0x6c36…5736`).**
    ///
    /// `setRoundSeconds(86400)` put `currentRound()` behind `settledRound()`; a fuse inside that
    /// window used to record an already-closed promotion boundary, so `_crystallise` paid the ENTIRE
    /// accumulator at the queued weight while `settle()` divided the pot by the old `totalWeight` —
    /// the engine owed more than it held and `deliver` reverted `OutOfFunds`. `_changeWeight` now
    /// keys the boundary on `settledRound + 1`, so the queued weight earns only from the next closed
    /// round: `owed ≤ held`, and the delivery lands.
    function test_fork_rewindWindow_fuseIsNotRetroactive() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        assertLt(
            BrokerEngine(ENGINE).currentRound(),
            BrokerEngine(ENGINE).settledRound(),
            "the deployed grid is no longer in the rewind window - re-check this pin"
        );

        address holder = _fundAndBuy();
        _mintAndClockTwo(holder);
        _fuseTwoIntoOne(holder); // fused INSIDE the rewind window, on purpose
        _sweepCurveFees();

        _warpToNextRound();
        BrokerEngine(ENGINE).settle();

        uint256 owed = BrokerEngine(ENGINE).earnedOf(2, ZERO);
        uint256 held = ENGINE.balance;
        assertLe(owed, held, "the engine owes more than it holds - the rewind fix is not live");

        uint256[] memory one = new uint256[](1);
        one[0] = 2;
        BrokerEngine(ENGINE).deliver(one); // used to revert OutOfFunds
        assertGt(BrokerVault(VAULT).balanceOf(2, ZERO), 0, "the delivery did not bank the revenue");
    }

    // ---------------------------------------------------------------- the push intake (post-upgrade)

    /// @notice ✅ **The post-graduation ERC-20 leg, proven against the UPGRADED engine.**
    ///
    /// After graduation the Pons v4 hook can charge the creator fee in the swap's OUTPUT token, so
    /// `RevenueSplitter.sweepToken` pushes the holder leg to the engine as a bare transfer. The
    /// upgraded engine books it: `sweepAsset(asset)` credits `balanceOf(this) − accountedAsset[asset]`
    /// into `pendingPot` and raises the watermark, so the pushed tokens are counted exactly once and
    /// a later pull-deposit books only its own delta.
    function test_fork_postGradTokenLeg_pushIsBooked() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        // Stand-in for the hook's ERC-20 creator fee landing on the splitter.
        deal(TOKEN, SPLITTER, 10_000e18);
        uint256 engineTokensBefore = IERC20(TOKEN).balanceOf(ENGINE);
        RevenueSplitter(SPLITTER).sweepToken(TOKEN);
        uint256 pushed = IERC20(TOKEN).balanceOf(ENGINE) - engineTokensBefore;
        assertEq(pushed, 9_000e18, "the splitter moved the 90% holder leg to the engine");

        // Nothing is booked by the transfer itself; the intake books the balance above the
        // watermark, and the asset must be registered (owner-managed registry).
        assertEq(BrokerEngine(ENGINE).pendingPot(TOKEN), 0, "nothing is booked before sweepAsset");
        vm.prank(ENGINE_OWNER);
        BrokerEngine(ENGINE).addAsset(TOKEN);

        BrokerEngine(ENGINE).sweepAsset(TOKEN); // permissionless
        assertEq(BrokerEngine(ENGINE).pendingPot(TOKEN), 9_000e18, "the pushed leg must be booked");
        assertEq(
            BrokerEngine(ENGINE).accountedAsset(TOKEN), 9_000e18, "the watermark must be raised"
        );

        // Nothing books twice: the same balance cannot be credited again…
        vm.expectRevert(BrokerEngine.NothingToDeposit.selector);
        BrokerEngine(ENGINE).sweepAsset(TOKEN);

        // …and a pull-deposit books exactly the new delta.
        address depositor = makeAddr("depositor");
        deal(TOKEN, depositor, 1_000e18);
        vm.startPrank(depositor);
        IERC20(TOKEN).approve(ENGINE, 1_000e18);
        BrokerEngine(ENGINE).depositAsset(TOKEN, 1_000e18);
        vm.stopPrank();

        assertEq(
            BrokerEngine(ENGINE).pendingPot(TOKEN), 10_000e18, "a pull-deposit books its own delta"
        );
        assertEq(
            BrokerEngine(ENGINE).accountedAsset(TOKEN),
            10_000e18,
            "the watermark tracks the balance"
        );
    }
}

interface IPonsCurveBuy {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
}

/// @dev The engine's and vault's ownership oracle, etched over the real (unminted) collection.
/// Deliberately small: `ownerOf` reverts for a missing token the way ERC-721A does, `burn` is
/// holder/approved-gated the way the real clone's is, and `setApprovalForAll` is the approval the
/// engine needs to absorb a broker in a fusion. The engine also reads `burn` only for the absorbed
/// ids — nothing else about the collection participates in this proof.
contract BrokerNftStub {
    error Nonexistent();
    error NotAuthorized();

    mapping(uint256 => address) private _owner;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function mint(address to, uint256 id) external {
        _owner[id] = to;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address owner = _owner[id];
        if (owner == address(0)) revert Nonexistent();
        return owner;
    }

    function setApprovalForAll(address operator, bool ok) external {
        isApprovedForAll[msg.sender][operator] = ok;
    }

    function burn(uint256 id) external {
        address owner = _owner[id];
        if (owner == address(0)) revert Nonexistent();
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert NotAuthorized();
        delete _owner[id];
    }
}
