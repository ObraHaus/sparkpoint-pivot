// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { MorphoVaultTestBase } from "../utils/MorphoVaultTestBase.sol";

/// @title MorphoVault4626 — non-rebasing ERC-4626 correctness + partial-liquidity fuzz suite (011 §1).
/// @notice Re-proves the §7 ERC-4626 correctness notes for the Morpho WRAPPER: totalAssets is the
///         non-rebasing Morpho claim (tracks pps UP and DOWN), round-trips never mint value from
///         nothing, rounding is in the vault's favor, and withdrawals honor the live Morpho liquidity
///         clamp (including the Vaults-V2 max*==0 fallback so N2 is never spuriously blocked).
contract MorphoVault4626FuzzTest is MorphoVaultTestBase {
    function setUp() public {
        _deployStack();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Non-rebasing totalAssets tracks the Morpho pps UP and DOWN
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev totalAssets() == morpho.convertToAssets(morpho.balanceOf(this)) — non-rebasing. A Morpho
    ///      yield raises it; the holder's redeemable assets rise. RED against a rebasing/idle copy.
    function testFuzz_totalAssetsTracksMorphoPps_up(uint256 amount, uint256 yieldAmt) public {
        amount = bound(amount, 1e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 1e6, 500_000e6);

        _deposit(alice, amount);
        uint256 taBefore = vault.totalAssets();
        uint256 aliceBefore = vault.convertToAssets(vault.balanceOf(alice));

        _simulateYield(yieldAmt);

        assertGt(vault.totalAssets(), taBefore, "totalAssets must rise with Morpho yield");
        assertEq(
            vault.totalAssets(),
            morpho.convertToAssets(morpho.balanceOf(address(vault))),
            "totalAssets must equal the non-rebasing Morpho claim"
        );
        assertGt(
            vault.convertToAssets(vault.balanceOf(alice)),
            aliceBefore,
            "Morpho yield must flow to the holder's redeemable assets"
        );
    }

    /// @dev A Morpho-side LOSS is reflected (never fabricated): pps DOWN, totalAssets DOWN, holder's
    ///      redeemable assets DOWN. The wrapper must not hide or absorb the loss.
    function testFuzz_totalAssetsTracksMorphoPps_down(uint256 amount, uint256 lossPct) public {
        amount = bound(amount, 100e6, 500_000e6);
        lossPct = bound(lossPct, 1, 90); // lose 1%..90% of the claim

        _deposit(alice, amount);
        uint256 taBefore = vault.totalAssets();
        uint256 ppsBefore = _pps();
        uint256 aliceBefore = vault.convertToAssets(vault.balanceOf(alice));

        uint256 loss = (taBefore * lossPct) / 100;
        _simulateLoss(loss);

        assertLt(vault.totalAssets(), taBefore, "totalAssets must fall on a Morpho-side loss");
        assertLt(_pps(), ppsBefore, "pps must fall on a Morpho-side loss (reflected, not fabricated)");
        assertEq(
            vault.totalAssets(),
            morpho.convertToAssets(morpho.balanceOf(address(vault))),
            "totalAssets must remain the non-rebasing Morpho claim after a loss"
        );
        assertLt(
            vault.convertToAssets(vault.balanceOf(alice)),
            aliceBefore,
            "a loss must reduce the holder's redeemable assets"
        );
    }

    /// @dev totalAssets excludes idle USDC: a raw-USDC donation to the wrapper moves NEITHER totalAssets
    ///      NOR the share price (donation/inflation hardening on top of the OZ virtual-offset).
    function testFuzz_totalAssets_excludesRawUsdcDonation(uint256 amount, uint256 donation) public {
        amount = bound(amount, 1e6, 500_000e6);
        donation = bound(donation, 1, 500_000e6);

        _deposit(alice, amount);
        uint256 taBefore = vault.totalAssets();
        uint256 ppsBefore = _pps();

        usdc.mint(address(vault), donation); // raw donation — never routed through deposit()/Morpho

        assertEq(vault.totalAssets(), taBefore, "raw-USDC donation must NOT change totalAssets");
        assertEq(_pps(), ppsBefore, "raw-USDC donation must NOT move the share price");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Round-trips never mint value from nothing; rounding favors the vault
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev deposit→redeem with no yield never extracts more than deposited (rounding in vault's favor).
    function testFuzz_depositRedeemRoundTrip_noExtract(uint256 amount) public {
        amount = bound(amount, 1e6, 500_000e6);
        _deposit(alice, amount);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertLe(out, amount, "no-yield round-trip must never extract more than deposited");
        assertGe(out + 3, amount, "round-trip must return principal minus at most rounding dust");
    }

    /// @dev Virtual-offset defeats the first-depositor / donation inflation attack on the wrapper.
    function test_virtualOffset_defeatsInflation() public {
        _deposit(alice, 1);
        usdc.mint(address(vault), 10_000e6); // raw donation to inflate — ignored by totalAssets

        uint256 victimShares = _deposit(bob, 10_000e6);
        assertGt(victimShares, 0, "victim must receive shares despite the inflation attempt");

        uint256 redeemable = vault.convertToAssets(victimShares);
        assertGt(redeemable, 5_000e6, "victim must not lose the bulk of its deposit to inflation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Partial Morpho liquidity: withdraw succeeds up to the clamp, reverts cleanly above it
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Under reduced Morpho liquidity (setAvailableLiquidity), maxWithdraw clamps to the live
    ///      liquidity and a withdraw AT the clamp succeeds; ABOVE it the exit reverts CLEANLY (no silent
    ///      short-fill) — SparkPoint is never the exit-blocker, only Morpho liquidity is.
    function testFuzz_withdraw_clampedToMorphoLiquidity(uint256 amount, uint256 liq) public {
        amount = bound(amount, 100e6, 500_000e6);
        _deposit(alice, amount);

        liq = bound(liq, 1e6, amount - 1); // strictly less than the full claim
        morpho.setAvailableLiquidity(liq);

        uint256 maxW = vault.maxWithdraw(alice);
        assertLe(maxW, liq, "maxWithdraw must be clamped to live Morpho liquidity");
        assertGt(maxW, 0, "some liquidity must remain withdrawable");

        // A withdraw AT the clamp succeeds and delivers exactly the requested USDC.
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(maxW, alice, alice);
        assertEq(usdc.balanceOf(alice) - balBefore, maxW, "withdraw at the clamp must deliver exactly");

        // A request ABOVE the current clamp reverts cleanly (never a silent short-fill).
        uint256 stillMax = vault.maxWithdraw(alice);
        if (stillMax + 1 <= vault.convertToAssets(vault.balanceOf(alice))) {
            vm.prank(alice);
            vm.expectRevert();
            vault.withdraw(stillMax + 1, alice, alice);
        }
    }

    /// @dev lendOut models utilization the same way; a withdraw above what remains reverts cleanly.
    function testFuzz_withdraw_revertsAboveLiquidity_afterLendOut(uint256 amount, uint256 lent)
        public
    {
        amount = bound(amount, 100e6, 500_000e6);
        _deposit(alice, amount);

        lent = bound(lent, 1e6, amount - 1e6);
        morpho.lendOut(lent);

        uint256 avail = vault.availableLiquidity();
        assertApproxEqAbs(avail, amount - lent, 1, "availableLiquidity must reflect the lent-out amount");

        // Above the available liquidity reverts cleanly; at/under it succeeds.
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(avail + 1, alice, alice);

        vm.prank(alice);
        vault.withdraw(avail, alice, alice);
        assertEq(usdc.balanceOf(alice), avail, "withdraw up to the clamp must succeed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vaults-V2 (max*==0) fallback — N2 must NOT be spuriously blocked
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev When the wrapped Morpho vault is Vaults-V2 (maxWithdraw/maxRedeem return 0 while it holds
    ///      value), the wrapper's availableLiquidity falls back to the FULL claim, so a legitimate
    ///      withdraw still SUCCEEDS — the N2 escape hatch is never blocked by a spuriously-zero clamp.
    function testFuzz_vaultsV2_maxZero_doesNotBlockWithdraw(uint256 amount) public {
        amount = bound(amount, 100e6, 500_000e6);
        _deposit(alice, amount);

        morpho.setMaxReturnsZero(true);
        assertEq(morpho.maxWithdraw(address(vault)), 0, "precondition: Morpho V2 reports max==0");
        assertGt(vault.totalAssets(), 0, "precondition: the wrapper still holds value");

        // The wrapper must fall back to the full claim, NOT the spurious zero.
        assertGt(vault.availableLiquidity(), 0, "V2 fallback: availableLiquidity must be > 0");
        assertGt(vault.maxWithdraw(alice), 0, "V2 fallback: maxWithdraw must be > 0");

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertGt(out, 0, "N2: a legitimate redeem must succeed even when Morpho V2 max*==0");
        assertEq(usdc.balanceOf(alice), out, "N2: user received the underlying under V2 max*==0");
    }

    /// @dev Even in V2 mode, if the underlying liquidity is genuinely short the exit reverts CLEANLY
    ///      (the optimistic fallback attempts the real withdraw and honors Morpho's revert) — never a
    ///      silent short-fill, never a fabricated payout.
    function testFuzz_vaultsV2_shortLiquidity_revertsCleanly(uint256 amount, uint256 liq) public {
        amount = bound(amount, 100e6, 500_000e6);
        _deposit(alice, amount);

        liq = bound(liq, 1e6, amount - 1e6);
        morpho.setAvailableLiquidity(liq);
        morpho.setMaxReturnsZero(true); // V2: max*==0 but real liquidity == liq

        // Optimistic fallback reports the full claim, but a withdraw above the REAL liquidity reverts.
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(liq + 1e6, alice, alice);

        // A withdraw within the real liquidity still succeeds.
        vm.prank(alice);
        vault.withdraw(liq, alice, alice);
        assertEq(usdc.balanceOf(alice), liq, "withdraw within real V2 liquidity must succeed");
    }
}
