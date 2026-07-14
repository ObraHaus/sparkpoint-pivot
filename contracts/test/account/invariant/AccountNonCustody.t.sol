// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { SparkPointAccount } from "../../../src/account/SparkPointAccount.sol";
import { MockERC20 } from "../../mocks/Mocks.sol";

/// @notice N1/N3 fuzz driver: a compromised AGENT/attacker (never the owner, never the EntryPoint)
///         hammers every outbound + upgrade path trying to (a) drain the account's USDC to itself,
///         (b) route it to a SparkPoint address, (c) upgrade the account out from under the owner.
///         A correct account gates execute to EntryPoint-or-owner and _authorizeUpgrade to owner, so
///         NONE of these succeed. The stub gates nothing ⇒ all succeed ⇒ RED.
contract NonCustodyHandler is Test {
    SparkPointAccount internal account;
    MockERC20 internal usdc;
    address internal attacker;
    address internal sparkpoint;
    address internal upgradeTarget;

    bool public attackerUpgraded;

    bytes4 internal constant SEL_TRANSFER = 0xa9059cbb;

    constructor(
        SparkPointAccount account_,
        MockERC20 usdc_,
        address attacker_,
        address sparkpoint_,
        address upgradeTarget_
    ) {
        account = account_;
        usdc = usdc_;
        attacker = attacker_;
        sparkpoint = sparkpoint_;
        upgradeTarget = upgradeTarget_;
    }

    function drainToAttacker(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(address(account)));
        vm.prank(attacker);
        try account.execute(
            address(usdc), 0, abi.encodeWithSelector(SEL_TRANSFER, attacker, amount)
        ) { }
            catch { }
    }

    function drainToSparkPoint(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(address(account)));
        vm.prank(attacker);
        try account.execute(
            address(usdc), 0, abi.encodeWithSelector(SEL_TRANSFER, sparkpoint, amount)
        ) { }
            catch { }
    }

    function upgradeAsAttacker() public {
        vm.prank(attacker);
        try account.upgradeToAndCall(upgradeTarget, "") {
            attackerUpgraded = true;
        } catch { }
    }
}

/// @title AccountNonCustody — N1 (no fund exfiltration) + N3 (owner-only authority/upgrade).
/// @dev smart-contracts.md §2: invariant_onlyEntryPointOrOwnerMovesFunds, invariant_noSparkPointRecipient,
///      invariant_onlyOwnerUpgrades.
contract AccountNonCustodyTest is StdInvariant, AccountTestBase {
    NonCustodyHandler internal handler;
    SparkPointAccount internal accountImpl2; // a same-code upgrade destination (keeps the proxy usable)

    function setUp() public {
        _deployAccountStack();
        // A second, same-code implementation so an (attempted) unauthorized upgrade does not brick the
        // proxy mid-run — the ghost still records that the upgrade was (wrongly) permitted.
        accountImpl2 = new SparkPointAccount(
            IEntryPoint(address(entryPoint)), address(validator), address(policy)
        );

        handler = new NonCustodyHandler(account, usdc, attacker, sparkpoint, address(accountImpl2));
        targetContract(address(handler));
    }

    // ── N1 ──

    /// @dev Only EntryPoint (post-validation) or owner may move the account's funds. A non-owner,
    ///      non-EntryPoint attacker must NEVER end up holding the account's USDC.
    function invariant_onlyEntryPointOrOwnerMovesFunds() public view {
        assertEq(usdc.balanceOf(attacker), 0, "N1: attacker moved funds via an ungated execute");
    }

    /// @dev No reachable execute may route funds to a SparkPoint address (recipient pinning + gate).
    function invariant_noSparkPointRecipient() public view {
        assertEq(usdc.balanceOf(sparkpoint), 0, "N1: funds reached a SparkPoint recipient");
    }

    // ── N3 ──

    /// @dev _authorizeUpgrade is owner-only; a non-owner upgrade must never take effect.
    function invariant_onlyOwnerUpgrades() public view {
        assertFalse(handler.attackerUpgraded(), "N3: a non-owner upgraded the account");
    }

    // ── Deterministic unit gates (proof of RED) ──

    /// @dev N3: the sole owner is the user EOA bound at init — never a SparkPoint/backend address.
    function test_ownerSetAtInit_isUserEOA_notSparkPoint() public view {
        assertEq(account.owner(), owner, "owner must be the user EOA bound at init");
        assertTrue(account.owner() != sparkpoint, "owner must not be a SparkPoint address");
        assertTrue(account.owner() != address(this), "owner must not be the deployer/backend");
    }

    function test_entryPointPinned() public view {
        assertEq(
            account.entryPoint(),
            address(entryPoint),
            "EntryPoint must be pinned to the v0.7 singleton"
        );
    }

    /// @dev N1: a direct execute from a non-owner/non-EntryPoint caller MUST revert (RED: stub has no gate).
    function test_execute_revertsForNonOwnerNonEntryPoint() public {
        vm.prank(attacker);
        vm.expectRevert();
        account.execute(address(usdc), 0, abi.encodeWithSelector(SEL_TRANSFER, attacker, 1e6));
    }

    /// @dev N1: an EntryPoint-originated execute IS allowed (positive path stays intact).
    function test_execute_allowedFromEntryPoint() public {
        uint256 before = usdc.balanceOf(owner);
        vm.prank(address(entryPoint));
        account.execute(address(usdc), 0, abi.encodeWithSelector(SEL_TRANSFER, owner, 10e6));
        assertEq(usdc.balanceOf(owner), before + 10e6, "EntryPoint-gated execute must succeed");
    }

    /// @dev N3: only the owner may UUPS-upgrade; a non-owner call MUST revert (RED: stub gate is empty).
    function test_onlyOwnerUpgrades_attackerReverts() public {
        vm.prank(attacker);
        vm.expectRevert();
        account.upgradeToAndCall(address(accountImpl2), "");
    }
}
