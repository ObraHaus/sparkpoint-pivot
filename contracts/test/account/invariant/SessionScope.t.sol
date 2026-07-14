// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";

/// @title SessionScope — N4: a session key can ONLY do in-scope churn (smart-contracts.md §4).
/// @notice invariant_sessionCannotExceedPerTxCap, invariant_sessionCumulativeMonotonicAndCapped,
///         invariant_sessionRejectsAfterExpiry, invariant_sessionRejectsNonAllowlistedTarget,
///         invariant_sessionRecipientIsAccount, invariant_revokeIsImmediate.
///
/// The decisive probe lives in each invariant body (an out-of-scope UserOp driven through validation),
/// so RED is deterministic against the accept-all stub. The one handler action (h_sessionDeposit)
/// accumulates in-scope spend so the cumulative accounting invariant is exercised across states.
contract SessionScopeTest is StdInvariant, AccountTestBase {
    address internal expiredKey;
    uint256 internal expiredPk;
    address internal revokedKey;
    uint256 internal revokedPk;

    // Ghost: sum of notionals of ACCEPTED in-scope session deposits (mirrors on-chain `spent`).
    uint256 public ghostAcceptedCumulative;

    function setUp() public {
        _deployAccountStack();

        // A key whose window is already in the PAST (expiry probe).
        (expiredKey, expiredPk) = makeAddrAndKey("expiredKey");
        IPolicyModule.Policy memory ep = _defaultPolicy();
        ep.sessionKey = expiredKey;
        ep.validAfter = uint48(block.timestamp - 2 days);
        ep.validUntil = uint48(block.timestamp - 1 days);
        vm.prank(owner);
        account.authorizeSessionKey(ep);

        // A key that was authorized then REVOKED (immediate-revoke probe).
        (revokedKey, revokedPk) = makeAddrAndKey("revokedKey");
        IPolicyModule.Policy memory rp = _defaultPolicy();
        rp.sessionKey = revokedKey;
        vm.startPrank(owner);
        account.authorizeSessionKey(rp);
        account.revokeSessionKey(revokedKey);
        vm.stopPrank();

        bytes4[] memory sel = new bytes4[](1);
        sel[0] = this.h_sessionDeposit.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: sel }));
        targetContract(address(this));
    }

    // ── Handler action: in-scope, per-tx-sized vault deposit to the account itself ──
    function h_sessionDeposit(uint256 amount) public {
        amount = bound(amount, 1, SESSION_PER_TX);
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(amount, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        if (_accountAccepts(op)) {
            ghostAcceptedCumulative += amount;
        }
    }

    // ── N4 invariants ──

    /// @dev A session UserOp whose notional exceeds the per-tx cap must be REJECTED.
    function invariant_sessionCannotExceedPerTxCap() public {
        bytes memory cd = _execCd(
            address(vault), 0, _vaultDepositCd(uint256(SESSION_PER_TX) + 1, address(account))
        );
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_accountAccepts(op), "N4: session op above per-tx cap must be rejected");
    }

    /// @dev Cumulative spend is bounded by cumulativeCap and the on-chain `spent` tracks accepted
    ///      notionals monotonically (ghost mirror). RED against the stub two ways: accept-all pushes
    ///      the ghost past the cap, and the non-accounting stub leaves `spent` at 0 ≠ ghost.
    function invariant_sessionCumulativeMonotonicAndCapped() public view {
        assertLe(
            ghostAcceptedCumulative, SESSION_CUMULATIVE, "N4: cumulative spend exceeded the cap"
        );
        uint256 spent = policy.policyOf(address(account), sessionKey).spent;
        assertEq(spent, ghostAcceptedCumulative, "N4: on-chain spent must track accepted notionals");
    }

    /// @dev After validUntil, EVERY session op under that key is rejected (packed expiry / FAILED).
    function invariant_sessionRejectsAfterExpiry() public {
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOpWith(expiredPk, cd);
        assertFalse(_accountAccepts(op), "N4: expired session key must be rejected");
    }

    /// @dev A session op to a target/selector NOT on the allowlist is rejected (G5).
    function invariant_sessionRejectsNonAllowlistedTarget() public {
        address rogue = address(0xBEEF); // never seeded into the allowlist
        bytes memory cd = _execCd(rogue, 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_accountAccepts(op), "N4/G5: non-allowlisted target must be rejected");
    }

    /// @dev The recipient/`to` of a session op is forced to the account — an external recipient is
    ///      rejected, so a compromised agent can never exfiltrate funds (N1 reinforced).
    function invariant_sessionRecipientIsAccount() public {
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, sparkpoint));
        PackedUserOperation memory op = _sessionOp(cd);
        assertFalse(_accountAccepts(op), "N4/N1: external recipient must be rejected");
    }

    /// @dev Revocation is immediate: an op signed by a revoked key is ALWAYS rejected (live storage).
    function invariant_revokeIsImmediate() public {
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOpWith(revokedPk, cd);
        assertFalse(_accountAccepts(op), "N4: revoked session key must be rejected immediately");
    }

    // ── Deterministic gates (proof of RED) ──

    /// @dev A fully in-scope session deposit to the account IS accepted (positive path stays intact).
    function test_inScopeSessionDeposit_isAccepted() public {
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOp(cd);
        assertTrue(_accountAccepts(op), "in-scope session deposit must validate");
    }

    /// @dev Revoke takes effect on the VERY NEXT UserOp under the same key (FR-031, SC-008).
    function test_revokeIsImmediate_sameUserOpFailsValidation() public {
        (address k, uint256 pk) = makeAddrAndKey("liveKey");
        IPolicyModule.Policy memory p = _defaultPolicy();
        p.sessionKey = k;
        vm.prank(owner);
        account.authorizeSessionKey(p);

        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOpWith(pk, cd);
        assertTrue(_accountAccepts(op), "precondition: op validates while key is live");

        vm.prank(owner);
        account.revokeSessionKey(k);
        assertFalse(_accountAccepts(op), "N4: the SAME op must fail once the key is revoked");
    }
}
