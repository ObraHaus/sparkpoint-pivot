// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { VaultTestBase } from "../utils/VaultTestBase.sol";
import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { ICapRegistry } from "../../src/interfaces/ICapRegistry.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial fixtures — every SparkPoint dependency the exit path could touch,
// forced OFFLINE, so we can try to make withdraw/redeem REVERT or short-pay.
// ─────────────────────────────────────────────────────────────────────────────

/// @notice A vault whose fee accrual ALWAYS reverts — the §6.1 fee module "offline". The N2 claim is
///         that withdraw/redeem wrap accrual in a FAIL-OPEN try/catch (SparkPointVault._tryAccrueFee),
///         so a reverting accrual can NEVER block or reduce an exit. This fixture arms that attack.
contract RevertingAccrueVault is SparkPointVault {
    constructor(
        IERC20 usdc_,
        IPool aavePool_,
        IERC20 aUSDC_,
        address guardian_,
        address capRegistry_,
        address feeRecipient_,
        uint16 performanceFeeBps_
    )
        SparkPointVault(
            usdc_, aavePool_, aUSDC_, guardian_, capRegistry_, feeRecipient_, performanceFeeBps_
        )
    { }

    function accrueFee() public pure override returns (uint256) {
        revert("ACCRUE_OFFLINE");
    }
}

/// @notice A vault whose fee accrual BURNS a large amount of gas and then reverts. This is the sharper
///         version of the fail-open attack: it probes whether a gas-heavy reverting accrual can grief
///         the exit via the 63/64 forwarded-gas rule. Under any realistic gas budget the try/catch
///         still returns with ample gas for the unwind, so the exit must still complete (N2).
contract GasBombAccrueVault is SparkPointVault {
    constructor(
        IERC20 usdc_,
        IPool aavePool_,
        IERC20 aUSDC_,
        address guardian_,
        address capRegistry_,
        address feeRecipient_,
        uint16 performanceFeeBps_
    )
        SparkPointVault(
            usdc_, aavePool_, aUSDC_, guardian_, capRegistry_, feeRecipient_, performanceFeeBps_
        )
    { }

    function accrueFee() public pure override returns (uint256) {
        bytes32 h = keccak256("burn");
        for (uint256 i = 0; i < 20_000; i++) {
            h = keccak256(abi.encodePacked(h, i));
        }
        // `h` is consumed by the revert reason so the loop can never be optimized away.
        revert(string(abi.encodePacked("GAS_BOMB_ACCRUE_OFFLINE", h)));
    }
}

/// @notice An ICapRegistry that can be flipped OFFLINE — every getter then reverts. Proves the exit
///         path reads NO cap surface: caps are inflow-only and NEVER gate withdraw/redeem (N2, §6 G2).
contract ToggleCapRegistry is ICapRegistry {
    bool public offline;
    uint256 private immutable _cap;

    constructor(uint256 cap_) {
        _cap = cap_;
    }

    function goOffline() external {
        offline = true;
    }

    function perUserCap() external view returns (uint256) {
        require(!offline, "REGISTRY_OFFLINE");
        return _cap;
    }

    function totalCap() external view returns (uint256) {
        require(!offline, "REGISTRY_OFFLINE");
        return _cap;
    }

    function vaultCap() external view returns (uint256) {
        require(!offline, "REGISTRY_OFFLINE");
        return _cap;
    }
}

