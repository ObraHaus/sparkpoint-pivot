// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { EntryPoint } from "@account-abstraction/core/EntryPoint.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { _parseValidationData, ValidationData } from "@account-abstraction/core/Helpers.sol";

import { SparkPointAccount } from "../../../src/account/SparkPointAccount.sol";
import { SessionKeyValidator } from "../../../src/account/SessionKeyValidator.sol";
import { PolicyModule } from "../../../src/account/PolicyModule.sol";
import { AccountFactory } from "../../../src/account/AccountFactory.sol";
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";

/*//////////////////////////////////////////////////////////////////////////
                           SELF-BUILT ATTACK HARNESS

  STAGE-2.9 adversarial refuter. This file DOES NOT inherit the author's
  AccountTestBase — the whole stack (real EntryPoint v0.7 + PolicyModule +
  SessionKeyValidator + SparkPointAccount behind an ERC1967 proxy) is built
  from scratch in setUp so nothing about the harness is taken on trust.

  Signature layout under test:  mode(1) || r(32) || s(32) || v(1)  (66 bytes)
    over EIP-191(entryPoint.getUserOpHash(op)).  mode 0x01 = session key.
//////////////////////////////////////////////////////////////////////////*/

/// @dev Minimal ERC-20 (0.8 arithmetic reverts on underflow — insufficient balance/allowance fail closed).
contract TToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }
}

/// @notice A protocol target that ACTUALLY MOVES TOKENS to the decoded recipient of each allowlisted
///         selector (deposit/redeem/withdraw/supply/aave-withdraw/swap). If the N1 recipient pin could be
///         evaded, an attacker set as `receiver`/`to`/`onBehalfOf` would receive the vault's TToken here.
///         It also banks any ETH `value` forwarded by `execute` so we can probe the native-value surface.
contract DrainableVault {
    TToken public immutable token;
    uint256 public ethReceived;

    constructor(TToken t) {
        token = t;
    }

    receive() external payable {
        ethReceived += msg.value;
    }

    fallback() external payable {
        ethReceived += msg.value;
        if (msg.data.length < 4) return;
        bytes4 sel = bytes4(msg.data);
        uint256 nIdx;
        uint256 rIdx;
        bool known;
        // deposit(assets,receiver) / redeem(shares,receiver,owner) / withdraw(assets,receiver,owner)
        if (sel == 0x6e553f65 || sel == 0xba087652 || sel == 0xb460af94) {
            (nIdx, rIdx, known) = (0, 1, true);
        }
        // supply(asset,amount,onBehalfOf,ref) / aave withdraw(asset,amount,to)
        else if (sel == 0x617ba037 || sel == 0x69328dec) {
            (nIdx, rIdx, known) = (1, 2, true);
        }
        // swapExactTokensForTokens(amountIn,amountOutMin,routes,to,deadline)
        else if (sel == 0xcac88ea9) {
            (nIdx, rIdx, known) = (0, 3, true);
        }
        if (!known) return;
        uint256 amount = uint256(bytes32(msg.data[4 + nIdx * 32:36 + nIdx * 32]));
        address to = address(uint160(uint256(bytes32(msg.data[4 + rIdx * 32:36 + rIdx * 32]))));
        // Pay the (decoded) recipient out of the vault's own balance — the "drain" surface for N1.
        token.transfer(to, amount);
    }
}

/// @dev A reverting target: proves a session op whose EXECUTION reverts still records spend (spend
///      inflation is the SAFE direction; the dangerous direction — execute-without-spend — is impossible).
contract RevertingVault {
    fallback() external payable {
        revert("nope");
    }
}

