// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";

/// @title PolicyModule — G5 allowlist exactness + G2 spend accounting (smart-contracts.md §5).
/// @notice invariant_allowlistAddressAndSelectorOnly, invariant_noApproveOrArbitraryCallEverAllowed,
///         invariant_spentMonotonicAndBounded.
contract PolicyModuleTest is StdInvariant, AccountTestBase {
    uint256 public ghostAcceptedCumulative;

    function setUp() public {
        _deployAccountStack();
        bytes4[] memory sel = new bytes4[](1);
        sel[0] = this.h_sessionDeposit.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: sel }));
        targetContract(address(this));
    }

    function h_sessionDeposit(uint256 amount) public {
        amount = bound(amount, 1, SESSION_PER_TX);
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(amount, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        if (_accountAccepts(op)) {
            ghostAcceptedCumulative += amount;
        }
    }

    // ── G5: address+selector-level allowlist, never name-level ──

    /// @dev Exactly the six seeded (target,selector) pairs pass; the same selector at a DIFFERENT
    ///      address, or a different selector at an allowed address, must NOT.
    function invariant_allowlistAddressAndSelectorOnly() public view {
        // The seeded pairs pass.
        assertTrue(
            policy.isAllowedTarget(address(vault), SEL_VAULT_DEPOSIT), "vault deposit allowed"
        );
        assertTrue(policy.isAllowedTarget(address(vault), SEL_VAULT_REDEEM), "vault redeem allowed");
        assertTrue(
            policy.isAllowedTarget(address(vault), SEL_VAULT_WITHDRAW), "vault withdraw allowed"
        );
        assertTrue(
            policy.isAllowedTarget(address(aavePool), SEL_AAVE_SUPPLY), "aave supply allowed"
        );
        assertTrue(
            policy.isAllowedTarget(address(aavePool), SEL_AAVE_WITHDRAW), "aave withdraw allowed"
        );
        assertTrue(policy.isAllowedTarget(address(router), SEL_AERO_SWAP), "aero swap allowed");

        // Right selector, WRONG address → not allowed.
        assertFalse(
            policy.isAllowedTarget(address(0xBEEF), SEL_VAULT_DEPOSIT),
            "G5: selector at rogue address"
        );
        assertFalse(
            policy.isAllowedTarget(address(aavePool), SEL_VAULT_DEPOSIT),
            "G5: vault selector at aave"
        );
        // Right address, WRONG selector → not allowed.
        assertFalse(
            policy.isAllowedTarget(address(vault), SEL_AAVE_SUPPLY), "G5: aave selector at vault"
        );
    }

    /// @dev approve / transfer / transferFrom / empty-selector are NEVER allowlisted at ANY target.
    function invariant_noApproveOrArbitraryCallEverAllowed() public view {
        address[4] memory targets =
            [address(vault), address(aavePool), address(router), address(0xBEEF)];
        bytes4[4] memory forbidden = [SEL_APPROVE, SEL_TRANSFER, SEL_TRANSFER_FROM, SEL_EMPTY];
        for (uint256 i = 0; i < targets.length; i++) {
            for (uint256 j = 0; j < forbidden.length; j++) {
                assertFalse(
                    policy.isAllowedTarget(targets[i], forbidden[j]),
                    "G5: approve/transfer/arbitrary must never be allowlisted"
                );
            }
        }
    }

    /// @dev spent is monotonic and bounded by cumulativeCap, and mirrors the accepted notionals.
    function invariant_spentMonotonicAndBounded() public view {
        assertLe(ghostAcceptedCumulative, SESSION_CUMULATIVE, "G2: accepted spend exceeded the cap");
        uint256 spent = policy.policyOf(address(account), sessionKey).spent;
        assertLe(spent, SESSION_CUMULATIVE, "G2: on-chain spent exceeded the cap");
        assertEq(spent, ghostAcceptedCumulative, "G2: spent must equal accepted notionals");
    }

    // ── Deterministic gates (proof of RED) ──

    /// @dev fuzz: any (target,selector) NOT one of the six seeded pairs must be rejected.
    function testFuzz_isAllowedTarget_onlySeededPairs(address t, bytes4 s) public view {
        bool seeded =
            (t == address(vault)
                    && (s == SEL_VAULT_DEPOSIT || s == SEL_VAULT_REDEEM || s == SEL_VAULT_WITHDRAW))
                || (t == address(aavePool) && (s == SEL_AAVE_SUPPLY || s == SEL_AAVE_WITHDRAW))
                || (t == address(router) && s == SEL_AERO_SWAP);
        vm.assume(!seeded);
        assertFalse(policy.isAllowedTarget(t, s), "only the six seeded pairs may be allowlisted");
    }

    function test_checkAction_rejectsOverPerTxCap() public view {
        IPolicyModule.Call memory call = IPolicyModule.Call({
            target: address(vault),
            value: 0,
            data: _vaultDepositCd(uint256(SESSION_PER_TX) + 1, address(account))
        });
        (bool ok,) = policy.checkAction(address(account), call, uint256(SESSION_PER_TX) + 1);
        assertFalse(ok, "checkAction must reject a notional above the per-tx cap");
    }

    function test_checkAction_rejectsExternalRecipient() public view {
        IPolicyModule.Call memory call = IPolicyModule.Call({
            target: address(vault), value: 0, data: _vaultDepositCd(100e6, sparkpoint)
        });
        (bool ok,) = policy.checkAction(address(account), call, 100e6);
        assertFalse(ok, "checkAction must reject an external recipient");
    }

    function test_checkAction_acceptsInScope() public view {
        IPolicyModule.Call memory call = IPolicyModule.Call({
            target: address(vault), value: 0, data: _vaultDepositCd(100e6, address(account))
        });
        (bool ok,) = policy.checkAction(address(account), call, 100e6);
        assertTrue(ok, "checkAction must accept a fully in-scope call");
    }
}
