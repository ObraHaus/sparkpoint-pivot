// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import { SparkPointVaultFactoryV3 } from "../../src/factory/SparkPointVaultFactoryV3.sol";
import { MockERC4626 } from "../mocks/MockERC4626.sol";
import { VaultFactoryV3TestBase } from "../utils/VaultFactoryV3TestBase.sol";

/// @title VaultFactoryV3AdmissionTest — the v4.1.0 admission lifecycle for the V3 factory.
/// @notice Admin lane: instant (`readyAt = 0`). AI lane: `readyAt = now + cooldown`, inline
///         `block.timestamp` check — no timelock in admission. `releaseNow` overrides an AI entry,
///         `unwhitelist` cancels one, the cooldown is admin-bounded `[1h, 7d]`, provenance (`by`) is
///         recorded, and exactly one wrapper per child can ever exist. The runner's "AI skips
///         admin-added entries" rule is OFF-CHAIN; the chain itself permits either admission role
///         to deploy a ready entry (asserted deliberately in
///         `test_deployer_mayDeployAnAdminEntry_offchainRuleIsProvenanceBased`).
contract VaultFactoryV3AdmissionTest is VaultFactoryV3TestBase {
    event VaultWhitelisted(address indexed child, address indexed by, uint64 readyAt);
    event VaultReleased(address indexed child, address indexed by);
    event VaultUnwhitelisted(address indexed child, address indexed by);
    event CooldownUpdated(uint64 oldCooldown, uint64 newCooldown, address indexed by);

    // ── admin lane: instant admission ──────────────────────────────────────────

    function test_adminWhitelist_isInstant() public {
        vm.expectEmit(true, true, false, true, address(factory));
        emit VaultWhitelisted(address(child), admin, 0);
        vm.prank(admin);
        factory.whitelistVault(address(child));

        assertTrue(factory.isWhitelisted(address(child)), "whitelisted");
        assertTrue(factory.isReady(address(child)), "admin entries are ready immediately");
        (address by, uint64 readyAt) = factory.whitelistOf(address(child));
        assertEq(by, admin, "provenance");
        assertEq(readyAt, 0, "readyAt == 0 = no cooldown");

        // Deploys in the very next transaction, no warp.
        vm.prank(admin);
        address proxy = factory.createVault(_params(address(child), keccak256("instant")));
        assertEq(factory.wrapperOf(address(child)), proxy);
    }

    function test_admin_canUnwhitelistAnAdminEntry() public {
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        factory.unwhitelist(address(child));
        vm.stopPrank();
        assertFalse(factory.isWhitelisted(address(child)));
        assertEq(factory.wrapperOf(address(child)), address(0), "nothing was deployed");
    }

    // ── AI lane: cooldown ──────────────────────────────────────────────────────

    function test_aiWhitelist_setsReadyAtAfterDefaultCooldown() public {
        uint64 expectedReadyAt = uint64(block.timestamp) + factory.DEFAULT_COOLDOWN();

        vm.expectEmit(true, true, false, true, address(factory));
        emit VaultWhitelisted(address(child), ai, expectedReadyAt);
        vm.prank(ai);
        factory.whitelistVault(address(child));

        (address by, uint64 readyAt) = factory.whitelistOf(address(child));
        assertEq(by, ai, "provenance is the AI deployer key");
        assertEq(readyAt, expectedReadyAt, "readyAt = now + default 24h");
        assertTrue(factory.isWhitelisted(address(child)));
        assertFalse(factory.isReady(address(child)), "not ready during the cooldown");
    }

    function test_ai_cannotDeployBeforeCooldown_thenDeploysAtReadyAt() public {
        vm.prank(ai);
        factory.whitelistVault(address(child));
        (, uint64 readyAt) = factory.whitelistOf(address(child));

        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.CooldownNotElapsed.selector, address(child), readyAt
            )
        );
        factory.createVault(_params(address(child), keccak256("early")));

        vm.warp(readyAt - 1);
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.CooldownNotElapsed.selector, address(child), readyAt
            )
        );
        factory.createVault(_params(address(child), keccak256("almost")));

        // At readyAt exactly (>=) the entry unlocks.
        vm.warp(readyAt);
        assertTrue(factory.isReady(address(child)));
        vm.prank(ai);
        address proxy = factory.createVault(_params(address(child), keccak256("ready")));
        assertEq(factory.wrapperOf(address(child)), proxy);
        assertFalse(factory.isWhitelisted(address(child)), "admission consumed");
    }

    function test_adminReleaseNow_overridesAnAiCooldown() public {
        vm.prank(ai);
        factory.whitelistVault(address(child));
        assertFalse(factory.isReady(address(child)));

        vm.expectEmit(true, true, false, false, address(factory));
        emit VaultReleased(address(child), admin);
        vm.prank(admin);
        factory.releaseNow(address(child));

        (, uint64 readyAt) = factory.whitelistOf(address(child));
        assertEq(readyAt, 0, "releaseNow zeroes the cooldown");
        assertTrue(factory.isReady(address(child)));
        (address byAfter,) = factory.whitelistOf(address(child));
        assertEq(byAfter, ai, "provenance unchanged by release");

        vm.prank(ai);
        address proxy = factory.createVault(_params(address(child), keccak256("released")));
        assertEq(factory.wrapperOf(address(child)), proxy);
    }

    function test_releaseNow_requiresAnEntry_andTheAdminRole() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactoryV3.NotWhitelisted.selector, address(child))
        );
        factory.releaseNow(address(child));

        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.releaseNow(address(child));
    }

    // ── unwhitelist: cancel a pending admission ────────────────────────────────

    function test_unwhitelist_cancelsPendingAiEntryAndBlocksDeploy() public {
        vm.prank(ai);
        factory.whitelistVault(address(child));

        vm.expectEmit(true, true, false, false, address(factory));
        emit VaultUnwhitelisted(address(child), admin);
        vm.prank(admin);
        factory.unwhitelist(address(child));

        assertFalse(factory.isWhitelisted(address(child)), "entry removed");
        (address by, uint64 readyAt) = factory.whitelistOf(address(child));
        assertEq(by, address(0));
        assertEq(readyAt, 0);

        // Even long after the would-be cooldown, the deploy stays blocked.
        vm.warp(block.timestamp + factory.DEFAULT_COOLDOWN());
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactoryV3.NotWhitelisted.selector, address(child))
        );
        factory.createVault(_params(address(child), keccak256("cancelled")));
    }

    function test_unwhitelist_requiresTheAdminRole() public {
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.unwhitelist(address(child));

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                admissionAdminRole
            )
        );
        factory.unwhitelist(address(child));
    }
    // ── cooldown config ────────────────────────────────────────────────────────

    function test_setCooldown_isBounded1hTo7d() public {
        vm.startPrank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.CooldownOutOfBounds.selector, uint64(1 hours - 1)
            )
        );
        factory.setCooldown(1 hours - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.CooldownOutOfBounds.selector, uint64(7 days + 1)
            )
        );
        factory.setCooldown(7 days + 1);

        // Inclusive bounds are accepted, and the change is evented.
        vm.expectEmit(true, false, false, true, address(factory));
        emit CooldownUpdated(24 hours, 1 hours, admin);
        factory.setCooldown(1 hours);
        factory.setCooldown(7 days);
        vm.stopPrank();
        assertEq(factory.cooldown(), 7 days);
    }

    function test_setCooldown_requiresTheAdminRole() public {
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.setCooldown(1 hours);
    }

    function test_setCooldown_appliesToFutureAdmissionsOnly() public {
        vm.prank(ai);
        factory.whitelistVault(address(child));
        (, uint64 readyAtBefore) = factory.whitelistOf(address(child));
        assertEq(readyAtBefore, uint64(block.timestamp) + 24 hours, "default applies at admission");

        MockERC4626 second = _newChild();
        vm.startPrank(admin);
        factory.setCooldown(1 hours);
        vm.stopPrank();

        // The pending entry keeps the readyAt it was admitted with...
        (, uint64 readyAtAfter) = factory.whitelistOf(address(child));
        assertEq(readyAtAfter, readyAtBefore, "cooldown changes do not rewrite a pending readyAt");

        // ...the next admission uses the new cooldown.
        vm.prank(ai);
        factory.whitelistVault(address(second));
        (, uint64 newReadyAt) = factory.whitelistOf(address(second));
        assertEq(
            newReadyAt, uint64(block.timestamp) + 1 hours, "new cooldown applies to new entries"
        );
    }

    // ── provenance + one wrapper per child ─────────────────────────────────────

    function test_whitelistedBy_isRecordedForBothLanes() public {
        MockERC4626 second = _newChild();
        vm.prank(admin);
        factory.whitelistVault(address(child));
        vm.prank(ai);
        factory.whitelistVault(address(second));

        (address childBy,) = factory.whitelistOf(address(child));
        (address secondBy,) = factory.whitelistOf(address(second));
        assertEq(childBy, admin, "admin entry provenance");
        assertEq(secondBy, ai, "AI entry provenance");
    }

    function test_oneWrapperPerChild_secondAttemptAndReWhitelistRevert() public {
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        address proxy = factory.createVault(_params(address(child), keccak256("one")));
        vm.stopPrank();
        assertEq(factory.wrapperOf(address(child)), proxy);

        // Re-whitelisting a wrapped child is refused (one per child, on-chain).
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.WrapperAlreadyDeployed.selector, address(child)
            )
        );
        factory.whitelistVault(address(child));
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.WrapperAlreadyDeployed.selector, address(child)
            )
        );
        factory.whitelistVault(address(child));

        // A second wrapper attempt reverts loudly, whatever the salt and whoever calls.
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.WrapperAlreadyDeployed.selector, address(child)
            )
        );
        factory.createVault(_params(address(child), keccak256("two")));
        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.WrapperAlreadyDeployed.selector, address(child)
            )
        );
        factory.createVault(_params(address(child), keccak256("three")));
    }

    function test_deployer_mayDeployAnAdminEntry_offchainRuleIsProvenanceBased() public {
        // Amendment v4.1.0 §6: the chain does NOT restrict who deploys a ready entry. The runner's
        // "AI never deploys admin-added entries" rule lives off-chain and is checked by `by`.
        vm.prank(admin);
        factory.whitelistVault(address(child));
        vm.prank(ai);
        address proxy = factory.createVault(_params(address(child), keccak256("admin-entry")));
        assertEq(factory.wrapperOf(address(child)), proxy);
    }

    function test_whitelistVault_rejectsDuplicatePendingEntry() public {
        vm.prank(admin);
        factory.whitelistVault(address(child));

        vm.prank(ai);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.AlreadyWhitelisted.selector, address(child)
            )
        );
        factory.whitelistVault(address(child));

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactoryV3.AlreadyWhitelisted.selector, address(child)
            )
        );
        factory.whitelistVault(address(child));
    }

    function test_whitelistVault_rejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(SparkPointVaultFactoryV3.ZeroAddress.selector);
        factory.whitelistVault(address(0));
    }

    function test_whitelistVault_requiresAnAdmissionRole() public {
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                admissionAdminRole
            )
        );
        factory.whitelistVault(address(child));
    }
}