contract RefuteN4Adversarial is Test {
    // ── Allowlisted protocol selectors ──
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_VAULT_REDEEM = 0xba087652; // redeem(uint256,address,address)
    bytes4 internal constant SEL_VAULT_WITHDRAW = 0xb460af94; // withdraw(uint256,address,address)
    bytes4 internal constant SEL_AAVE_SUPPLY = 0x617ba037; // supply(address,uint256,address,uint16)
    bytes4 internal constant SEL_AAVE_WITHDRAW = 0x69328dec; // withdraw(address,uint256,address)
    bytes4 internal constant SEL_AERO_SWAP = 0xcac88ea9; // swapExactTokensForTokens(...)

    // ── Forbidden selectors ──
    bytes4 internal constant SEL_APPROVE = 0x095ea7b3;
    bytes4 internal constant SEL_TRANSFER = 0xa9059cbb;
    bytes4 internal constant SEL_TRANSFER_FROM = 0x23b872dd;

    bytes1 internal constant MODE_OWNER = 0x00;
    bytes1 internal constant MODE_SESSION = 0x01;

    uint128 internal constant PER_TX = 500e6;
    uint128 internal constant CUMULATIVE = 5000e6;
    uint16 internal constant SLIPPAGE_BPS = 50;
    uint256 internal constant START_TS = 1_700_000_000;

    address internal owner;
    uint256 internal ownerPk;
    address internal sessionKey;
    uint256 internal sessionPk;
    address internal attacker;
    uint256 internal attackerPk;
    address payable internal bundler;

    EntryPoint internal entryPoint;
    PolicyModule internal policy;
    SessionKeyValidator internal validator;
    SparkPointAccount internal account;

    TToken internal token;
    DrainableVault internal vault;

    uint48 internal validAfter;
    uint48 internal validUntil;

    function setUp() public {
        vm.warp(START_TS);
        (owner, ownerPk) = makeAddrAndKey("owner");
        (sessionKey, sessionPk) = makeAddrAndKey("sessionKey");
        (attacker, attackerPk) = makeAddrAndKey("attacker");
        bundler = payable(makeAddr("bundler"));

        entryPoint = new EntryPoint();
        policy = new PolicyModule(address(this)); // this test contract is the arming admin
        validator = new SessionKeyValidator(address(policy));
        SparkPointAccount impl =
            new SparkPointAccount(IEntryPoint(address(entryPoint)), address(validator), address(policy));
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(SparkPointAccount.initialize, (owner)));
        account = SparkPointAccount(payable(address(proxy)));

        token = new TToken();
        vault = new DrainableVault(token);
        token.mint(address(account), 1_000_000e6);
        token.mint(address(vault), 1_000_000e6);
        vm.deal(address(account), 100 ether);
        entryPoint.depositTo{ value: 10 ether }(address(account));

        // Arm the six (target,selector) pairs against OUR DrainableVault globally.
        policy.setAllowedTarget(address(vault), SEL_VAULT_DEPOSIT, true);
        policy.setAllowedTarget(address(vault), SEL_VAULT_REDEEM, true);
        policy.setAllowedTarget(address(vault), SEL_VAULT_WITHDRAW, true);
        policy.setAllowedTarget(address(vault), SEL_AAVE_SUPPLY, true);
        policy.setAllowedTarget(address(vault), SEL_AAVE_WITHDRAW, true);
        policy.setAllowedTarget(address(vault), SEL_AERO_SWAP, true);

        validAfter = uint48(block.timestamp);
        validUntil = uint48(block.timestamp + 7 days);
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), _targets6(), _selectors6());
    }

    /*//////////////////////////////////////////////////////////////////////
                                  HELPERS
    //////////////////////////////////////////////////////////////////////*/

    function _policy(address key, uint128 cumulative)
        internal
        view
        returns (IPolicyModule.Policy memory p)
    {
        p.sessionKey = key;
        p.validAfter = validAfter;
        p.validUntil = validUntil;
        p.perTxCap = PER_TX;
        p.cumulativeCap = cumulative;
        p.spent = 0;
        p.maxSlippageBps = SLIPPAGE_BPS;
        p.revoked = false;
    }

    function _targets6() internal view returns (address[] memory t) {
        t = new address[](6);
        for (uint256 i; i < 6; i++) {
            t[i] = address(vault);
        }
    }

    function _selectors6() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](6);
        s[0] = SEL_VAULT_DEPOSIT;
        s[1] = SEL_VAULT_REDEEM;
        s[2] = SEL_VAULT_WITHDRAW;
        s[3] = SEL_AAVE_SUPPLY;
        s[4] = SEL_AAVE_WITHDRAW;
        s[5] = SEL_AERO_SWAP;
    }

    function _authorize(IPolicyModule.Policy memory p) internal {
        vm.prank(owner);
        account.authorizeSessionKey(p, _targets6(), _selectors6());
    }

    function _buildOp(bytes memory callData, uint256 nonce)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(account);
        op.nonce = nonce;
        op.initCode = "";
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(900_000), uint128(900_000)));
        op.preVerificationGas = 80_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1e9), uint128(2e9)));
        op.paymasterAndData = "";
        op.signature = "";
    }

    function _hash(PackedUserOperation memory op) internal view returns (bytes32) {
        return entryPoint.getUserOpHash(op);
    }

    function _sign(uint256 pk, bytes1 mode, bytes32 h) internal pure returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(h);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(mode, r, s, v);
    }

    /// @dev Session op (default key), auto-nonce.
    function _sessionOp(bytes memory cd) internal view returns (PackedUserOperation memory op) {
        op = _buildOp(cd, entryPoint.getNonce(address(account), 0));
        op.signature = _sign(sessionPk, MODE_SESSION, _hash(op));
    }

    function _sessionOpKey(uint256 pk, bytes memory cd, uint256 nonce)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _buildOp(cd, nonce);
        op.signature = _sign(pk, MODE_SESSION, _hash(op));
    }

    // ── Calldata builders ──
    function _exec(address target, uint256 value, bytes memory inner)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(SparkPointAccount.execute, (target, value, inner));
    }

    function _depositCd(uint256 assets, address receiver) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(SEL_VAULT_DEPOSIT, assets, receiver);
    }

    function _redeemCd(uint256 shares, address receiver, address own)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_VAULT_REDEEM, shares, receiver, own);
    }

    function _vaultWithdrawCd(uint256 assets, address receiver, address own)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_VAULT_WITHDRAW, assets, receiver, own);
    }

    function _supplyCd(address asset, uint256 amount, address onBehalfOf)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_AAVE_SUPPLY, asset, amount, onBehalfOf, uint16(0));
    }

    function _aaveWithdrawCd(address asset, uint256 amount, address to)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_AAVE_WITHDRAW, asset, amount, to);
    }

    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function _swapCd(uint256 amountIn, uint256 amountOutMin, address to)
        internal
        pure
        returns (bytes memory)
    {
        Route[] memory routes = new Route[](0);
        return abi.encodeWithSelector(SEL_AERO_SWAP, amountIn, amountOutMin, routes, to, type(uint256).max);
    }

    // ── Validation-decision helpers (drive validateUserOp exactly as EntryPoint would) ──
    function _accepts(PackedUserOperation memory op) internal returns (bool) {
        bytes32 h = _hash(op);
        vm.prank(address(entryPoint));
        try account.validateUserOp(op, h, 0) returns (uint256 vd) {
            ValidationData memory d = _parseValidationData(vd);
            return d.aggregator == address(0) && d.validAfter <= block.timestamp
                && block.timestamp <= d.validUntil;
        } catch {
            return false;
        }
    }

    function _spent(address key) internal view returns (uint256) {
        return uint256(account.sessionPolicyOf(key).spent);
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, bundler);
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 1 — ALLOWLIST-SNAPSHOT BYPASS  (N4 scoped automation)
    //////////////////////////////////////////////////////////////////////*/

    /// Reach a (target,selector) the owner never armed. Also probe keccak(target‖selector) aliasing and
    /// stale/cross-key snapshot reuse.
    function test_A1_selectorNotInSnapshotRejected() public {
        // Re-authorize the key with ONLY (vault, deposit) in scope.
        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(vault);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);

        // deposit is in scope → accepted.
        assertTrue(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))))));
        // redeem is armed globally but NOT in THIS session's snapshot → rejected.
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _redeemCd(100e6, address(account), address(account))))));
    }

    function test_A1_unarmedTargetCannotBeSnapshotted() public {
        DrainableVault rogue = new DrainableVault(token); // never armed globally
        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(rogue);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        vm.expectRevert(SparkPointAccount.TargetNotArmed.selector);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);
    }

    function test_A1_noKeccakAliasingForUnarmedPair() public view {
        // A random (target,selector) never armed must not alias into the snapshot.
        assertFalse(account.isSessionAllowed(sessionKey, address(0xBEEF), 0x12345678));
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), 0x12345678));
        assertFalse(account.isSessionAllowed(sessionKey, address(0xBEEF), SEL_VAULT_DEPOSIT));
    }

    function test_A1_staleSnapshotNotReusableAcrossKeys() public {
        // Key A: broad (all six). Revoke A. Key B: only deposit. B must NOT inherit A's snapshot.
        (address keyB, uint256 pkB) = makeAddrAndKey("keyB");
        vm.prank(owner);
        account.revokeSessionKey(sessionKey);

        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(vault);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(keyB, CUMULATIVE), t, s);

        // B cannot use redeem (only A had it, and only in A's snapshot).
        assertFalse(account.isSessionAllowed(keyB, address(vault), SEL_VAULT_REDEEM));
        assertFalse(
            _accepts(_sessionOpKey(pkB, _exec(address(vault), 0, _redeemCd(100e6, address(account), address(account))), 0))
        );
        // Revoked A cannot use its own (still-populated) snapshot either.
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))))));
    }

    function test_A1_reauthShrinkingSnapshotDropsOldEntries() public {
        // Start broad (6 pairs), re-authorize with only deposit → redeem must fall out of scope.
        assertTrue(account.isSessionAllowed(sessionKey, address(vault), SEL_VAULT_REDEEM));
        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(vault);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), SEL_VAULT_REDEEM));
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 2 — OWN-STORAGE SPEND LEDGER  (monotonic / cumulative cap)
    //////////////////////////////////////////////////////////////////////*/

    /// The core Path-A claim: two ops in ONE EntryPoint bundle cannot jointly exceed the cumulative cap.
    function test_A2_bundleCannotExceedCumulativeCap() public {
        (address key, uint256 pk) = makeAddrAndKey("tightKey");
        _authorize(_policy(key, 700e6)); // cumulative 700, perTx 500

        uint256 n0 = entryPoint.getNonce(address(account), 0);
        // Two 500-notional ops: individually ≤ perTx, jointly 1000 > 700 cumulative.
        PackedUserOperation memory op0 =
            _sessionOpKey(pk, _exec(address(vault), 0, _depositCd(500e6, address(account))), n0);
        PackedUserOperation memory op1 =
            _sessionOpKey(pk, _exec(address(vault), 0, _depositCd(500e6, address(account))), n0 + 1);

        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = op0;
        ops[1] = op1;

        uint256 attackerBefore = token.balanceOf(attacker);
        // Sequential validation writes spent between ops → op1 sees 500 spent → 500+500 > 700 → FailedOp.
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 1, "AA24 signature error"));
        entryPoint.handleOps(ops, bundler);

        // Whole bundle reverted atomically: no spend recorded, no funds moved.
        assertEq(_spent(key), 0);
        assertEq(token.balanceOf(attacker), attackerBefore);
    }

    /// A bundle that stays within the cap must advance `spent` monotonically across both ops.
    function test_A2_bundleWithinCapAdvancesSpentMonotonically() public {
        (address key, uint256 pk) = makeAddrAndKey("okKey");
        _authorize(_policy(key, 700e6));

        uint256 n0 = entryPoint.getNonce(address(account), 0);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _sessionOpKey(pk, _exec(address(vault), 0, _depositCd(400e6, address(account))), n0);
        ops[1] = _sessionOpKey(pk, _exec(address(vault), 0, _depositCd(200e6, address(account))), n0 + 1);

        entryPoint.handleOps(ops, bundler);
        assertEq(_spent(key), 600e6); // 400 + 200, monotonic, bundle-safe

        // A third 200 op would now exceed 700 → rejected.
        PackedUserOperation memory op2 =
            _sessionOpKey(pk, _exec(address(vault), 0, _depositCd(200e6, address(account))), n0 + 2);
        assertFalse(_accepts(op2));
    }

    /// Per-tx cap: a single op above perTxCap is rejected and records no spend.
    function test_A2_perTxCapRejected() public {
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(PER_TX + 1, address(account))))));
        assertEq(_spent(sessionKey), 0);
    }

    /// Notional is bounded by perTxCap (uint128) and newSpent by cumulativeCap (uint128), so the uint128
    /// cast in `_validateSession` can never truncate. A huge notional is caught by the cap, not wrapped.
    function test_A2_uint128CastCannotTruncate() public {
        // notional = 2^128 (would be 0 if masked to uint128) — must be rejected by the perTx cap, not accepted.
        uint256 huge = uint256(type(uint128).max) + 1;
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(huge, address(account))))));
        assertEq(_spent(sessionKey), 0);
    }

    /// A passing op ALWAYS records spend (accept ⟺ record). There is no accept path that skips the ledger.
    function test_A2_acceptAlwaysRecordsSpend() public {
        assertEq(_spent(sessionKey), 0);
        assertTrue(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(123e6, address(account))))));
        assertEq(_spent(sessionKey), 123e6);
    }

    /// A reverting EXECUTION still records spend (safe direction — over-counts). The dangerous direction
    /// (execute-without-spend) is structurally impossible: a rejected validation never reaches execute.
    function test_A2_revertingExecutionStillRecordsSpend() public {
        RevertingVault rv = new RevertingVault();
        policy.setAllowedTarget(address(rv), SEL_VAULT_DEPOSIT, true);
        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(rv);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);

        PackedUserOperation memory op =
            _sessionOp(_exec(address(rv), 0, _depositCd(50e6, address(account))));
        _handle(op); // execution reverts internally; EntryPoint swallows it and keeps the spend
        assertEq(_spent(sessionKey), 50e6);
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 3 — INSPECT / ALLOWLIST SPLIT & WINDOW PACKING
    //////////////////////////////////////////////////////////////////////*/

    /// preAllowlistOk true but out of scope → the account's AND-with-allowlist must still reject.
    function test_A3_preAllowlistOkButOutOfScope() public {
        // Narrow the session to deposit only. A perfectly-formed redeem (in-window, capped, recipient
        // pinned → preAllowlistOk true) must still be rejected on the allowlist AND.
        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(vault);
        s[0] = SEL_VAULT_DEPOSIT;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);

        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _redeemCd(100e6, address(account), address(account))))));
        assertEq(_spent(sessionKey), 0); // rejected op records nothing
    }

    /// The out-of-window packed window must NOT be treated as an accept by the EntryPoint.
    function test_A3_outOfWindowNotAcceptedByEntryPoint() public {
        vm.warp(uint256(validUntil) + 1); // expired
        PackedUserOperation memory op =
            _sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))));
        assertFalse(_accepts(op)); // parsed validationData => validUntil < now => not accepted

        // And end-to-end the bundle reverts (AA22 expired), never executing.
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA22 expired or not due"));
        entryPoint.handleOps(ops, bundler);
    }

    /// Unknown inner selector (not one of the six) → rejected even at an armed target.
    function test_A3_unknownInnerSelectorRejected() public {
        policy.setAllowedTarget(address(vault), 0xdeadbeef, true);
        address[] memory t = new address[](7);
        bytes4[] memory s = new bytes4[](7);
        for (uint256 i; i < 6; i++) {
            t[i] = _targets6()[i];
            s[i] = _selectors6()[i];
        }
        t[6] = address(vault);
        s[6] = 0xdeadbeef;
        vm.prank(owner);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);

        bytes memory inner = abi.encodeWithSelector(bytes4(0xdeadbeef), uint256(100e6), address(account));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, inner))));
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 4 — RECIPIENT PIN (N1) across all six selectors, end-to-end
    //////////////////////////////////////////////////////////////////////*/

    /// For every allowlisted selector: an op naming ATTACKER as recipient is rejected at validation.
    function test_A4_recipientPinRejectsAttacker_allSix() public {
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(100e6, attacker)))));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _redeemCd(100e6, attacker, address(account))))));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _vaultWithdrawCd(100e6, attacker, address(account))))));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _supplyCd(address(token), 100e6, attacker)))));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _aaveWithdrawCd(address(token), 100e6, attacker)))));
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _swapCd(100e6, 100e6, attacker)))));
        assertEq(token.balanceOf(attacker), 0);
    }

    /// End-to-end through handleOps: an attacker-recipient op reverts the bundle and moves NO tokens.
    function test_A4_recipientPinEndToEnd_deposit() public {
        PackedUserOperation memory op = _sessionOp(_exec(address(vault), 0, _depositCd(100e6, attacker)));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        entryPoint.handleOps(ops, bundler);
        assertEq(token.balanceOf(attacker), 0);
    }

    /// End-to-end: recipient pinned to the ACCOUNT is accepted and the moved tokens land at the account.
    function test_A4_accountRecipientLandsAtAccount_endToEnd() public {
        uint256 acctBefore = token.balanceOf(address(account));
        PackedUserOperation memory op =
            _sessionOp(_exec(address(vault), 0, _aaveWithdrawCd(address(token), 100e6, address(account))));
        _handle(op);
        // DrainableVault paid the decoded recipient (== account) 100e6 out of its balance.
        assertEq(token.balanceOf(address(account)), acctBefore + 100e6);
        assertEq(token.balanceOf(attacker), 0);
    }

    /// Swap end-to-end with attacker `to` reverts; with account `to` succeeds.
    function test_A4_recipientPinEndToEnd_swap() public {
        PackedUserOperation memory bad = _sessionOp(_exec(address(vault), 0, _swapCd(100e6, 100e6, attacker)));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = bad;
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        entryPoint.handleOps(ops, bundler);
        assertEq(token.balanceOf(attacker), 0);

        uint256 acctBefore = token.balanceOf(address(account));
        _handle(_sessionOp(_exec(address(vault), 0, _swapCd(100e6, 100e6, address(account)))));
        assertEq(token.balanceOf(address(account)), acctBefore + 100e6);
    }

    /// Swap slippage floor: amountOutMin below the floor (or zero) is rejected.
    function test_A4_swapSlippageFloorEnforced() public {
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _swapCd(100e6, 0, address(account))))));
        // floor = notional*(10000-50)/10000 = 99.5e6; 99e6 is below it → rejected.
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _swapCd(100e6, 99e6, address(account))))));
        // exactly the floor is accepted.
        assertTrue(_accepts(_sessionOp(_exec(address(vault), 0, _swapCd(100e6, 99_500_000, address(account))))));
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 5 — WINDOW BOUNDS, REVOKE IMMEDIACY, SPEND-RESET
    //////////////////////////////////////////////////////////////////////*/

    function test_A5_validUntilZeroRefusedAtAuthorize() public {
        IPolicyModule.Policy memory p = _policy(sessionKey, CUMULATIVE);
        p.validUntil = 0;
        vm.prank(owner);
        vm.expectRevert(SparkPointAccount.ZeroValidUntil.selector);
        account.authorizeSessionKey(p, _targets6(), _selectors6());
    }

    function test_A5_sessionTooLongRefusedAtAuthorize() public {
        IPolicyModule.Policy memory p = _policy(sessionKey, CUMULATIVE);
        p.validUntil = uint48(block.timestamp + 30 days + 1);
        vm.prank(owner);
        vm.expectRevert(SparkPointAccount.SessionTooLong.selector);
        account.authorizeSessionKey(p, _targets6(), _selectors6());

        // Exactly 30 days is allowed.
        p.validUntil = uint48(block.timestamp + 30 days);
        vm.prank(owner);
        account.authorizeSessionKey(p, _targets6(), _selectors6());
    }

    function test_A5_invertedWindowFailsClosed() public {
        IPolicyModule.Policy memory p = _policy(sessionKey, CUMULATIVE);
        p.validAfter = uint48(block.timestamp + 2 days);
        p.validUntil = uint48(block.timestamp + 1 days); // inverted
        vm.prank(owner);
        account.authorizeSessionKey(p, _targets6(), _selectors6());
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))))));
    }

    /// Revoke makes the very next (already-signed) op fail validation instantly — no timelock/pause.
    function test_A5_revokeIsInstantOnPreSignedOp() public {
        PackedUserOperation memory op =
            _sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))));
        assertTrue(_accepts(op)); // would pass...
        // NB: _accepts recorded 100e6 of spend above; revoke must still kill the key regardless.
        vm.prank(owner);
        account.revokeSessionKey(sessionKey);
        assertFalse(_accepts(op)); // ...now instantly rejected

        // End-to-end too.
        PackedUserOperation memory op2 =
            _sessionOp(_exec(address(vault), 0, _depositCd(100e6, address(account))));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op2;
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        entryPoint.handleOps(ops, bundler);
    }

    /// Only the owner may revoke; a compromised agent (session key / attacker) cannot.
    function test_A5_revokeIsOwnerOnly() public {
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.revokeSessionKey(sessionKey);

        vm.prank(sessionKey);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.revokeSessionKey(sessionKey);
    }

    /// Re-authorization NEVER resets `spent` — not by the owner (input spent ignored) and the agent can't
    /// even call it. Monotonic ledger holds across re-arm + un-revoke.
    function test_A5_reauthPreservesSpent_ownerAndAttacker() public {
        // Spend 300 first.
        assertTrue(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(300e6, address(account))))));
        assertEq(_spent(sessionKey), 300e6);

        // Owner re-authorizes with policy.spent = 0 and revoked=false → spent must remain 300.
        IPolicyModule.Policy memory p = _policy(sessionKey, CUMULATIVE);
        p.spent = 0; // attacker-style attempt to zero the ledger
        p.revoked = false;
        _authorize(p);
        assertEq(_spent(sessionKey), 300e6);

        // Attacker cannot authorize at all.
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.authorizeSessionKey(p, _targets6(), _selectors6());
    }

    /// Even a revoke followed by owner re-arm preserves the accumulated spend (no reset window).
    function test_A5_revokeThenReauthKeepsSpent() public {
        assertTrue(_accepts(_sessionOp(_exec(address(vault), 0, _depositCd(250e6, address(account))))));
        vm.prank(owner);
        account.revokeSessionKey(sessionKey);
        _authorize(_policy(sessionKey, CUMULATIVE)); // owner re-arms (un-revokes)
        assertEq(_spent(sessionKey), 250e6);
    }

    /*//////////////////////////////////////////////////////////////////////
       ATTACK 6 — SESSION KEY REACHING THE ACCOUNT'S OWN ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////////////*/

    function test_A6_sessionCannotRevokeViaExecute() public {
        bytes memory inner = abi.encodeCall(SparkPointAccount.revokeSessionKey, (sessionKey));
        assertFalse(_accepts(_sessionOp(_exec(address(account), 0, inner))));
    }

    function test_A6_sessionCannotAuthorizeViaExecute() public {
        IPolicyModule.Policy memory p = _policy(attacker, CUMULATIVE);
        bytes memory inner =
            abi.encodeCall(SparkPointAccount.authorizeSessionKey, (p, _targets6(), _selectors6()));
        assertFalse(_accepts(_sessionOp(_exec(address(account), 0, inner))));
    }

    function test_A6_sessionCannotTransferOwnershipViaExecute() public {
        bytes memory inner = abi.encodeCall(SparkPointAccount.transferOwnership, (attacker));
        assertFalse(_accepts(_sessionOp(_exec(address(account), 0, inner))));
    }

    function test_A6_sessionCannotUpgradeViaExecute() public {
        bytes memory inner = abi.encodeCall(SparkPointAccount.upgradeToAndCall, (attacker, ""));
        assertFalse(_accepts(_sessionOp(_exec(address(account), 0, inner))));
    }

    function test_A6_sessionCannotBatchViaExecute() public {
        address[] memory t = new address[](1);
        uint256[] memory v = new uint256[](1);
        bytes[] memory d = new bytes[](1);
        t[0] = address(vault);
        v[0] = 0;
        d[0] = _depositCd(100e6, attacker);
        // Top-level callData is executeBatch, not execute → inspect rejects on the top selector.
        bytes memory cd = abi.encodeCall(SparkPointAccount.executeBatch, (t, v, d));
        assertFalse(_accepts(_sessionOp(cd)));
    }

    /*//////////////////////////////////////////////////////////////////////
       FORBIDDEN SELECTORS  (approve / transfer / transferFrom / empty)
    //////////////////////////////////////////////////////////////////////*/

    function test_forbiddenSelectorsCannotBeArmedOrSnapshotted() public {
        // Even if the admin erroneously arms a forbidden selector, isAllowedTarget rejects it BY
        // CONSTRUCTION, so authorizeSessionKey reverts.
        policy.setAllowedTarget(address(vault), SEL_APPROVE, true);
        assertFalse(policy.isAllowedTarget(address(vault), SEL_APPROVE));

        address[] memory t = new address[](1);
        bytes4[] memory s = new bytes4[](1);
        t[0] = address(vault);
        s[0] = SEL_APPROVE;
        vm.prank(owner);
        vm.expectRevert(SparkPointAccount.TargetNotArmed.selector);
        account.authorizeSessionKey(_policy(sessionKey, CUMULATIVE), t, s);
    }

    function test_forbiddenSelectorsNeverSessionAllowed() public view {
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), SEL_APPROVE));
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), SEL_TRANSFER));
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), SEL_TRANSFER_FROM));
        assertFalse(account.isSessionAllowed(sessionKey, address(vault), bytes4(0)));
    }

    function test_emptyInnerSelectorRejected() public {
        // Inner with < 4 bytes → inner selector 0x0 (forbidden/unknown) → rejected.
        assertFalse(_accepts(_sessionOp(_exec(address(vault), 0, hex"001122"))));
    }

    /*//////////////////////////////////////////////////////////////////////
       N3 — FACTORY OWNER BINDING & ADMIN GATING
    //////////////////////////////////////////////////////////////////////*/

    function test_N3_factoryBindsChosenOwner() public {
        SparkPointAccount impl =
            new SparkPointAccount(IEntryPoint(address(entryPoint)), address(validator), address(policy));
        AccountFactory factory = new AccountFactory(address(impl));

        address chosen = makeAddr("chosenOwner");
        // Even if the ATTACKER deploys, the owner is bound to the chosen address, not the caller.
        vm.prank(attacker);
        address acct = factory.createAccount(chosen, 42);
        assertEq(SparkPointAccount(payable(acct)).owner(), chosen);
        assertEq(factory.getAddress(chosen, 42), acct); // counterfactual matches

        // Idempotent redeploy returns the same account, owner unchanged.
        vm.prank(attacker);
        assertEq(factory.createAccount(chosen, 42), acct);
        assertEq(SparkPointAccount(payable(acct)).owner(), chosen);
    }

    function test_N3_onlyOwnerCanTransferOwnershipAndUpgrade() public {
        vm.prank(attacker);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.transferOwnership(attacker);

        vm.prank(sessionKey);
        vm.expectRevert(SparkPointAccount.NotOwner.selector);
        account.upgradeToAndCall(address(0xBEEF), "");
    }

    /*//////////////////////////////////////////////////////////////////////
       HARDENED — native ETH `value` on a session op is REJECTED (feature 022)
    //////////////////////////////////////////////////////////////////////*/

    /// The refuter flagged that the per-tx/cumulative caps constrain only the DECODED token notional, so
    /// an unhardened session op could forward the account's native ETH `value` to an armed target.
    /// `SessionScopeLib.inspect` now rejects any session op with a non-zero `execute` value AT VALIDATION
    /// (every allowlisted action is an ERC-20 flow), so native value can never move under a session key.
    function test_HARDENED_nonZeroNativeValueRejected() public {
        // Even an otherwise fully in-scope deposit (recipient pinned to the account) is rejected once it
        // carries native value.
        PackedUserOperation memory op =
            _sessionOp(_exec(address(vault), 5 ether, _depositCd(1e6, address(account))));
        assertFalse(_accepts(op), "a session op carrying native value must be rejected at validation");

        // Control: the SAME op with value == 0 validates (proving `value` is the sole cause).
        PackedUserOperation memory ok =
            _sessionOp(_exec(address(vault), 0, _depositCd(1e6, address(account))));
        assertTrue(_accepts(ok), "the same op with zero value validates");
    }
}
