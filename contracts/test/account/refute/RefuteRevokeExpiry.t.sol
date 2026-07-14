// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";
import { PolicyModule } from "../../../src/account/PolicyModule.sol";

/// @title RefuteRevokeExpiry — ADVERSARIAL refuter for N4 (revocation + expiry bypass).
/// @notice Cites smart-contracts.md §4 (the 6-step deterministic flow, "reads live storage so a
///         revocation takes effect on the very next UserOp") and §5 (PolicyModule account-associated
///         storage, monotonic `spent`). Threat actor = a compromised agent that holds a session
///         private key and can craft/submit arbitrary UserOps; the owner EOA is trusted.
///
/// Each test either (a) DOCUMENTS A HELD DEFENSE — the attack is asserted to fail, so N4 stands — or
/// (b) is a PoC that a scope guarantee is broken (asserted to succeed). The suite is GREEN either way:
/// a passing "defense" test proves the bypass did not work; the passing "_POC" test proves it did.
///
/// RESULT: N4's revoke-immediacy and normal-expiry guarantees HOLD. One packing hazard was REFUTED and
/// is now FIXED (these _POC tests are the regression guards): `validUntil == 0` (the "infinite session"
/// sentinel the spec's SessionBounds says must be impossible — policy-schema.md §6 "No infinite session")
/// was accepted at arming, and the validator's step-2 early return packed it into the EntryPoint's
/// `_parseValidationData` `0 → type(uint48).max` conversion, defeating the hard expiry AND skipping the
/// allowlist / cap / recipient-pin / slippage checks (steps 3-6). FIX (defense-in-depth): PolicyModule
/// .registerSession now REVERTS `ZeroValidUntil` (and `SessionTooLong` beyond maxSessionDurationDays), and
/// SessionKeyValidator step 2 hard-fails any stored `validUntil == 0` before it can be packed.
contract RefuteRevokeExpiryTest is AccountTestBase {
    address internal rogue = makeAddr("rogueTarget"); // never seeded into the allowlist

    function setUp() public {
        _deployAccountStack();
    }

    // ── helper: owner-authorize a key with an explicit window ──
    function _authorize(address key, uint48 va, uint48 vu) internal {
        IPolicyModule.Policy memory p = _defaultPolicy();
        p.sessionKey = key;
        p.validAfter = va;
        p.validUntil = vu;
        vm.prank(owner);
        account.authorizeSessionKey(p);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DEFENSE 1 — revocation is immediate on the very next UserOp (live storage read)
    // ─────────────────────────────────────────────────────────────────────────────

    /// @dev §4 step 1 reads `policyOf(...).revoked` from live storage every call. The exact same signed
    ///      op that validated a block ago must fail the instant the owner revokes — no timelock, no cache.
    function test_defense_revokeIsImmediate_sameSignedUserOpFlips() public {
        (address k, uint256 pk) = makeAddrAndKey("liveKey");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));

        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        PackedUserOperation memory op = _sessionOpWith(pk, cd);
        assertTrue(_accountAccepts(op), "precondition: op validates while key is live");

        vm.prank(owner);
        account.revokeSessionKey(k);

        // No re-sign, no re-build — the identical op is now rejected.
        assertFalse(_accountAccepts(op), "REFUTE FAILED (good): revoked key still validated");
    }

    /// @dev A revoked key is dead for EVERY future op, not just the one probed — try several selectors.
    function test_defense_revokedKeyDeadForAllActions() public {
        (address k, uint256 pk) = makeAddrAndKey("multiKey");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));
        vm.prank(owner);
        account.revokeSessionKey(k);

        bytes memory dep = _execCd(address(vault), 0, _vaultDepositCd(1e6, address(account)));
        bytes memory sup =
            _execCd(address(aavePool), 0, _aaveSupplyCd(address(usdc), 1e6, address(account)));
        assertFalse(_accountAccepts(_sessionOpWith(pk, dep)), "revoked: deposit must fail");
        assertFalse(_accountAccepts(_sessionOpWith(pk, sup)), "revoked: supply must fail");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DEFENSE 2 — a compromised agent cannot UN-revoke or re-arm its own key
    // ─────────────────────────────────────────────────────────────────────────────

    /// @dev The agent calling PolicyModule.registerSession DIRECTLY writes into ITS OWN account
    ///      namespace (`_policies[msg.sender]`), never the victim's — account-associated storage (§5).
    ///      The victim's revoked policy is untouched, so the key stays dead.
    function test_defense_agentCannotUnrevoke_viaDirectRegisterSession() public {
        (address k, uint256 pk) = makeAddrAndKey("reviveKey");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));
        vm.prank(owner);
        account.revokeSessionKey(k);

        // Attacker forges a pristine (revoked=false, spent=0) policy and re-registers it.
        IPolicyModule.Policy memory forged = _defaultPolicy();
        forged.sessionKey = k;
        forged.revoked = false;
        vm.prank(attacker);
        policy.registerSession(forged); // writes _policies[attacker][k], NOT _policies[account][k]

        // Victim account's policy is still revoked — the agent's write landed in a foreign namespace.
        assertTrue(
            policy.policyOf(address(account), k).revoked, "victim policy must remain revoked"
        );
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        assertFalse(
            _accountAccepts(_sessionOpWith(pk, cd)),
            "REFUTE FAILED (good): key revived via foreign register"
        );
    }

    /// @dev The agent cannot route through the account either: `execute`-ing PolicyModule.registerSession
    ///      is not an allowlisted (target,selector) pair, so validation rejects it before any state write.
    function test_defense_agentCannotReachRegisterSession_viaSessionExecute() public {
        IPolicyModule.Policy memory forged = _defaultPolicy();
        bytes memory inner = abi.encodeWithSelector(PolicyModule.registerSession.selector, forged);
        bytes memory cd = _execCd(address(policy), 0, inner);
        assertFalse(
            _accountAccepts(_sessionOp(cd)),
            "REFUTE FAILED (good): session op reached registerSession"
        );
    }

    /// @dev `authorizeSessionKey` is owner-gated; the agent (or any non-owner) cannot re-arm a key.
    function test_defense_agentCannotCallAuthorizeSessionKey() public {
        IPolicyModule.Policy memory p = _defaultPolicy();
        p.sessionKey = sessionKey;
        vm.prank(attacker);
        vm.expectRevert(); // NotOwner
        account.authorizeSessionKey(p);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DEFENSE 3 — revocation cannot be blocked, paused, or front-run into a no-op
    // ─────────────────────────────────────────────────────────────────────────────

    /// @dev `revokeSessionKey` is a plain owner EOA call with no pause flag and no external call in its
    ///      path (PolicyModule.revokeSession only flips a bool). Nothing an agent does can wedge it. We
    ///      simulate a hostile agent burning the key right up to the block the owner revokes in — the
    ///      revoke still lands and the next op dies.
    function test_defense_revocationIsUnpausableAndUnblockable() public {
        (address k, uint256 pk) = makeAddrAndKey("racedKey");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));

        // Agent churns in-scope right up to the wire.
        bytes memory churn = _execCd(address(vault), 0, _vaultDepositCd(10e6, address(account)));
        assertTrue(_accountAccepts(_sessionOpWith(pk, churn)), "agent churns before revoke");

        // Owner revokes — no argument, no guard, no revert path.
        vm.prank(owner);
        account.revokeSessionKey(k);

        assertFalse(
            _accountAccepts(_sessionOpWith(pk, churn)),
            "REFUTE FAILED (good): revoke was blockable/pausable"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DEFENSE 4 — the monotonic `spent` ledger cannot be reset or written by the agent
    // ─────────────────────────────────────────────────────────────────────────────

    /// @dev `recordSpend` is `onlyValidator`; a direct agent call reverts. And re-registration by the
    ///      agent lands in a foreign namespace (Defense 2), so the victim's monotonic `spent` cannot be
    ///      zeroed by anyone but the trusted owner re-arming the key.
    function test_defense_spentLedgerNotResettableByAgent() public {
        // Accumulate real spend on the default session key via an accepted in-scope deposit.
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(400e6, address(account)));
        assertTrue(_accountAccepts(_sessionOp(cd)), "in-scope deposit accepted");
        assertEq(policy.policyOf(address(account), sessionKey).spent, 400e6, "spend recorded");

        // Agent tries to write the ledger directly — onlyValidator gate reverts.
        vm.prank(attacker);
        vm.expectRevert(PolicyModule.OnlyValidator.selector);
        policy.recordSpend(address(account), sessionKey, 0);

        // Agent tries to re-register a zeroed policy for the victim's key — lands in attacker namespace.
        IPolicyModule.Policy memory forged = _defaultPolicy();
        forged.spent = 0;
        vm.prank(attacker);
        policy.registerSession(forged);

        assertEq(
            policy.policyOf(address(account), sessionKey).spent,
            400e6,
            "REFUTE FAILED (good): monotonic spent was reset by the agent"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DEFENSE 5 — a NORMAL (nonzero) expired window is rejected; packing not attacker-set
    // ─────────────────────────────────────────────────────────────────────────────

    /// @dev The window lives in on-chain storage set by the owner — the agent's UserOp carries no
    ///      validAfter/validUntil, so it cannot manipulate the packing directly. A key whose nonzero
    ///      window is in the past packs its real (past) validUntil, which the EntryPoint rejects.
    function test_defense_normalExpiredKeyRejected() public {
        (address k, uint256 pk) = makeAddrAndKey("expiredNonzero");
        _authorize(k, uint48(block.timestamp - 2 days), uint48(block.timestamp - 1 days));
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        assertFalse(
            _accountAccepts(_sessionOpWith(pk, cd)),
            "REFUTE FAILED (good): nonzero-expired key still validated"
        );
    }

    /// @dev An INVERTED window (validAfter > validUntil, both nonzero) is likewise always rejected.
    function test_defense_invertedWindowRejected() public {
        (address k, uint256 pk) = makeAddrAndKey("invertedWindow");
        _authorize(k, uint48(block.timestamp + 10 days), uint48(block.timestamp + 1 days));
        bytes memory cd = _execCd(address(vault), 0, _vaultDepositCd(100e6, address(account)));
        assertFalse(
            _accountAccepts(_sessionOpWith(pk, cd)),
            "REFUTE FAILED (good): inverted window validated"
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // REFUTED — `validUntil == 0` packing bypass. PoC.
    //
    // policy-schema.md §6 SessionBounds: "validUntil - validAfter ≤ this. No infinite session."
    // The on-chain `authorizeSessionKey`/`registerSession` enforce NO such bound and NO `validUntil != 0`
    // guard. When a key is armed with validUntil == 0 (the near-universal "no expiry" sentinel — the
    // eth-infinitism helper the code calls even documents "validUntil - ... (or zero for infinite)"),
    // SessionKeyValidator step 2 takes the out-of-window branch (block.timestamp > 0) and returns
    // `_packValidationData(false, /*validUntil*/0, validAfter)`. The EntryPoint's `_parseValidationData`
    // then rewrites validUntil 0 → type(uint48).max, so the op is ACCEPTED — AND the early return means
    // steps 3-6 (allowlist, per-tx/cumulative caps, recipient pin, slippage) NEVER RUN. A compromised
    // agent holding such a key can name an external recipient, hit an unknown target, exceed every cap,
    // and use a forbidden selector — with no spend ever recorded. Full N4 + N1 break.
    // ═════════════════════════════════════════════════════════════════════════════

    /// @dev FIXED (regression guard) — was the CORE PoC. Arming a key with the `validUntil == 0`
    ///      infinite-session sentinel is now REJECTED at authorization (PolicyModule.registerSession),
    ///      so the unscoped, never-expiring drain key can never be created in the first place. The whole
    ///      bypass (rogue target + approve + over-cap + external recipient) rested on being able to arm
    ///      validUntil==0; closing it at the source removes every downstream PoC.
    function test_refute_validUntilZero_rejectedAtArming() public {
        (address k,) = makeAddrAndKey("infiniteKey");
        vm.expectRevert(PolicyModule.ZeroValidUntil.selector);
        _authorize(k, uint48(block.timestamp), 0); // "no expiry" sentinel — MUST revert now
    }

    /// @dev FIXED (regression guard) — the max-duration bound (maxSessionDurationDays = 30) rejects an
    ///      over-long key at arming, so an owner cannot mint a decade-long session either (N4 bound).
    function test_refute_sessionTooLong_rejectedAtArming() public {
        (address k,) = makeAddrAndKey("decadeKey");
        vm.expectRevert(PolicyModule.SessionTooLong.selector);
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 3650 days));
    }

    /// @dev Belt-and-suspenders oracle: the SAME catastrophic op (rogue target + forbidden approve +
    ///      over-cap + external recipient) under a NORMAL bounded key is rejected inside validateUserOp —
    ///      i.e. scope steps 3-6 do run. This is the positive counterpart proving the fix restores full
    ///      scope enforcement (the validator also hard-fails any stored validUntil==0 in step 2).
    function test_refute_validUntilZero_exploitOpRejectedUnderBoundedKey() public {
        (address k, uint256 pk) = makeAddrAndKey("boundedKey0");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));

        bytes memory forbiddenInner =
            abi.encodeWithSelector(SEL_APPROVE, sparkpoint, uint256(10_000_000e6));
        PackedUserOperation memory op = _sessionOpWith(pk, _execCd(rogue, 0, forbiddenInner));
        assertFalse(
            _accountAccepts(op),
            "rogue target + approve + over-cap + external recipient must be rejected by scope checks"
        );
    }

    /// @dev CONTRAST / would-be fix oracle: the SAME rogue+approve+over-cap+external op under a normal
    ///      nonzero window is correctly REJECTED. This isolates `validUntil == 0` as the sole cause and
    ///      is the assertion a fix (reject validUntil==0 at authorization, or treat it as expired in the
    ///      validator) must make pass for the zero case too.
    function test_refute_contrast_nonzeroWindowRejectsSameOp() public {
        (address k, uint256 pk) = makeAddrAndKey("boundedKey");
        _authorize(k, uint48(block.timestamp), uint48(block.timestamp + 7 days));

        bytes memory forbiddenInner =
            abi.encodeWithSelector(SEL_APPROVE, sparkpoint, uint256(10_000_000e6));
        bytes memory cd = _execCd(rogue, 0, forbiddenInner);
        assertFalse(
            _accountAccepts(_sessionOpWith(pk, cd)),
            "control: bounded key must reject the out-of-scope op"
        );
    }
}
