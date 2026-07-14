// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { _packValidationData } from "@account-abstraction/core/Helpers.sol";

import { ISessionKeyValidator } from "../interfaces/ISessionKeyValidator.sol";
import { IPolicyModule } from "../interfaces/IPolicyModule.sol";
import { PolicyModule } from "./PolicyModule.sol";

/// @title SessionKeyValidator — ERC-4337 validator module (smart-contracts.md §4; N4).
/// @notice Validates UserOps signed by a session key, delegating scope to PolicyModule. A session key
///         has ZERO standing authority: every check is deterministic on-chain code, so a compromised
///         agent holding the session private key can only churn IN SCOPE and can NEVER name an
///         external/SparkPoint recipient or exceed the caps/slippage/expiry. Reads live storage, so a
///         revocation takes effect on the very next UserOp.
/// @dev The §4 six-step flow, run over account-associated PolicyModule storage (bundler-compliant):
///   1. Recover the signer; require it is a registered, non-revoked sessionKey for `userOp.sender`.
///   2. If `block.timestamp ∉ [validAfter, validUntil]` pack the expiry → EntryPoint rejects (no spend).
///   3. Decode `execute(target,value,inner)`; require the (target, inner-selector) pair is allowlisted.
///   4. Extract the notional; require `notional ≤ perTxCap` AND `spent + notional ≤ cumulativeCap`.
///   5. Swaps: require `amountOutMin ≥ slippage-floor(maxSlippageBps)` and `amountOutMin > 0`.
///   6. Force the decoded recipient/`to`/`onBehalfOf` == the account (N1) — else reject.
///   Only after ALL of 3–6 pass does it record `spent += notional` (monotonic) and pack the window as
///   the success authorizer.
contract SessionKeyValidator is ISessionKeyValidator {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /// @notice Signature prefix byte marking a session-key (vs owner) UserOp signature.
    bytes1 public constant SESSION_PREFIX = 0x01;

    /// @notice `SparkPointAccount.execute(address,uint256,bytes)` — verified with `cast sig`. A session
    ///         UserOp's callData MUST be a single `execute`; batches/other selectors are rejected so a
    ///         compromised key can never smuggle an out-of-scope (e.g. approve) call.
    bytes4 internal constant EXECUTE_SELECTOR = 0xb61d27f6;

    // ── Allowlisted protocol selectors (constants.ts §3) ──
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_VAULT_REDEEM = 0xba087652; // redeem(uint256,address,address)
    bytes4 internal constant SEL_VAULT_WITHDRAW = 0xb460af94; // withdraw(uint256,address,address)
    bytes4 internal constant SEL_AAVE_SUPPLY = 0x617ba037; // supply(address,uint256,address,uint16)
    bytes4 internal constant SEL_AAVE_WITHDRAW = 0x69328dec; // withdraw(address,uint256,address)
    bytes4 internal constant SEL_AERO_SWAP = 0xcac88ea9; // swapExactTokensForTokens(...)

    /// @dev Typed as the concrete PolicyModule (not the read-only IPolicyModule) because the validator
    ///      is the sole authorized caller of `recordSpend` (the monotonic G2 spend ledger).
    PolicyModule public immutable policyModule;

    constructor(address policyModule_) {
        policyModule = PolicyModule(policyModule_);
    }

    /// @inheritdoc ISessionKeyValidator
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        returns (uint256 validationData)
    {
        address account = userOp.sender;

        // 1 ── Recover signer; require a registered, non-revoked session key on THIS account.
        address signer = _recoverSigner(userOp.signature, userOpHash);
        if (signer == address(0)) return SIG_VALIDATION_FAILED;
        IPolicyModule.Policy memory p = policyModule.policyOf(account, signer);
        if (p.sessionKey != signer || p.revoked) return SIG_VALIDATION_FAILED;

        // 2 ── Hard window. `validUntil == 0` is the "infinite session" sentinel that EntryPoint's
        //      _parseValidationData rewrites to type(uint48).max — reject it OUTRIGHT so it can never be
        //      packed into an accept AND can never skip the scope checks below (N4; refuter-hardened —
        //      it must also be unreachable via arming, see PolicyModule.registerSession). Out-of-window ⇒
        //      pack the (non-zero) expiry so EntryPoint rejects it; DO NOT record spend.
        if (p.validUntil == 0) return SIG_VALIDATION_FAILED;
        if (block.timestamp < p.validAfter || block.timestamp > p.validUntil) {
            return _packValidationData(false, p.validUntil, p.validAfter);
        }

        // 3 ── The callData must be a single execute(target,value,inner) to an allowlisted (target,selector).
        if (_selectorOfCalldata(userOp.callData) != EXECUTE_SELECTOR) return SIG_VALIDATION_FAILED;
        (address target,, bytes memory inner) =
            abi.decode(userOp.callData[4:], (address, uint256, bytes));
        bytes4 selector = _selectorOfMemory(inner);
        if (!policyModule.isAllowedTarget(target, selector)) return SIG_VALIDATION_FAILED;

        (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known) =
            _decodeAction(selector, inner);
        if (!known) return SIG_VALIDATION_FAILED;

        // 4 ── Per-tx + cumulative caps.
        if (notional > p.perTxCap) return SIG_VALIDATION_FAILED;
        if (uint256(p.spent) + notional > p.cumulativeCap) return SIG_VALIDATION_FAILED;

        // 5 ── Slippage floor (swaps only).
        if (isSwap) {
            uint256 minOut = (notional * (10_000 - p.maxSlippageBps)) / 10_000;
            if (amountOutMin == 0 || amountOutMin < minOut) return SIG_VALIDATION_FAILED;
        }

        // 6 ── Recipient pin (N1): funds can only ever land back in the account itself.
        if (recipient != account) return SIG_VALIDATION_FAILED;

        // All checks passed — record monotonic spend, then pack the window as the success authorizer.
        policyModule.recordSpend(account, signer, notional);
        return _packValidationData(false, p.validUntil, p.validAfter);
    }

    /// @inheritdoc ISessionKeyValidator
    function isActive(address account, address sessionKey) external view returns (bool) {
        IPolicyModule.Policy memory p = policyModule.policyOf(account, sessionKey);
        return p.sessionKey == sessionKey && !p.revoked && block.timestamp >= p.validAfter
            && block.timestamp <= p.validUntil;
    }

    // ── Signature recovery ──

    /// @dev Recover the session signer from the 66-byte `mode(1) || r(32) || s(32) || v(1)` signature
    ///      over `EIP-191(userOpHash)`. Returns address(0) on any malformed/invalid signature.
    function _recoverSigner(bytes calldata sig, bytes32 userOpHash)
        internal
        pure
        returns (address)
    {
        if (sig.length != 66) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(add(sig.offset, 1))
            s := calldataload(add(sig.offset, 33))
            v := byte(0, calldataload(add(sig.offset, 65)))
        }
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v, r, s);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return signer;
    }

    // ── Calldata decode (kept identical to PolicyModule BY CONSTRUCTION) ──

    function _decodeAction(bytes4 selector, bytes memory data)
        internal
        pure
        returns (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known)
    {
        if (
            selector == SEL_VAULT_DEPOSIT || selector == SEL_VAULT_REDEEM
                || selector == SEL_VAULT_WITHDRAW
        ) {
            notional = _argWord(data, 0);
            recipient = address(uint160(_argWord(data, 1)));
            known = true;
        } else if (selector == SEL_AAVE_SUPPLY) {
            notional = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 2)));
            known = true;
        } else if (selector == SEL_AAVE_WITHDRAW) {
            notional = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 2)));
            known = true;
        } else if (selector == SEL_AERO_SWAP) {
            notional = _argWord(data, 0);
            amountOutMin = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 3)));
            isSwap = true;
            known = true;
        }
    }

    function _selectorOfCalldata(bytes calldata cd) internal pure returns (bytes4) {
        if (cd.length < 4) return bytes4(0);
        uint256 w;
        assembly {
            w := calldataload(cd.offset)
        }
        return bytes4(bytes32(w));
    }

    function _selectorOfMemory(bytes memory data) internal pure returns (bytes4) {
        if (data.length < 4) return bytes4(0);
        uint256 w;
        assembly {
            w := mload(add(data, 0x20))
        }
        return bytes4(bytes32(w));
    }

    function _argWord(bytes memory data, uint256 index) internal pure returns (uint256 w) {
        uint256 off = 4 + index * 32;
        require(data.length >= off + 32, "SessionKeyValidator: short calldata");
        assembly {
            w := mload(add(add(data, 0x20), off))
        }
    }
}
