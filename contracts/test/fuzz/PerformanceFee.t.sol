// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { VaultTestBase } from "../utils/VaultTestBase.sol";
import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A vault whose fee accrual ALWAYS reverts — used to prove the withdraw/redeem escape hatch
///         and the deposit-time HWM settle are FAIL-OPEN and independent of accrual (N2, FR-050).
contract AccrueRevertVault is SparkPointVault {
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
        revert("ACCRUE_REVERT");
    }
}

/// @title Performance-fee unit + fuzz suite (§6.1, N-fee, FR-050).
contract PerformanceFeeFuzzTest is VaultTestBase {
    function setUp() public {
        _deployStack();
    }

    function _deployAccrueRevertVault() internal returns (AccrueRevertVault v) {
        v = new AccrueRevertVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            address(caps),
            feeRecipient,
            DEFAULT_FEE_BPS
        );
    }

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

    // ── FR-050: seeded HWM / first-accrual-charges-zero ──

    /// @dev RED against the stub (HWM left unseeded at 0).
    function test_hwmSeededAtDeployment() public view {
        assertGe(vault.highWaterMark(), 1e18, "HWM must be seeded to >= 1e18 at deployment");
    }

    /// @dev First accrual at the seed price mints 0 fee and the depositor redeems exactly principal.
    ///      RED against the stub (HWM == 0).
    function test_firstAccrualAfterFirstDeposit_chargesZeroFee() public {
        uint256 amount = 1_000e6;
        _deposit(alice, amount);

        uint256 feeBefore = vault.balanceOf(feeRecipient);
        vault.accrueFee();
        assertEq(vault.balanceOf(feeRecipient), feeBefore, "first accrual must mint 0 fee");
        assertGe(vault.highWaterMark(), 1e18, "HWM must be seeded, never taxing principal");

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertEq(out, amount, "first depositor redeems exactly principal");
    }

    /// @dev A keeper accrual on gains above the HWM mints fee shares to feeRecipient + advances HWM.
    ///      RED against the stub (accrueFee is a no-op).
    function test_accrueFee_mintsFeeOnGainAboveHwm() public {
        _deposit(alice, 10_000e6);
        _simulateYield(1_000e6); // +10%

        uint256 feeBefore = vault.balanceOf(feeRecipient);
        uint256 minted = vault.accrueFee();

        assertGt(minted, 0, "fee shares must be minted on gain above HWM");
        assertGt(
            vault.balanceOf(feeRecipient), feeBefore, "feeRecipient must receive the fee shares"
        );
        assertGe(vault.highWaterMark(), 1e18, "HWM must advance past the seed");
    }

    /// @dev No fee in a flat period (guards profit-only). Passes trivially on the no-fee stub.
    function test_accrueFee_noFeeWhenFlat() public {
        _deposit(alice, 10_000e6);
        uint256 feeBefore = vault.balanceOf(feeRecipient);
        vault.accrueFee();
        assertEq(vault.balanceOf(feeRecipient), feeBefore, "no fee may be minted in a flat period");
    }

    /// @dev deposit() on a fresh high MUST itself mint the fee (accrue-FIRST ordering, FR-050 guard).
    ///      RED against the stub (deposit routes through plain OZ ERC4626 and never accrues).
    function test_depositOnFreshHigh_mintsFee() public {
        _deposit(alice, 10_000e6);
        _simulateYield(2_000e6); // pps now strictly above the HWM

        uint256 feeBefore = vault.balanceOf(feeRecipient);
        _deposit(bob, 5_000e6);
        assertGt(
            vault.balanceOf(feeRecipient),
            feeBefore,
            "deposit on a fresh high must mint the perf fee"
        );
    }

    /// @dev Late depositor: even with the fee-mint leg failing (accrueFee reverts), the deposit-time
    ///      _settleHighWaterMark fallback advances the HWM to entry pps, so the late depositor is never
    ///      charged on pre-entry yield and redeems >= principal. RED against the stub (no settle; HWM 0).
    function test_lateDepositor_notChargedOnPreEntryYield() public {
        AccrueRevertVault v = _deployAccrueRevertVault();

        _depositTo(v, alice, 10_000e6);
        pool.accrueTo(address(v), 3_000e6); // pre-entry yield
        uint256 ppsAtEntry = v.convertToAssets(1e18);

        _depositTo(v, bob, 10_000e6); // late entry; fallback must settle the HWM

        assertGe(
            v.highWaterMark(),
            ppsAtEntry,
            "deposit-time HWM settle must advance to entry pps (FR-050)"
        );

        uint256 bobShares = v.balanceOf(bob);
        vm.prank(bob);
        uint256 out = v.redeem(bobShares, bob, bob);
        // Never charged a fee on pre-entry yield: redeems his principal back, modulo the single wei of
        // OZ ERC4626 virtual-offset rounding that any offset-0 vault sheds on a deposit-redeem at pps>1.
        assertGe(
            out + 1, 10_000e6, "late depositor must redeem >= principal (modulo 1-wei rounding)"
        );
    }

    // ── N2: withdraw-always is fully independent of accrual (fail-open) ──

    /// @dev With accrueFee ALWAYS reverting AND the vault paused, redeem still succeeds.
    ///      Guard: passes trivially on the stub (inherited withdraw never calls accrual).
    function test_withdrawAlways_failOpen_independentOfAccrual() public {
        AccrueRevertVault v = _deployAccrueRevertVault();
        _depositTo(v, alice, 5_000e6);

        vm.prank(guardian);
        v.pauseDeposits();
        pool.accrueTo(address(v), 1_000e6);

        uint256 shares = v.balanceOf(alice);
        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);
        assertGt(out, 0, "N2: redeem must succeed despite a reverting accrual + paused");
    }

    /// @dev The success direction: a withdraw on gains MUST trigger the fee accrual it wraps.
    ///      RED against the stub (inherited withdraw never accrues).
    function test_withdrawTriggersAccrual_whenYield() public {
        _deposit(alice, 10_000e6);
        _simulateYield(1_000e6);

        uint256 feeBefore = vault.balanceOf(feeRecipient);
        vm.prank(alice);
        vault.withdraw(1_000e6, alice, alice);
        assertGt(vault.balanceOf(feeRecipient), feeBefore, "withdraw must accrue the fee on gains");
    }

    // ── Governance: timelocked, hard-capped feeRate + feeRecipient (RED: stub setters revert) ──

    function test_setPerformanceFeeBps_updatesRate() public {
        vm.prank(guardian);
        vault.setPerformanceFeeBps(1500);
        assertEq(vault.performanceFeeBps(), 1500, "governance must be able to set the fee rate");
    }

    function test_setPerformanceFeeBps_revertsAboveCap() public {
        vm.prank(guardian);
        vm.expectRevert(SparkPointVault.FeeExceedsCap.selector);
        vault.setPerformanceFeeBps(2001);
    }

    function test_setFeeRecipient_updates() public {
        vm.prank(guardian);
        vault.setFeeRecipient(bob);
        assertEq(vault.feeRecipient(), bob, "governance must be able to set the fee recipient");
    }

    // ── feeRecipient is an ordinary, non-privileged holder ──

    /// @dev RED against the stub: no fee is ever minted so feeRecipient never holds shares.
    function test_feeRecipientIsOrdinaryHolder() public {
        _deposit(alice, 10_000e6);
        _simulateYield(2_000e6);
        vault.accrueFee();

        uint256 frShares = vault.balanceOf(feeRecipient);
        assertGt(frShares, 0, "feeRecipient should hold fee shares after a gain");

        // Redeems its OWN shares via the ordinary path.
        vm.prank(feeRecipient);
        uint256 out = vault.redeem(frShares, feeRecipient, feeRecipient);
        assertGt(out, 0, "feeRecipient redeems its own shares like any holder");

        // Cannot touch another holder's shares (no approval/authority). NB: read alice's balance BEFORE
        // arming expectRevert — an inline `vault.balanceOf(alice)` arg would be the (non-reverting) call
        // expectRevert binds to, masking the redeem we actually want to assert reverts.
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(feeRecipient);
        vm.expectRevert();
        vault.redeem(aliceShares, feeRecipient, alice);
    }

    // ── Fuzz: minted fee-share claim ≈ feeBps × yield; accrual is dilution-only ──

    /// @dev RED against the stub (no fee minted; claim == 0).
    function testFuzz_feeMintMatchesYieldShare(uint256 depositAmt, uint256 yieldAmt) public {
        depositAmt = bound(depositAmt, 1_000e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 10e6, depositAmt);

        _deposit(alice, depositAmt);
        _simulateYield(yieldAmt);

        uint256 taBeforeAccrual = vault.totalAssets();
        uint256 minted = vault.accrueFee();
        assertEq(
            vault.totalAssets(),
            taBeforeAccrual,
            "accrual must be dilution-only (totalAssets fixed)"
        );
        assertGt(minted, 0, "a positive gain must mint a positive fee");

        uint256 claim = vault.convertToAssets(vault.balanceOf(feeRecipient));
        uint256 expected = (yieldAmt * DEFAULT_FEE_BPS) / 10_000;
        assertApproxEqRel(claim, expected, 0.02e18, "fee claim must be ~feeBps x yield above HWM");
    }
}
