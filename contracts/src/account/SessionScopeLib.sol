// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import { IPolicyModule } from "../interfaces/IPolicyModule.sol";

/// @title SessionScopeLib — the single source of truth for session-key scope decoding + math (N4).
/// @notice Pure, storage-free helpers shared by SparkPointAccount (the authoritative on-chain
///         validator), SessionKeyValidator (the parity mirror), and PolicyModule (the off-chain/Trust
///         Center parity view). Centralising the calldata decode + slippage/cap math here means the
///         three consumers can NEVER drift (previously they carried duplicated `_decodeAction`/`_argWord`
///         copies "kept identical BY CONSTRUCTION"). All functions are `internal pure` so they are
///         INLINED into each caller's bytecode — no external call, no storage access — which is exactly
///         what lets `SparkPointAccount.validateUserOp` stay within the ERC-7562/bundler storage rules
///         (it reads/writes ONLY its own storage; the scope math is inlined pure code).
/// @dev The (target,selector) allowlist is NOT decided here — the caller supplies `targetAllowed`
///      (the account reads its own per-session snapshot; the mirror is handed the arming set). This
///      keeps the ONE place that decodes calldata free of any storage dependency.
library SessionScopeLib {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;

    /// @dev Signature layout marking a session-key UserOp: `mode(1) || r(32) || s(32) || v(1)` = 66 bytes.
    bytes1 internal constant MODE_SESSION = 0x01;

    /// @notice `SparkPointAccount.execute(address,uint256,bytes)` — a session UserOp's callData MUST be a
    ///         single `execute`; batches/other selectors are rejected so a compromised key can never
    ///         smuggle an out-of-scope (e.g. approve) call.
    bytes4 internal constant EXECUTE_SELECTOR = 0xb61d27f6;

    // ── Allowlisted protocol selectors (constants.ts §3; verified with `cast sig`) ──
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_VAULT_REDEEM = 0xba087652; // redeem(uint256,address,address)
    bytes4 internal constant SEL_VAULT_WITHDRAW = 0xb460af94; // withdraw(uint256,address,address)
    bytes4 internal constant SEL_AAVE_SUPPLY = 0x617ba037; // supply(address,uint256,address,uint16)
    bytes4 internal constant SEL_AAVE_WITHDRAW = 0x69328dec; // withdraw(address,uint256,address)
    bytes4 internal constant SEL_AERO_SWAP = 0xcac88ea9; // swapExactTokensForTokens(...)

    // ── FORBIDDEN selectors (constants.ts §6) — never allowlisted at ANY target (G5) ──
    bytes4 internal constant SEL_APPROVE = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant SEL_TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant SEL_TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    bytes4 internal constant SEL_EMPTY = 0x00000000; // arbitrary / empty-calldata call

    /// @notice The outcome of decoding + scoring a session UserOp against a policy, EXCLUDING the
    ///         (target,selector) allowlist gate (which the caller applies from its own source) and
    ///         EXCLUDING the `spent += notional` write (which only the account may do, to its own storage).
    /// @param preAllowlistOk true iff signer/registration/window/caps/slippage/recipient ALL pass — the
    ///        caller must still AND this with its allowlist membership before accepting.
    /// @param validationData the packed authorizer|validUntil|validAfter the caller returns on accept
    ///        (or the out-of-window pack the EntryPoint rejects); SIG_VALIDATION_FAILED on a hard fail.
    /// @param notional the tx notional to add to `spent` iff the caller accepts.
    /// @param target the decoded inner call target (for the allowlist lookup).
    /// @param innerSelector the decoded inner selector (for the allowlist lookup).
    struct Scope {
        bool preAllowlistOk;
        uint256 validationData;
        uint256 notional;
        address target;
        bytes4 innerSelector;
    }

    /// @notice Recover the session signer from `mode(1)||r(32)||s(32)||v(1)` over `EIP-191(userOpHash)`.
    ///         Returns address(0) on any malformed/invalid signature or a non-session mode byte.
    function recoverSessionSigner(bytes calldata sig, bytes32 userOpHash)
        internal
        pure
        returns (address)
    {
        if (sig.length != 66 || sig[0] != MODE_SESSION) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(add(sig.offset, 1))
            s := calldataload(add(sig.offset, 33))
            v := byte(0, calldataload(add(sig.offset, 65)))
        }
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        // slither-disable-next-line unused-return -- the third return (recovered hash) is
        // intentionally discarded; adding a comparison on it would change signature acceptance.
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v, r, s);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return signer;
    }

    /// @notice Run the deterministic §4 scope flow over an in-memory policy, returning a `Scope` the
    ///         caller finishes (allowlist gate + accept/reject + spend write). See `Scope` for the split.
    /// @dev Faithful to the original SessionKeyValidator flow: (1) signer must be the registered,
    ///      non-revoked key; (2) validUntil==0 is refused outright, out-of-window packs the expiry;
    ///      (3) callData must be a single execute(); (4) per-tx + cumulative caps; (5) swap slippage
    ///      floor; (6) recipient pinned to the account (== op.sender). The allowlist gate (step 3's
    ///      target/selector membership) is deferred to the caller via `preAllowlistOk` + `target`/
    ///      `innerSelector`.
    /// @param nowTs the reference timestamp for the hard-window check (the account passes
    ///        `block.timestamp`). Kept as a parameter so the whole flow stays `pure` (a single,
    ///        deterministic source of truth reused on-chain and off-chain).
    /// @dev CONTRACT for the caller: if `preAllowlistOk` is false, RETURN `validationData` verbatim
    ///      (it is either SIG_VALIDATION_FAILED on a hard scope violation, or the packed window on an
    ///      out-of-window op — both correctly reject at the EntryPoint, and neither records spend). If
    ///      `preAllowlistOk` is true (in-window + every non-allowlist check passed), the caller ANDs its
    ///      own (target,selector) allowlist: on a hit, record `spent += notional` and return
    ///      `validationData` (the packed window → EntryPoint accepts); on a miss, return
    ///      SIG_VALIDATION_FAILED.
    function inspect(
        IPolicyModule.Policy memory p,
        PackedUserOperation calldata op,
        bytes32 userOpHash,
        uint256 nowTs
    ) internal pure returns (Scope memory scope) {
        // 1 ── Recover signer; require the registered, non-revoked key on THIS account. Scoped so the
        //      recovery temporaries are released before the decode block (keeps the stack shallow).
        {
            address signer = recoverSessionSigner(op.signature, userOpHash);
            if (signer == address(0) || p.sessionKey != signer || p.revoked) {
                scope.validationData = SIG_VALIDATION_FAILED;
                return scope;
            }
        }

        // 2 ── Hard window. validUntil==0 (the "infinite session" sentinel EntryPoint rewrites to
        //      type(uint48).max) is rejected OUTRIGHT (N4). Out-of-window ⇒ pack the (non-zero) expiry
        //      so EntryPoint rejects; DO NOT record spend (preAllowlistOk stays false).
        if (p.validUntil == 0) {
            scope.validationData = SIG_VALIDATION_FAILED;
            return scope;
        }
        scope.validationData = _packValidationData(p.validUntil, p.validAfter);
        if (nowTs < p.validAfter || nowTs > p.validUntil) {
            return scope; // out of window: return the packed window, record no spend
        }

        // 3 ── The callData must be a single execute(target,value,inner), and carry NO native value:
        //      every allowlisted session action is an ERC-20 flow, so a session op never forwards ETH
        //      (N4 hardening — closes the native-`value` gap flagged by the adversarial refuter).
        if (_topSelector(op.callData) != EXECUTE_SELECTOR || _execValue(op.callData) != 0) {
            scope.validationData = SIG_VALIDATION_FAILED;
            return scope;
        }

        // Decode the inner call + run steps 3–6. Scoped so the (target,inner,notional,recipient,...)
        // temporaries do not all stay live to the end of the function (avoids "stack too deep").
        {
            (address target,, bytes memory inner) =
                abi.decode(op.callData[4:], (address, uint256, bytes));
            scope.target = target;
            scope.innerSelector = _innerSelector(inner);

            (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known) =
                _decodeAction(scope.innerSelector, inner);
            if (!known) {
                scope.validationData = SIG_VALIDATION_FAILED;
                return scope;
            }
            scope.notional = notional;

            // 4 ── Per-tx + cumulative caps.
            if (notional > p.perTxCap || uint256(p.spent) + notional > p.cumulativeCap) {
                scope.validationData = SIG_VALIDATION_FAILED;
                return scope;
            }
            // 5 ── Slippage floor (swaps only).
            if (
                isSwap
                    && (amountOutMin == 0
                        || amountOutMin < slippageFloor(notional, p.maxSlippageBps))
            ) {
                scope.validationData = SIG_VALIDATION_FAILED;
                return scope;
            }
            // 6 ── Recipient pin (N1): funds can only ever land back in the account itself.
            if (recipient != op.sender) {
                scope.validationData = SIG_VALIDATION_FAILED;
                return scope;
            }
        }

        // Every non-allowlist check passed. Window is in `validationData`; caller ANDs the allowlist.
        scope.preAllowlistOk = true;
    }

    /// @dev The minimum acceptable `amountOutMin` given the notional and the per-session slippage
    ///      ceiling. Conservative (notional-relative) floor.
    function slippageFloor(uint256 notional, uint16 maxSlippageBps)
        internal
        pure
        returns (uint256)
    {
        return (notional * (10_000 - maxSlippageBps)) / 10_000;
    }

    /// @notice Decode the notional / recipient / amountOutMin of an allowlisted protocol call. Only the
    ///         six allowlisted selectors are known; anything else returns `known == false`.
    function _decodeAction(bytes4 selector, bytes memory data)
        internal
        pure
        returns (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known)
    {
        if (
            selector == SEL_VAULT_DEPOSIT || selector == SEL_VAULT_REDEEM
                || selector == SEL_VAULT_WITHDRAW
        ) {
            // (assets|shares, receiver, [owner]) — notional word 0, recipient word 1.
            notional = _argWord(data, 0);
            recipient = address(uint160(_argWord(data, 1)));
            known = true;
        } else if (selector == SEL_AAVE_SUPPLY) {
            // supply(asset, amount, onBehalfOf, referralCode) — notional word 1, recipient word 2.
            notional = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 2)));
            known = true;
        } else if (selector == SEL_AAVE_WITHDRAW) {
            // withdraw(asset, amount, to) — notional word 1, recipient word 2.
            notional = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 2)));
            known = true;
        } else if (selector == SEL_AERO_SWAP) {
            // swapExactTokensForTokens(amountIn, amountOutMin, routes, to, deadline).
            notional = _argWord(data, 0);
            amountOutMin = _argWord(data, 1);
            recipient = address(uint160(_argWord(data, 3)));
            isSwap = true;
            known = true;
        }
    }

    /// @notice Is `selector` one of the four selectors that must NEVER be allowlisted at any target (G5)?
    ///         approve / transfer / transferFrom / the empty (arbitrary-call) selector.
    function isForbiddenSelector(bytes4 selector) internal pure returns (bool) {
        return selector == SEL_APPROVE || selector == SEL_TRANSFER || selector == SEL_TRANSFER_FROM
            || selector == SEL_EMPTY;
    }

    /// @dev Pack authorizer(=0/valid) | validUntil(48) | validAfter(48). Mirrors account-abstraction's
    ///      _packValidationData(false, validUntil, validAfter) without importing the helper into every
    ///      consumer.
    function _packValidationData(uint48 validUntil, uint48 validAfter)
        internal
        pure
        returns (uint256)
    {
        return (uint256(validAfter) << 208) | (uint256(validUntil) << 160);
    }

    /// @dev The `value` word of an `execute(address,uint256,bytes)` calldata (2nd head arg, at byte
    ///      offset 4 + 32 = 36). Returns 0 for a too-short calldata (the selector/decode checks reject it).
    function _execValue(bytes calldata cd) internal pure returns (uint256 v) {
        if (cd.length < 68) return 0;
        assembly {
            v := calldataload(add(cd.offset, 36))
        }
    }

    function _topSelector(bytes calldata cd) internal pure returns (bytes4) {
        if (cd.length < 4) return bytes4(0);
        uint256 w;
        assembly {
            w := calldataload(cd.offset)
        }
        return bytes4(bytes32(w));
    }

    function _innerSelector(bytes memory data) internal pure returns (bytes4) {
        if (data.length < 4) return bytes4(0);
        uint256 w;
        assembly {
            w := mload(add(data, 0x20))
        }
        return bytes4(bytes32(w));
    }

    /// @dev Read the ABI head word at argument `index` (byte offset `4 + index*32`) of `data`. Fails
    ///      closed (reverts) on truncated calldata for an allowlisted selector.
    function _argWord(bytes memory data, uint256 index) internal pure returns (uint256 w) {
        uint256 off = 4 + index * 32;
        require(data.length >= off + 32, "SessionScopeLib: short calldata");
        assembly {
            w := mload(add(add(data, 0x20), off))
        }
    }
}
