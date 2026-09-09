// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { VaultTestBase } from "../utils/VaultTestBase.sol";

/// @title ERC-4626 correctness fuzz suite (§7 normative notes).
contract Vault4626FuzzTest is VaultTestBase {
    function setUp() public {
        _deployStack();
    }

    /// @dev A depositor can never extract more than deposited when there is no yield (rounding is
    ///      always in the vault's favor). Guard — holds by construction.
    function testFuzz_depositRedeemRoundTrip_noExtract(uint256 amount) public {
        amount = bound(amount, 1e6, 500_000e6);
        _deposit(alice, amount);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertLe(out, amount, "no-yield round-trip must never extract more than deposited");
        assertGe(out + 2, amount, "round-trip must return principal minus at most rounding dust");
    }

    /// @dev The vault's asset accounting MUST equal the aUSDC-backed claim ONLY — it EXCLUDES idle USDC
    ///      (§6 anti-donation hardening; SparkPointVault.totalAssets == _aUSDC.balanceOf(this)). Aave
    ///      yield is still reflected automatically because interest rebases the aUSDC balance. RED
    ///      against a stub that omits the aUSDC leg (pps never moves). The excludes-idle behaviour is
    ///      itself pinned by testFuzz_totalAssets_excludesRawUsdcDonation below.
    function testFuzz_yieldAccrues_totalAssetsTracksAave(uint256 amount, uint256 yieldAmt) public {
        amount = bound(amount, 1e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 1e6, 500_000e6);

        _deposit(alice, amount);
        _simulateYield(yieldAmt);

        // Every deposited USDC is supplied to Aave immediately, so idle USDC is 0 in normal operation.
        assertEq(usdc.balanceOf(address(vault)), 0, "no idle USDC (deposits swept to Aave)");
        assertEq(
            vault.totalAssets(),
            aUSDC.balanceOf(address(vault)),
            "totalAssets must equal the aUSDC claim ONLY (excludes idle USDC, sec 6)"
        );
    }

    /// @dev §6/§7 hardening PIN: totalAssets() is the aUSDC claim ONLY and EXCLUDES idle USDC, so a
    ///      raw-USDC DONATION (usdc.transfer straight to the vault, never routed through deposit()/
    ///      Aave) moves NEITHER totalAssets() NOR the share price. This is an intentional custody
    ///      hardening — it neutralises donation/inflation attacks on top of the OZ virtual-offset. RED
    ///      the instant totalAssets ever re-includes idle USDC (a donation would then inflate the pps
    ///      and let a griefer tax a subsequent depositor via rounding).
    function testFuzz_totalAssets_excludesRawUsdcDonation(uint256 amount, uint256 donation) public {
        amount = bound(amount, 1e6, 500_000e6);
        donation = bound(donation, 1, 500_000e6);

        _deposit(alice, amount);

        uint256 taBefore = vault.totalAssets();
        uint256 ppsBefore = vault.convertToAssets(WAD);
        uint256 aliceBefore = vault.convertToAssets(vault.balanceOf(alice));

        // Raw-USDC donation straight to the vault — NOT a deposit(), so it is never supplied to Aave
        // and never mints shares; it lands as idle USDC that totalAssets() must ignore.
        usdc.mint(address(vault), donation);

        assertEq(
            vault.totalAssets(),
            taBefore,
            "raw-USDC donation must NOT change totalAssets (excludes idle)"
        );
        assertEq(
            vault.totalAssets(),
            aUSDC.balanceOf(address(vault)),
            "totalAssets must remain the aUSDC claim ONLY after a donation"
        );
        assertEq(
            vault.convertToAssets(WAD), ppsBefore, "raw-USDC donation must NOT move the share price"
        );
        assertEq(
            vault.convertToAssets(vault.balanceOf(alice)),
            aliceBefore,
            "a holder's redeemable assets must be unchanged by a raw-USDC donation"
        );
    }

    /// @dev Aave yield flows to shareholders: a holder's redeemable assets rise after interest.
    ///      RED against the stub (totalAssets ignores the aUSDC leg, so pps never moves).
    function testFuzz_yieldFlowsToShareholders(uint256 amount, uint256 yieldAmt) public {
        amount = bound(amount, 100e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 1e6, 500_000e6);

        _deposit(alice, amount);
        uint256 before = vault.convertToAssets(vault.balanceOf(alice));
        _simulateYield(yieldAmt);
        uint256 afterYield = vault.convertToAssets(vault.balanceOf(alice));

        assertGt(afterYield, before, "yield must increase the holder's redeemable assets");
    }

    /// @dev Virtual-offset (OZ v5) defeats the first-depositor / donation inflation attack: a victim
    ///      depositing after a 1-wei seed + a large donation still receives shares and is not wiped.
    ///      Guard — the OZ virtual-offset holds by construction.
    function test_virtualOffset_defeatsInflation() public {
        // Attacker seeds 1 wei.
        _deposit(alice, 1);
        // Attacker donates a large amount directly to inflate the share price.
        usdc.mint(address(vault), 10_000e6);

        // Victim deposits.
        uint256 victimShares = _deposit(bob, 10_000e6);
        assertGt(victimShares, 0, "victim must receive shares despite the inflation attack");

        // Victim can redeem a meaningful fraction — not wiped out by the attacker.
        uint256 redeemable = vault.convertToAssets(victimShares);
        assertGt(redeemable, 5_000e6, "victim must not lose the bulk of its deposit to inflation");
    }
}
