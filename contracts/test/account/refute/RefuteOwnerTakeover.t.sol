// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";

import { AccountTestBase } from "../utils/AccountTestBase.sol";
import { SparkPointAccount } from "../../../src/account/SparkPointAccount.sol";
import { AccountFactory } from "../../../src/account/AccountFactory.sol";

/// @notice A hostile UUPS implementation the attacker WANTS the account upgraded to: a single, unguarded
///         `pwn()` overwrites slot 0 (SparkPointAccount._owner) with any address, and `_authorizeUpgrade`
///         is wide open. If a non-owner could ever complete `upgradeToAndCall(address(this), ...)`, the
///         user's account would be seized outright. Every attempt to install it below is BLOCKED — this
///         contract is deployed but NEVER becomes the account's logic. (smart-contracts.md §2, N3.)
contract HostileImpl is UUPSUpgradeable {
    address public owner; // slot 0 — aligns with SparkPointAccount._owner

    function pwn(address newOwner) external {
        owner = newOwner; // no auth: if this were ever the account's code, anyone seizes it
    }

    function _authorizeUpgrade(address) internal override { } // deliberately open
}

/// @title RefuteOwnerTakeover — ADVERSARIAL refutation of invariant N3 (owner/upgrade takeover).
/// @notice Ground truth: smart-contracts.md §2 (SparkPointAccount, N3 — owner is the sole admin; UUPS
///         `_authorizeUpgrade` is `owner()`-only) and §3 (AccountFactory, N3 — owner is bound to the
///         supplied EOA and folded into the CREATE2 address). CLAUDE.md N3: "owner() == the user EOA,
///         set at initialize, sole admin; NO backend/SparkPoint address is ever owner/guardian/recovery.
///         UUPS _authorizeUpgrade gated to owner() ONLY — SparkPoint can never upgrade a user's account.
///         Factory binds owner == caller-supplied EOA."
///
///         Each test is a hostile PoC ATTEMPT run from a NON-OWNER seat — the `attacker` EOA and the
///         `sparkpoint` backend address. If N3 holds, the attempt is BLOCKED and the test asserts that
///         fact (suite GREEN => NOT REFUTED). If ANY attempt actually seizes ownership or swaps the
///         implementation, its assertion fails (suite RED => REFUTED). Vectors probed:
///           (1) become/replace owner()            — transferOwnership from a non-owner.
///           (2) swap the implementation           — upgradeToAndCall / _authorizeUpgrade from a non-owner,
///                                                    incl. a malicious impl + a seize-on-upgrade initializer.
///           (3) re-run initialize to rebind owner — proxy re-init + implementation re-init.
///           (4) inject a SparkPoint co-signer      — the full guardian/recovery/co-signer selector battery.
///              /guardian/recovery
///           (5) route a takeover through a session — session-key op that self-calls transferOwnership/
///               key or a self-call                   upgradeToAndCall (blocked at the validator AND the gate).
///           (6) factory mints a non-caller owner   — squat a victim's counterfactual address as attacker.
contract RefuteOwnerTakeoverTest is AccountTestBase {
    // EIP-1967 implementation slot — the proxy's live logic pointer. A takeover would rewrite it.
    bytes32 internal constant EIP1967_IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    AccountFactory internal factory;
    HostileImpl internal hostile;

    address internal victim = makeAddr("victim"); // an honest user who has NOT deployed yet

    function setUp() public {
        _deployAccountStack(); // owner-bound account behind an ERC1967 proxy + full 4337 stack
        factory = new AccountFactory(address(accountImpl));
        hostile = new HostileImpl();
    }

    function _implOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, EIP1967_IMPL_SLOT))));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (1) BECOME / REPLACE owner() — transferOwnership is onlyOwner; a non-owner can never call it.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_nonOwnerCannotTransferOwnership() public {
        // Attacker tries to seize ownership.
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.transferOwnership(attacker);

        // The SparkPoint backend tries to seize ownership.
        vm.prank(sparkpoint);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.transferOwnership(sparkpoint);

        // Attacker tries to hand ownership to the backend (collusion angle).
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.transferOwnership(sparkpoint);

        assertEq(account.owner(), owner, "N3 REFUTED: owner() changed under a non-owner call");

        // Positive control: the real owner CAN transfer, proving the gate is the owner check, not a
        // globally-frozen function.
        vm.prank(owner);
        account.transferOwnership(victim);
        assertEq(account.owner(), victim, "owner transfer by the real owner must work");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (2) SWAP THE IMPLEMENTATION — _authorizeUpgrade is owner-only; SparkPoint can never upgrade a
    //     user's account (§2, N3). Probe upgradeToAndCall from every non-owner seat, with a benign and a
    //     seize-on-upgrade payload, then confirm the live implementation pointer never moved.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_nonOwnerCannotUpgradeImplementation() public {
        address implBefore = _implOf(address(account));
        assertEq(implBefore, address(accountImpl), "precondition: proxy points at accountImpl");

        bytes memory seizeInit = abi.encodeWithSelector(HostileImpl.pwn.selector, attacker);

        // Attacker: benign upgrade.
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.upgradeToAndCall(address(hostile), "");

        // Attacker: upgrade + seize-on-install initializer (auth is checked BEFORE any delegatecall).
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.upgradeToAndCall(address(hostile), seizeInit);

        // SparkPoint backend: same two attempts.
        vm.prank(sparkpoint);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.upgradeToAndCall(address(hostile), "");

        vm.prank(sparkpoint);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.upgradeToAndCall(address(hostile), seizeInit);

        // Nothing moved: the live logic pointer and the owner are exactly as before.
        assertEq(_implOf(address(account)), implBefore, "N3 REFUTED: implementation was swapped");
        assertEq(account.owner(), owner, "N3 REFUTED: owner changed via an upgrade");

        // Positive control: the real owner CAN upgrade (to a fresh, benign impl), proving the only thing
        // separating success from failure is being owner() — the gate is real, not vacuous.
        SparkPointAccount freshImpl = new SparkPointAccount(
            IEntryPoint(address(entryPoint)), address(validator), address(policy)
        );
        vm.prank(owner);
        account.upgradeToAndCall(address(freshImpl), "");
        assertEq(_implOf(address(account)), address(freshImpl), "owner upgrade must take effect");
        assertEq(account.owner(), owner, "owner must be preserved across an owner-driven upgrade");
    }

    /// @dev `_authorizeUpgrade` is `internal` and MUST NOT be reachable as an external selector, and the
    ///      pre-UUPSv5 `upgradeTo(address)` entrypoint MUST NOT exist. No fallback => raw calls revert.
    function test_refute_noRawUpgradeAuthorizeSelector() public {
        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeWithSignature("_authorizeUpgrade(address)", address(hostile));
        payloads[1] = abi.encodeWithSignature("upgradeTo(address)", address(hostile));

        vm.startPrank(attacker);
        for (uint256 i = 0; i < payloads.length; i++) {
            (bool ok,) = address(account).call(payloads[i]);
            assertFalse(ok, "N3 REFUTED: a raw upgrade/authorize selector is reachable");
        }
        vm.stopPrank();
        assertEq(_implOf(address(account)), address(accountImpl), "N3: implementation changed");
    }

    /// @dev The implementation contract itself is inert: initializers are disabled and UUPS `onlyProxy`
    ///      blocks a direct upgrade — so an attacker cannot hijack or brick the shared logic (the
    ///      Parity-wallet class of takeover). The impl's `owner()` is never set.
    function test_refute_implementationContractIsInert() public {
        assertEq(accountImpl.owner(), address(0), "impl must never be initialized");

        // Cannot initialize the implementation directly (constructor disabled initializers).
        vm.prank(attacker);
        vm.expectRevert();
        accountImpl.initialize(attacker);

        // Cannot upgrade *through the implementation* (UUPS onlyProxy: not a delegatecall context).
        vm.prank(attacker);
        vm.expectRevert();
        accountImpl.upgradeToAndCall(address(hostile), "");

        assertEq(accountImpl.owner(), address(0), "N3 REFUTED: impl owner was seized");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (3) RE-RUN initialize TO REBIND owner — the proxy is already initialized; a second initialize
    //     MUST revert, so no one can rebind owner to attacker/SparkPoint.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_cannotReinitializeToRebindOwner() public {
        vm.prank(attacker);
        vm.expectRevert(); // InvalidInitialization (already initialized)
        account.initialize(attacker);

        vm.prank(sparkpoint);
        vm.expectRevert();
        account.initialize(sparkpoint);

        assertEq(account.owner(), owner, "N3 REFUTED: re-initialize rebound owner");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (4) INJECT A SparkPoint CO-SIGNER / GUARDIAN / RECOVERY — the account exposes NO such surface.
    //     Blast the full battery of takeover selectors from both the attacker and the SparkPoint backend;
    //     with no fallback every one reverts, and owner() is unmoved.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_noCoSignerGuardianRecoverySurface() public {
        bytes[] memory p = new bytes[](18);
        p[0] = abi.encodeWithSignature("setGuardian(address)", sparkpoint);
        p[1] = abi.encodeWithSignature("addGuardian(address)", sparkpoint);
        p[2] = abi.encodeWithSignature("removeGuardian(address)", owner);
        p[3] = abi.encodeWithSignature("setRecovery(address)", sparkpoint);
        p[4] = abi.encodeWithSignature("initiateRecovery(address)", attacker);
        p[5] = abi.encodeWithSignature("executeRecovery(address)", attacker);
        p[6] = abi.encodeWithSignature("cancelRecovery()");
        p[7] = abi.encodeWithSignature("addOwner(address)", attacker);
        p[8] = abi.encodeWithSignature("setOwner(address)", attacker);
        p[9] = abi.encodeWithSignature("changeOwner(address)", attacker);
        p[10] = abi.encodeWithSignature("removeOwner(address)", owner);
        p[11] = abi.encodeWithSignature("addSigner(address)", sparkpoint);
        p[12] = abi.encodeWithSignature("setCoSigner(address)", sparkpoint);
        p[13] = abi.encodeWithSignature("grantRole(bytes32,address)", bytes32("ADMIN"), attacker);
        p[14] = abi.encodeWithSignature("setAdmin(address)", attacker);
        p[15] = abi.encodeWithSignature("setEntryPoint(address)", attacker);
        p[16] = abi.encodeWithSignature("setSessionValidator(address)", attacker);
        p[17] = abi.encodeWithSignature("renounceOwnership()");

        address[2] memory callers = [attacker, sparkpoint];
        for (uint256 c = 0; c < callers.length; c++) {
            vm.startPrank(callers[c]);
            for (uint256 i = 0; i < p.length; i++) {
                (bool ok,) = address(account).call(p[i]);
                assertFalse(ok, "N3 REFUTED: a co-signer/guardian/recovery selector executed");
            }
            vm.stopPrank();
        }

        assertEq(account.owner(), owner, "N3 REFUTED: owner() moved via an injected role");
        assertTrue(account.owner() != sparkpoint, "N3: SparkPoint became owner");
        assertTrue(account.owner() != attacker, "N3: attacker became owner");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (5) TAKEOVER VIA A SESSION KEY OR A SELF-CALL — a compromised agent holding the session key routes
    //     a UserOp whose inner call is account.transferOwnership / upgradeToAndCall. It is rejected at the
    //     validator (target/selector not allowlisted) AND, even if validation were bypassed, the inner
    //     self-call reverts because transferOwnership/_authorizeUpgrade are owner-gated and msg.sender is
    //     the account, not the owner.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_sessionKeyCannotSelfCallOwnershipOrUpgrade() public {
        // (a) Validator layer: a session op self-calling transferOwnership is NOT accepted.
        bytes memory xferInner =
            abi.encodeWithSelector(SparkPointAccount.transferOwnership.selector, attacker);
        PackedUserOperation memory op1 = _sessionOp(_execCd(address(account), 0, xferInner));
        assertFalse(_accountAccepts(op1), "N3 REFUTED: session op to transferOwnership validated");

        // (b) Validator layer: a session op self-calling upgradeToAndCall is NOT accepted.
        bytes memory upgInner = abi.encodeWithSelector(
            SparkPointAccount.upgradeToAndCall.selector, address(hostile), bytes("")
        );
        PackedUserOperation memory op2 = _sessionOp(_execCd(address(account), 0, upgInner));
        assertFalse(_accountAccepts(op2), "N3 REFUTED: session op to upgradeToAndCall validated");

        // (c) Defense in depth: even a post-validation EntryPoint-driven self-call reverts, because the
        //     inner transferOwnership sees msg.sender == the account, not the owner.
        vm.prank(address(entryPoint));
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.execute(address(account), 0, xferInner);

        assertEq(account.owner(), owner, "N3 REFUTED: a session/self-call moved owner()");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (6) FACTORY MINTS AN ACCOUNT OWNED BY A NON-CALLER — the owner is folded into the proxy init data
    //     AND the CREATE2 address, so an account's owner() is immutably the address it was minted for. An
    //     attacker cannot squat a victim's counterfactual address as the owner.
    // ─────────────────────────────────────────────────────────────────────────

    function test_refute_factoryBindsOwnerTamperProof() public {
        // The attacker deploys the *victim's* account (griefing / front-run). It is still victim-owned —
        // the attacker gains nothing.
        vm.prank(attacker);
        address vAcct = factory.createAccount(victim, 1);
        assertEq(SparkPointAccount(payable(vAcct)).owner(), victim, "N3 REFUTED: griefer set owner");

        // The attacker cannot make the victim's counterfactual address resolve to attacker-ownership:
        // a different owner yields a DIFFERENT address (owner is in the init-code hash).
        address victimAddr = factory.getAddress(victim, 1);
        address attackerAddr = factory.getAddress(attacker, 1);
        assertTrue(victimAddr != attackerAddr, "N3 REFUTED: distinct owners collide to one address");
        assertEq(victimAddr, vAcct, "the victim address is bound to the victim's account");

        // Deploying with owner=attacker at the same salt lands at attackerAddr and is attacker-owned —
        // it does NOT overwrite or re-own the victim's account.
        vm.prank(attacker);
        address aAcct = factory.createAccount(attacker, 1);
        assertEq(aAcct, attackerAddr, "attacker deploy must land at its own counterfactual address");
        assertEq(SparkPointAccount(payable(aAcct)).owner(), attacker, "attacker owns only its own");
        assertEq(
            SparkPointAccount(payable(vAcct)).owner(), victim, "N3 REFUTED: victim account re-owned"
        );

        // And a freshly minted account is never owned by SparkPoint or the factory.
        assertTrue(
            SparkPointAccount(payable(vAcct)).owner() != sparkpoint, "N3: SparkPoint owns it"
        );
        assertTrue(
            SparkPointAccount(payable(vAcct)).owner() != address(factory), "N3: factory owns it"
        );
    }
}
