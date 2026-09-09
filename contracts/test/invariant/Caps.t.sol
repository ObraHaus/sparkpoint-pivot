// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { VaultTestBase } from "../utils/VaultTestBase.sol";
import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { MockERC20 } from "../mocks/Mocks.sol";

/// @notice Caps fuzz driver: deposits/withdraws ONLY (no yield — caps are inflow-only and checked at
///         deposit time, so totalAssets must never be pushed above the cap by a deposit).
contract CapsHandler is Test {
    SparkPointVault internal vault;
    MockERC20 internal usdc;
    address[] internal actors;

    constructor(SparkPointVault vault_, MockERC20 usdc_, address[] memory actors_) {
        vault = vault_;
        usdc = usdc_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        amount = bound(amount, 1, 15_000e6); // can exceed the 10k per-user cap
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(vault), amount);
        try vault.deposit(amount, a) { } catch { }
        vm.stopPrank();
    }

    function withdraw(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        uint256 maxW = vault.maxWithdraw(a);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(a);
        try vault.withdraw(amount, a, a) { } catch { }
    }
}

/// @title Cap invariants — totalAssets ≤ total cap, per-user TVL ≤ per-user cap, caps never gate exits.
contract CapsInvariantTest is StdInvariant, VaultTestBase {
    CapsHandler internal handler;

    // Small caps so the fuzzer reliably reaches them.
    function capPerUser() internal view override returns (uint256) {
        return 10_000e6;
    }

    function capTotal() internal view override returns (uint256) {
        return 20_000e6;
    }

    function capVault() internal view override returns (uint256) {
        return 20_000e6;
    }

    function setUp() public {
        _deployStack();
        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        handler = new CapsHandler(vault, usdc, actors);
        targetContract(address(handler));
    }

    /// @dev RED against the stub: no cap enforcement, so deposits push totalAssets above the cap.
    function invariant_totalAssetsLeTotalCap() public view {
        assertLe(vault.totalAssets(), caps.totalCap(), "caps: totalAssets exceeded total cap");
    }

    /// @dev RED against the stub: a single actor can hold more than the per-user cap.
    function invariant_perUserSharesLeCap() public view {
        uint256 cap = caps.perUserCap();
        assertLe(
            vault.convertToAssets(vault.balanceOf(alice)), cap, "caps: alice over per-user cap"
        );
        assertLe(vault.convertToAssets(vault.balanceOf(bob)), cap, "caps: bob over per-user cap");
        assertLe(
            vault.convertToAssets(vault.balanceOf(carol)), cap, "caps: carol over per-user cap"
        );
    }

    // ── Deterministic cap enforcement (RED anchors) ──

    /// @dev Depositing above the per-user cap MUST revert. RED against the stub (maxDeposit == max).
    function test_deposit_revertsAbovePerUserCap() public {
        uint256 over = caps.perUserCap() + 1;
        usdc.mint(alice, over);
        vm.startPrank(alice);
        usdc.approve(address(vault), over);
        vm.expectRevert();
        vault.deposit(over, alice);
        vm.stopPrank();
    }

    /// @dev maxDeposit == min(perUser, totalRemaining, vaultRemaining). RED against the stub (== max).
    function test_maxDeposit_reflectsCaps() public view {
        uint256 expected = caps.perUserCap(); // smallest of the three at empty vault
        assertEq(vault.maxDeposit(alice), expected, "caps: maxDeposit must reflect the caps");
    }

    // ── Caps NEVER reduce maxWithdraw / maxRedeem (N2) ──
    function test_capsNeverReduceMaxWithdraw() public {
        _deposit(alice, 5_000e6);
        uint256 maxWBefore = vault.maxWithdraw(alice);
        uint256 maxRBefore = vault.maxRedeem(alice);

        // Governance slams the caps to zero.
        vm.startPrank(governance);
        caps.setPerUserCap(0);
        caps.setTotalCap(0);
        caps.setVaultCap(0);
        vm.stopPrank();

        assertEq(vault.maxWithdraw(alice), maxWBefore, "caps must never reduce maxWithdraw");
        assertEq(vault.maxRedeem(alice), maxRBefore, "caps must never reduce maxRedeem");
        assertEq(vault.maxDeposit(alice), 0, "maxDeposit should be 0 once caps are exhausted");
    }
}
