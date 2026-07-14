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

    /// @dev The vault's asset accounting MUST equal the aUSDC-backed claim (+ idle USDC), so Aave
    ///      yield is reflected automatically. RED against the stub (totalAssets omits the aUSDC leg).
    function testFuzz_yieldAccrues_totalAssetsTracksAave(uint256 amount, uint256 yieldAmt) public {
        amount = bound(amount, 1e6, 500_000e6);
        yieldAmt = bound(yieldAmt, 1e6, 500_000e6);

        _deposit(alice, amount);
        _simulateYield(yieldAmt);

        uint256 backed = aUSDC.balanceOf(address(vault)) + usdc.balanceOf(address(vault));
        assertEq(
            vault.totalAssets(), backed, "totalAssets must equal aUSDC claim + idle USDC (sec 6)"
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
