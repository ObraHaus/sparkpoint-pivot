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
import { IPolicyModule } from "../../../src/interfaces/IPolicyModule.sol";
import { MockProtocol } from "../mocks/MockProtocol.sol";
import { MockERC20 } from "../../mocks/Mocks.sol";

/// @title AccountTestBase — the ERC-4337 v0.7 harness shared by every W6-US2 account suite.
/// @notice Deploys a REAL EntryPoint v0.7 (lib/account-abstraction) + PolicyModule + SessionKeyValidator
///         + a SparkPointAccount behind an ERC1967 proxy (owner-bound at init), three fake protocol
///         targets exposing the allowlisted selectors, and a MockERC20 USDC funding the account.
///
/// 4337 signing scheme (the harness contract the GREEN account/validator MUST match):
///   Every UserOp signature is 66 bytes: `mode(1) || r(32) || s(32) || v(1)`.
///     - mode 0x00 = OWNER  → account recovers ECDSA over EIP-191(userOpHash) and checks == owner().
///     - mode 0x01 = SESSION→ account delegates to SessionKeyValidator, which recovers the session
///                   signer from signature[1:] over EIP-191(userOpHash) and runs the §4 scope flow.
///   Digest = MessageHashUtils.toEthSignedMessageHash(entryPoint.getUserOpHash(op)).
///
/// Scope suites drive `validateUserOp` DIRECTLY (pranked as the EntryPoint) and read the packed
/// validationData — the §4 scope checks live inside validation, so this is faster + deterministic than
/// a full handleOps round-trip (which the fork integration test exercises instead).
abstract contract AccountTestBase is Test {
    // ── Session bounds (constants.ts / T098, USDC 6dp) ──
    uint128 internal constant SESSION_PER_TX = 500e6; // 500 USDC
    uint128 internal constant SESSION_CUMULATIVE = 5000e6; // 5,000 USDC
    uint16 internal constant SESSION_MAX_SLIPPAGE_BPS = 50;

    // ── Allowlisted selectors (constants.ts §3; verified with `cast sig`) ──
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_VAULT_REDEEM = 0xba087652; // redeem(uint256,address,address)
    bytes4 internal constant SEL_VAULT_WITHDRAW = 0xb460af94; // withdraw(uint256,address,address)
    bytes4 internal constant SEL_AAVE_SUPPLY = 0x617ba037; // supply(address,uint256,address,uint16)
    bytes4 internal constant SEL_AAVE_WITHDRAW = 0x69328dec; // withdraw(address,uint256,address)
    bytes4 internal constant SEL_AERO_SWAP = 0xcac88ea9; // swapExactTokensForTokens(...)

    // ── FORBIDDEN selectors (constants.ts §6 — must NEVER be allowlisted) ──
    bytes4 internal constant SEL_APPROVE = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant SEL_TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant SEL_TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    bytes4 internal constant SEL_EMPTY = 0x00000000; // arbitrary/empty-calldata call

    bytes1 internal constant MODE_OWNER = 0x00;
    bytes1 internal constant MODE_SESSION = 0x01;

    // ── Actors ──
    address internal owner;
    uint256 internal ownerPk;
    address internal sessionKey;
    uint256 internal sessionPk;
    address internal attacker;
    uint256 internal attackerPk;
    address internal sparkpoint = makeAddr("sparkpoint"); // the address funds must NEVER reach (N1)

    // ── System under test ──
    EntryPoint internal entryPoint;
    PolicyModule internal policy;
    SessionKeyValidator internal validator;
    SparkPointAccount internal accountImpl;
    SparkPointAccount internal account; // the proxy, typed as the account

    // ── Fake protocol targets exposing the allowlisted selectors ──
    MockProtocol internal vault;
    MockProtocol internal aavePool;
    MockProtocol internal router;
    MockERC20 internal usdc;

    uint48 internal validAfter;
    uint48 internal validUntil;

    /// @dev A realistic base unix timestamp so windows can be positioned in the past AND future.
    uint256 internal constant START_TS = 1_700_000_000;

    function _deployAccountStack() internal {
        vm.warp(START_TS);
        (owner, ownerPk) = makeAddrAndKey("owner");
        (sessionKey, sessionPk) = makeAddrAndKey("sessionKey");
        (attacker, attackerPk) = makeAddrAndKey("attacker");

        entryPoint = new EntryPoint();
        policy = new PolicyModule(address(this));
        validator = new SessionKeyValidator(address(policy));
        policy.setSessionValidator(address(validator));

        accountImpl = new SparkPointAccount(
            IEntryPoint(address(entryPoint)), address(validator), address(policy)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(accountImpl), abi.encodeCall(SparkPointAccount.initialize, (owner))
        );
        account = SparkPointAccount(payable(address(proxy)));

        vault = new MockProtocol();
        aavePool = new MockProtocol();
        router = new MockProtocol();
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Seed the GLOBAL protocol allowlist with EXACTLY the six (target,selector) pairs (G5).
        policy.setAllowedTarget(address(vault), SEL_VAULT_DEPOSIT, true);
        policy.setAllowedTarget(address(vault), SEL_VAULT_REDEEM, true);
        policy.setAllowedTarget(address(vault), SEL_VAULT_WITHDRAW, true);
        policy.setAllowedTarget(address(aavePool), SEL_AAVE_SUPPLY, true);
        policy.setAllowedTarget(address(aavePool), SEL_AAVE_WITHDRAW, true);
        policy.setAllowedTarget(address(router), SEL_AERO_SWAP, true);

        // Fund the account (drain surface for N1) + gas.
        usdc.mint(address(account), 1_000_000e6);
        vm.deal(address(account), 100 ether);

        // Owner authorizes ONE session key with the standard bounds (single-agent-key model).
        validAfter = uint48(block.timestamp);
        validUntil = uint48(block.timestamp + 7 days);
        vm.prank(owner);
        account.authorizeSessionKey(_defaultPolicy());
    }

    function _defaultPolicy() internal view returns (IPolicyModule.Policy memory p) {
        p.sessionKey = sessionKey;
        p.validAfter = validAfter;
        p.validUntil = validUntil;
        p.perTxCap = SESSION_PER_TX;
        p.cumulativeCap = SESSION_CUMULATIVE;
        p.spent = 0;
        p.maxSlippageBps = SESSION_MAX_SLIPPAGE_BPS;
        p.revoked = false;
    }

    // ── UserOp construction / signing ──

    function _buildUserOp(bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(account);
        op.nonce = entryPoint.getNonce(address(account), 0);
        op.initCode = "";
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(600_000), uint128(600_000)));
        op.preVerificationGas = 60_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1e9), uint128(2e9)));
        op.paymasterAndData = "";
        op.signature = "";
    }

    function _userOpHash(PackedUserOperation memory op) internal view returns (bytes32) {
        return entryPoint.getUserOpHash(op);
    }

    function _sign(uint256 pk, bytes1 mode, bytes32 userOpHash)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(mode, r, s, v);
    }

    /// @notice Build + owner-sign a UserOp for the given account callData.
    function _ownerOp(bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = _buildUserOp(callData);
        op.signature = _sign(ownerPk, MODE_OWNER, _userOpHash(op));
    }

    /// @notice Build + session-sign a UserOp for the given account callData (default session key).
    function _sessionOp(bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _buildUserOp(callData);
        op.signature = _sign(sessionPk, MODE_SESSION, _userOpHash(op));
    }

    /// @notice Build + session-sign with an ARBITRARY session private key (for expired/revoked keys).
    function _sessionOpWith(uint256 pk, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _buildUserOp(callData);
        op.signature = _sign(pk, MODE_SESSION, _userOpHash(op));
    }

    // ── Calldata builders ──

    /// @notice account.execute(target, value, inner) — the outer callData EntryPoint invokes.
    function _execCd(address target, uint256 value, bytes memory inner)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(SparkPointAccount.execute, (target, value, inner));
    }

    function _vaultDepositCd(uint256 assets, address receiver)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_VAULT_DEPOSIT, assets, receiver);
    }

    function _vaultRedeemCd(uint256 shares, address receiver, address owner_)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_VAULT_REDEEM, shares, receiver, owner_);
    }

    function _aaveSupplyCd(address asset, uint256 amount, address onBehalfOf)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(SEL_AAVE_SUPPLY, asset, amount, onBehalfOf, uint16(0));
    }

    // ── Validation-decision helper ──

    /// @notice Drive validation exactly as the EntryPoint does and report whether the op is ACCEPTED
    ///         (authorizer == 0 AND currently within [validAfter, validUntil]). A GREEN account/validator
    ///         REJECTS an out-of-scope op (authorizer==1) or packs an expiry the EntryPoint would reject.
    function _accountAccepts(PackedUserOperation memory op) internal returns (bool) {
        bytes32 h = _userOpHash(op);
        vm.prank(address(entryPoint));
        try account.validateUserOp(op, h, 0) returns (uint256 vd) {
            return _validationAccepts(vd);
        } catch {
            return false; // a revert in validation is a rejection
        }
    }

    function _validatorAccepts(PackedUserOperation memory op) internal returns (bool) {
        bytes32 h = _userOpHash(op);
        try validator.validateUserOp(op, h) returns (uint256 vd) {
            return _validationAccepts(vd);
        } catch {
            return false;
        }
    }

    function _validationAccepts(uint256 vd) internal view returns (bool) {
        ValidationData memory d = _parseValidationData(vd);
        return d.aggregator == address(0) && d.validAfter <= block.timestamp
            && block.timestamp <= d.validUntil;
    }
}