/// @title RefuteN2 — adversarial refutation of invariant N2 (withdraw-always).
/// @notice Goal: with `paused()==true` and every SparkPoint dependency simulated OFFLINE, force
///         withdraw/redeem to REVERT or return LESS THAN OWED. Attack surface exercised:
///           (a) fee-accrual revert (is _accrueFee fail-open?),
///           (b) a gas-heavy reverting accrual (63/64 forwarded-gas grief),
///           (c) a CapRegistry dependency that reverts (cap check leaking onto exit),
///           (d) caps set BELOW live TVL (cap gate leaking onto exit),
///           (e) the deposit-side pause leaking onto the withdraw path,
///           (f) any reentrancy lock / oracle / price dependency on the exit path.
///         Every test asserts the exit STILL succeeds and pays EXACTLY what is owed. A green run =
///         N2 NOT REFUTED (the attacks fail by construction); a red assertion would be the PoC.
///         Ground truth: smart-contracts.md §6 (withdraw/redeem carry NO pause) / §6.1 (fail-open fee)
///         / §7 (direct Aave unwind); SparkPointVault.sol N2 header + _tryAccrueFee/_withdraw.
contract RefuteN2Test is VaultTestBase {
    function setUp() public {
        _deployStack();
    }

    // ── generic deposit helper against an arbitrary vault instance ──
    function _depositTo(SparkPointVault v, address user, uint256 amount)
        internal
        returns (uint256)
    {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(v), amount);
        uint256 shares = v.deposit(amount, user);
        vm.stopPrank();
        return shares;
    }

    function _deployRevertingAccrueVault(address reg) internal returns (RevertingAccrueVault v) {
        v = new RevertingAccrueVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            reg,
            feeRecipient,
            DEFAULT_FEE_BPS
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (a) Attack: fee accrual reverts + vault paused. Try to block/short-pay the exit.
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev accrueFee() ALWAYS reverts, the vault is paused, and yield has accrued above the HWM (so the
    ///      fee module WOULD want to run). redeem must still succeed and pay the FULL owed claim — with a
    ///      reverting fee leg, no dilution occurs, so the holder even keeps 100% of the yield.
    function test_refuteN2_redeem_failsOpen_whenAccrualRevertsAndPaused() public {
        RevertingAccrueVault v = _deployRevertingAccrueVault(address(caps));
        _depositTo(v, alice, 5_000e6);

        vm.prank(guardian);
        v.pauseDeposits();
        pool.accrueTo(address(v), 1_500e6); // gains above HWM; fee module would fire (but reverts)

        assertTrue(v.paused(), "precondition: vault paused");

        uint256 shares = v.balanceOf(alice);
        uint256 owed = v.convertToAssets(shares); // what the holder is owed at redeem-time pps
        assertGt(owed, 5_000e6, "precondition: yield present, owed > principal");

        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);

        assertEq(out, owed, "N2 REFUTED: redeem returned LESS THAN OWED");
        assertEq(usdc.balanceOf(alice), out, "N2 REFUTED: holder did not receive the underlying");
        assertEq(v.balanceOf(alice), 0, "shares must be fully burned");
    }

    /// @dev Same offline conditions via the withdraw(assets,...) leg (not just redeem). Request the full
    ///      maxWithdraw and require it is paid to the wei.
    function test_refuteN2_withdraw_failsOpen_whenAccrualRevertsAndPaused() public {
        RevertingAccrueVault v = _deployRevertingAccrueVault(address(caps));
        _depositTo(v, alice, 8_000e6);

        vm.prank(guardian);
        v.pauseDeposits();
        pool.accrueTo(address(v), 2_000e6);

        uint256 want = v.maxWithdraw(alice); // full liquid claim; never reduced by pause/accrual
        assertGt(want, 8_000e6, "precondition: maxWithdraw reflects principal + yield");

        vm.prank(alice);
        v.withdraw(want, alice, alice);

        assertEq(usdc.balanceOf(alice), want, "N2 REFUTED: withdraw short-paid the owed amount");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (b) Attack: gas-heavy reverting accrual (63/64 forwarded-gas grief) + paused.
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev accrueFee() burns a large amount of gas then reverts. Under a realistic (default) gas budget
    ///      the fail-open try/catch returns with ample gas remaining, so the unwind still completes and
    ///      pays in full. A gas-bomb accrual cannot grief the exit (N2). NB: in production the fee logic
    ///      is O(1) and non-upgradeable (N5) — this fixture is a stress upper-bound only.
    function test_refuteN2_gasBombAccrual_cannotGriefExit() public {
        GasBombAccrueVault v = new GasBombAccrueVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            address(caps),
            feeRecipient,
            DEFAULT_FEE_BPS
        );
        usdc.mint(alice, 6_000e6);
        vm.startPrank(alice);
        usdc.approve(address(v), 6_000e6);
        v.deposit(6_000e6, alice);
        vm.stopPrank();

        vm.prank(guardian);
        v.pauseDeposits();
        pool.accrueTo(address(v), 1_000e6);

        uint256 shares = v.balanceOf(alice);
        uint256 owed = v.convertToAssets(shares);

        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);

        assertEq(out, owed, "N2 REFUTED: gas-bomb accrual short-paid the exit");
        assertEq(usdc.balanceOf(alice), out, "N2 REFUTED: holder did not receive underlying");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (c) Attack: the CapRegistry dependency itself reverts (offline). Cap check on exit?
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Deposit while the registry is online, then flip it OFFLINE (every getter reverts) and pause.
    ///      If ANY cap surface were consulted on the exit path it would bubble the registry revert and
    ///      block the withdraw. It does not: caps are inflow-only (N2). Redeem must pay in full.
    function test_refuteN2_capRegistryOffline_doesNotBlockExit() public {
        ToggleCapRegistry reg = new ToggleCapRegistry(1e30);
        RevertingAccrueVault v = _deployRevertingAccrueVault(address(reg));

        _depositTo(v, alice, 5_000e6); // registry online here

        reg.goOffline(); // every cap getter now reverts

        // Sanity: the deposit side genuinely depends on the (now reverting) registry. Checked BEFORE
        // pausing, since maxDeposit short-circuits to 0 on pause without ever reading the registry.
        vm.expectRevert(bytes("REGISTRY_OFFLINE"));
        v.maxDeposit(alice);

        vm.prank(guardian);
        v.pauseDeposits();

        uint256 shares = v.balanceOf(alice);
        uint256 owed = v.convertToAssets(shares);

        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);

        assertEq(out, owed, "N2 REFUTED: exit read a reverting cap dependency");
        assertEq(usdc.balanceOf(alice), out, "N2 REFUTED: holder did not receive underlying");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (d) Attack: caps set BELOW live TVL. Cap gate leaking onto exit?
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Deposit at the per-user ceiling, then have governance slam all caps to 1 (far below TVL) and
    ///      pause. A cap gate on the exit would revert (CapExceeded) or clamp the payout. It does not —
    ///      maxWithdraw/maxRedeem are liquidity-clamped only, never cap-clamped (N2). Full payout owed.
    function test_refuteN2_capsBelowTVL_doNotGateExit() public {
        // Dedicated vault wired to the REAL bounded CapRegistry so governance can move the caps.
        SparkPointVault v = new SparkPointVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            address(caps),
            feeRecipient,
            DEFAULT_FEE_BPS
        );
        _depositTo(v, alice, 10_000e6); // == per-user ceiling

        vm.startPrank(governance);
        caps.setPerUserCap(1);
        caps.setTotalCap(1);
        caps.setVaultCap(1);
        vm.stopPrank();

        vm.prank(guardian);
        v.pauseDeposits();

        // TVL now vastly exceeds every cap; deposit is (correctly) refused...
        assertEq(v.maxDeposit(alice), 0, "precondition: deposit side closed by caps + pause");
        // ...but the exit is untouched.
        assertEq(v.maxWithdraw(alice), 10_000e6, "N2 REFUTED: caps clamped maxWithdraw");

        uint256 shares = v.balanceOf(alice);
        uint256 owed = v.convertToAssets(shares);
        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);

        assertEq(out, owed, "N2 REFUTED: caps gated the exit payout");
        assertEq(out, 10_000e6, "N2 REFUTED: first depositor did not get exact principal back");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (e) Attack: does the deposit-side pause leak onto the withdraw path?
    //     And assert ONLY deposit/mint carry the pause.
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev While paused: deposit AND mint must revert with DepositsArePaused; withdraw AND redeem must
    ///      both succeed. This is the behavioural proof that the pause is deposit-side ONLY (N2).
    function test_refuteN2_onlyDepositAndMintCarryThePause() public {
        _depositTo(vault, alice, 4_000e6);
        _depositTo(vault, bob, 4_000e6);

        vm.prank(guardian);
        vault.pauseDeposits();

        // deposit blocked
        usdc.mint(carol, 1_000e6);
        vm.startPrank(carol);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(SparkPointVault.DepositsArePaused.selector);
        vault.deposit(1_000e6, carol);
        // mint blocked (same deposit-side modifier)
        vm.expectRevert(SparkPointVault.DepositsArePaused.selector);
        vault.mint(1_000e6, carol);
        vm.stopPrank();

        // withdraw NOT blocked
        vm.prank(alice);
        vault.withdraw(1_000e6, alice, alice);
        assertEq(usdc.balanceOf(alice), 1_000e6, "N2 REFUTED: withdraw blocked while paused");

        // redeem NOT blocked
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        uint256 out = vault.redeem(bobShares, bob, bob);
        assertGt(out, 0, "N2 REFUTED: redeem blocked while paused");
        assertEq(usdc.balanceOf(bob), out, "N2 REFUTED: redeem paid nothing while paused");
    }

    /// @dev The exit-side max() views must NOT be reduced by pause (unlike maxDeposit/maxMint, which go
    ///      to 0). A pause leak would show up here as a shrunk maxWithdraw/maxRedeem.
    function test_refuteN2_pauseDoesNotShrinkExitCapacity() public {
        _depositTo(vault, alice, 7_000e6);

        uint256 mwBefore = vault.maxWithdraw(alice);
        uint256 mrBefore = vault.maxRedeem(alice);
        assertGt(vault.maxDeposit(alice), 0, "precondition: deposit open before pause");

        vm.prank(guardian);
        vault.pauseDeposits();

        assertEq(vault.maxDeposit(alice), 0, "deposit side closes on pause");
        assertEq(vault.maxMint(alice), 0, "mint side closes on pause");
        assertEq(vault.maxWithdraw(alice), mwBefore, "N2 REFUTED: pause shrank maxWithdraw");
        assertEq(vault.maxRedeem(alice), mrBefore, "N2 REFUTED: pause shrank maxRedeem");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (f) Source-level refutation: no pause modifier, no reentrancy lock, no oracle/
    //     price dependency, and the exit unwinds DIRECTLY against Aave.
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Comment-stripped so only real code counts. The exit path must carry no pause, no reentrancy
    ///      guard, and no oracle/price read; and it must unwind straight to the Aave Pool.
    function test_refuteN2_source_exitPathHasNoBlockingDependency() public view {
        string memory code = _stripComments(vm.readFile("src/vault/SparkPointVault.sol"));

        // Deposit-side pause exists; withdraw-side pause does NOT.
        assertTrue(_contains(code, "whenDepositsAllowed"), "deposit-side pause must exist");
        assertFalse(
            _contains(code, "whenNotPaused"), "N2 REFUTED: a whenNotPaused pause is present"
        );

        // No reentrancy lock can wedge the escape hatch.
        assertFalse(_contains(code, "nonReentrant"), "N2 REFUTED: nonReentrant guard on the vault");
        assertFalse(_contains(code, "ReentrancyGuard"), "N2 REFUTED: ReentrancyGuard mixed in");

        // No oracle / external price dependency on any path.
        assertFalse(_contains(code, "oracle"), "N2 REFUTED: oracle dependency");
        assertFalse(_contains(code, "Oracle"), "N2 REFUTED: Oracle dependency");
        assertFalse(_contains(code, "latestAnswer"), "N2 REFUTED: chainlink price read");
        assertFalse(_contains(code, "getPrice"), "N2 REFUTED: price read");

        // The exit unwinds DIRECTLY against the Aave Pool, and fee accrual is fail-open (try/catch).
        assertTrue(_contains(code, "_aavePool.withdraw"), "exit must unwind directly against Aave");
        assertTrue(
            _contains(code, "try this.accrueFee()"), "exit-path fee accrual must be fail-open"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (g) The everything-offline fuzz: no matter the size, a paused vault with a reverting fee module
    //     and an offline cap registry always pays the FULL owed claim.
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_refuteN2_fullOwedPaid_underEverythingOffline(
        uint256 depositAmt,
        uint256 yieldAmt
    ) public {
        depositAmt = bound(depositAmt, 1e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 0, 250_000e6);

        ToggleCapRegistry reg = new ToggleCapRegistry(1e30);
        RevertingAccrueVault v = _deployRevertingAccrueVault(address(reg));

        _depositTo(v, alice, depositAmt);
        if (yieldAmt > 0) pool.accrueTo(address(v), yieldAmt);

        reg.goOffline(); // cap dependency offline
        vm.prank(guardian);
        v.pauseDeposits(); // paused; fee module reverts

        uint256 shares = v.balanceOf(alice);
        uint256 owed = v.convertToAssets(shares);

        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);

        assertEq(out, owed, "N2 REFUTED: fuzz exit paid less than owed");
        assertEq(usdc.balanceOf(alice), out, "N2 REFUTED: fuzz holder underpaid");
        assertGe(out, depositAmt, "N2 REFUTED: holder redeemed below principal");
    }

    // ── comment-stripping + substring helpers (source-level refutation) ──

    function _stripComments(string memory src) internal pure returns (string memory) {
        bytes memory b = bytes(src);
        bytes memory out = new bytes(b.length);
        uint256 k;
        uint256 i;
        bytes1 slash = bytes1("/");
        bytes1 star = bytes1("*");
        bytes1 nl = bytes1("\n");
        while (i < b.length) {
            if (i + 1 < b.length && b[i] == slash && b[i + 1] == slash) {
                while (i < b.length && b[i] != nl) i++;
            } else if (i + 1 < b.length && b[i] == slash && b[i + 1] == star) {
                i += 2;
                while (i + 1 < b.length && !(b[i] == star && b[i + 1] == slash)) i++;
                i += 2;
            } else {
                out[k++] = b[i++];
            }
        }
        bytes memory res = new bytes(k);
        for (uint256 j = 0; j < k; j++) {
            res[j] = out[j];
        }
        return string(res);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
