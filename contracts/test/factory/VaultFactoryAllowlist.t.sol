// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { SparkPointVaultFactory } from "../../src/factory/SparkPointVaultFactory.sol";
import { ISparkPointVaultFactory } from "../../src/interfaces/ISparkPointVaultFactory.sol";
import { SparkPointMorphoVault } from "../../src/vault/SparkPointMorphoVault.sol";
import { MockERC20, MockMorphoVault } from "../mocks/Mocks.sol";

/// @title VaultFactoryAllowlistTest — §2 allowlist obligations (T014).
/// @notice allowlistMorphoVault add/remove is onlyOwner + emits; de-allowlisting blocks a FUTURE
///         createVault but leaves an ALREADY-DEPLOYED wrapper fully operational (N2): deposit in,
///         de-allowlist, redeem still succeeds and morphoVault() is unchanged (immutable).
contract VaultFactoryAllowlistTest is Test {
    uint256 internal constant ONE_USDC = 1e6;

    MockERC20 internal usdc;
    MockMorphoVault internal morpho;
    SparkPointVaultFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");

    uint16 internal constant FEE_BPS = 1000;
    string internal constant LABEL = "SparkPoint Morpho USDC";

    event MorphoVaultAllowlisted(address indexed morphoVault, bool allowed);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        morpho = new MockMorphoVault(usdc);
        factory = new SparkPointVaultFactory(owner, IERC20(address(usdc)), guardian, feeRecipient);
    }

    function _caps() internal pure returns (ISparkPointVaultFactory.Caps memory) {
        return ISparkPointVaultFactory.Caps({ perAddressCap: 5_000 * ONE_USDC, totalCap: 1_000_000 * ONE_USDC });
    }

    // ── onlyOwner + events ──

    function test_allowlist_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.allowlistMorphoVault(address(morpho), true);
    }

    function test_allowlist_addEmitsAndSets() public {
        vm.expectEmit(true, false, false, true, address(factory));
        emit MorphoVaultAllowlisted(address(morpho), true);
        vm.prank(owner);
        factory.allowlistMorphoVault(address(morpho), true);
        assertTrue(factory.isAllowlisted(address(morpho)), "allowlisted after add");
    }

    function test_allowlist_removeEmitsAndClears() public {
        vm.startPrank(owner);
        factory.allowlistMorphoVault(address(morpho), true);
        vm.expectEmit(true, false, false, true, address(factory));
        emit MorphoVaultAllowlisted(address(morpho), false);
        factory.allowlistMorphoVault(address(morpho), false);
        vm.stopPrank();
        assertFalse(factory.isAllowlisted(address(morpho)), "de-allowlisted after remove");
    }

    // ── De-allowlisting blocks FUTURE deploys only ──

    function test_deallowlist_blocksFutureCreateVault() public {
        vm.startPrank(owner);
        factory.allowlistMorphoVault(address(morpho), true);
        factory.allowlistMorphoVault(address(morpho), false);
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactory.NotAllowlisted.selector, address(morpho))
        );
        factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);
        vm.stopPrank();
    }

    // ── N2: an already-deployed wrapper survives de-allowlisting, fully withdrawable ──

    function test_deallowlist_leavesDeployedWrapperFullyWithdrawable() public {
        vm.startPrank(owner);
        factory.allowlistMorphoVault(address(morpho), true);
        address vaultAddr = factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);
        vm.stopPrank();

        SparkPointMorphoVault vault = SparkPointMorphoVault(vaultAddr);
        address morphoBefore = vault.morphoVault();

        // Alice deposits BEFORE the de-allowlist.
        uint256 amount = 1_000 * ONE_USDC;
        usdc.mint(alice, amount);
        vm.startPrank(alice);
        usdc.approve(vaultAddr, amount);
        uint256 shares = vault.deposit(amount, alice);
        vm.stopPrank();
        assertGt(shares, 0, "deposit minted shares");

        // Now DE-ALLOWLIST the morpho vault.
        vm.prank(owner);
        factory.allowlistMorphoVault(address(morpho), false);
        assertFalse(factory.isAllowlisted(address(morpho)), "de-allowlisted");

        // The already-deployed wrapper is UNTOUCHED: morphoVault() immutable, still withdrawable.
        assertEq(vault.morphoVault(), morphoBefore, "N2: wrapper morphoVault() must be unchanged");

        vm.startPrank(alice);
        uint256 got = vault.redeem(shares, alice, alice);
        vm.stopPrank();

        assertApproxEqAbs(got, amount, 1, "N2: redeem after de-allowlist returns principal");
        assertEq(usdc.balanceOf(alice), got, "alice received her USDC back");
        assertEq(vault.balanceOf(alice), 0, "all shares redeemed");
    }
}
