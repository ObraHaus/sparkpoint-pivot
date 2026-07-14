// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IPolicyModule } from "../interfaces/IPolicyModule.sol";

/// @title PolicyModule — on-chain policy registry (smart-contracts.md §5; N4, G2/G5).
/// @notice The deterministic on-chain authority both manual (SparkPointAccount) and automated
///         (SessionKeyValidator) execution consult: a `(target, selector)` allowlist (address+selector
///         level — G5), per-tx + cumulative caps with a monotonic `spent` ledger (G2), a hard expiry,
///         a slippage floor, and a recipient pin. It holds NO assets and exposes NO transfer selector —
///         it only answers `bool`/packed policy (§5 "No fund path").
/// @dev All per-session state is keyed by `account` (account-associated storage), so a bundler-side
///      validateUserOp read stays within the ERC-4337 storage-access rules (§5/§7). approve /
///      transfer / transferFrom / the empty selector are NEVER allowlisted (enforced BY CONSTRUCTION in
///      `_isAllowedTarget` — a defense-in-depth guard beyond the arming script only ever seeding the six
///      protocol pairs).
contract PolicyModule is IPolicyModule {
    // ── Reason codes (surfaced off-chain when !ok) ──
    bytes32 internal constant OK = bytes32(0);
    bytes32 internal constant REASON_NOT_ALLOWLISTED = "TARGET_NOT_ALLOWLISTED";
    bytes32 internal constant REASON_PER_TX_CAP = "PER_TX_CAP";
    bytes32 internal constant REASON_CUMULATIVE_CAP = "CUMULATIVE_CAP";
    bytes32 internal constant REASON_EXPIRED = "EXPIRED";
    bytes32 internal constant REASON_REVOKED = "REVOKED";
    bytes32 internal constant REASON_RECIPIENT = "RECIPIENT_NOT_ACCOUNT";
    bytes32 internal constant REASON_SLIPPAGE = "SLIPPAGE_FLOOR";
    bytes32 internal constant REASON_UNKNOWN_SELECTOR = "UNKNOWN_SELECTOR";

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

    address public admin;
    address public sessionValidator;

    // GLOBAL protocol allowlist (target => selector => allowed). Seeded via `setAllowedTarget` by the
    // arming script; NEVER contains a forbidden selector (guarded in `_isAllowedTarget`).
    mapping(address => mapping(bytes4 => bool)) internal _allowed;

    // Per-account session policies (account => sessionKey => Policy). account-associated storage (§5).
    mapping(address => mapping(address => Policy)) internal _policies;
    // The account's active session key (last non-revoked registration) — resolves the keyless
    // checkAction() view in the single-agent-key model.
    mapping(address => address) public activeSessionKey;

    error OnlyAdmin();
    error OnlyValidator();
    /// @dev A session with `validUntil == 0` (the "infinite session" sentinel EntryPoint rewrites to
    ///      type(uint48).max) is REFUSED at arming — no infinite session (constants.ts SessionBounds,
    ///      policy-schema.md §6). Belt-and-suspenders with SessionKeyValidator's step-2 zero guard.
    error ZeroValidUntil();
    /// @dev A session may not be valid more than `MAX_SESSION_DURATION` past arming (maxSessionDurationDays).
    error SessionTooLong();

    /// @dev maxSessionDurationDays = 30 (constants.ts SessionBounds). A session key must expire within
    ///      this window of its authorization — an owner cannot arm a decade-long key (N4 bound).
    uint256 internal constant MAX_SESSION_DURATION = 30 days;

    constructor(address admin_) {
        admin = admin_;
    }

    // ── Arming surface (admin) — seeds the global (target,selector) allowlist ──
    function setAllowedTarget(address target, bytes4 selector, bool allowed) external {
        if (msg.sender != admin) revert OnlyAdmin();
        _allowed[target][selector] = allowed;
    }

    function setSessionValidator(address validator_) external {
        if (msg.sender != admin) revert OnlyAdmin();
        sessionValidator = validator_;
    }

    // ── Account-driven session lifecycle (msg.sender == the account) ──
    function registerSession(Policy calldata policy) external {
        // N4 hard-expiry at the SOURCE: refuse the `validUntil == 0` infinite-session sentinel and any
        // key valid more than MAX_SESSION_DURATION out. Enforced here (the sole storage writer) so EVERY
        // arming path — SparkPointAccount.authorizeSessionKey or a direct account call — is bounded.
        if (policy.validUntil == 0) revert ZeroValidUntil();
        if (uint256(policy.validUntil) > block.timestamp + MAX_SESSION_DURATION) {
            revert SessionTooLong();
        }
        _policies[msg.sender][policy.sessionKey] = policy;
        activeSessionKey[msg.sender] = policy.sessionKey;
        emit PolicySeeded(msg.sender, policy.sessionKey, policy.validUntil);
    }

    function revokeSession(address sessionKey) external {
        _policies[msg.sender][sessionKey].revoked = true;
        emit PolicyRevoked(msg.sender, sessionKey);
    }

    /// @notice Validator-driven monotonic spend accounting (G2). The validator has already asserted
    ///         `spent + notional <= cumulativeCap`, so the `uint128` cast cannot overflow.
    function recordSpend(address account, address sessionKey, uint256 notional) external {
        if (msg.sender != sessionValidator) revert OnlyValidator();
        Policy storage p = _policies[account][sessionKey];
        uint256 newSpent = uint256(p.spent) + notional;
        p.spent = uint128(newSpent);
        emit Spent(account, sessionKey, notional, newSpent);
    }

    // ── IPolicyModule ──

    /// @dev Address+selector-level allowlist (G5). approve/transfer/transferFrom/empty are rejected BY
    ///      CONSTRUCTION regardless of what the arming map holds — a session key can never self-grant
    ///      spend power or reach unknown code.
    function isAllowedTarget(address target, bytes4 selector) external view returns (bool) {
        return _isAllowedTarget(target, selector);
    }

    function _isAllowedTarget(address target, bytes4 selector) internal view returns (bool) {
        if (
            selector == SEL_APPROVE || selector == SEL_TRANSFER || selector == SEL_TRANSFER_FROM
                || selector == SEL_EMPTY
        ) {
            return false;
        }
        return _allowed[target][selector];
    }

    /// @notice Stateless scope check over the account's ACTIVE session policy (single-agent-key model).
    ///         Mirrors the SessionKeyValidator §4 flow for the off-chain policy layer + Trust Center.
    function checkAction(address account, Call calldata call, uint256 valueUSD)
        external
        view
        returns (bool ok, bytes32 reason)
    {
        Policy memory p = _policies[account][activeSessionKey[account]];
        bytes4 selector = bytes4(call.data);

        if (p.revoked) return (false, REASON_REVOKED);
        if (block.timestamp < p.validAfter || block.timestamp > p.validUntil) {
            return (false, REASON_EXPIRED);
        }
        if (!_isAllowedTarget(call.target, selector)) return (false, REASON_NOT_ALLOWLISTED);

        (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known) =
            _decodeAction(selector, call.data);
        if (!known) return (false, REASON_UNKNOWN_SELECTOR);

        if (valueUSD > p.perTxCap) return (false, REASON_PER_TX_CAP);
        if (uint256(p.spent) + valueUSD > p.cumulativeCap) return (false, REASON_CUMULATIVE_CAP);
        if (
            isSwap
                && (amountOutMin == 0 || amountOutMin < _slippageFloor(notional, p.maxSlippageBps))
        ) {
            return (false, REASON_SLIPPAGE);
        }
        if (recipient != account) return (false, REASON_RECIPIENT);
        return (true, OK);
    }

    function policyOf(address account, address sessionKey) external view returns (Policy memory) {
        return _policies[account][sessionKey];
    }

    // ── Shared decode + slippage helpers (kept identical to SessionKeyValidator BY CONSTRUCTION) ──

    /// @notice Decode the notional / recipient / amountOutMin of an allowlisted protocol call from its
    ///         raw calldata (selector + ABI head words). Only the six allowlisted selectors are known;
    ///         anything else returns `known == false`.
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

    /// @dev The minimum acceptable `amountOutMin` given the notional and the per-session slippage
    ///      ceiling. Conservative (notional-relative) floor — see SessionKeyValidator for rationale.
    function _slippageFloor(uint256 notional, uint16 maxSlippageBps)
        internal
        pure
        returns (uint256)
    {
        return (notional * (10_000 - maxSlippageBps)) / 10_000;
    }

    /// @dev Read the ABI head word at argument `index` (byte offset `4 + index*32`) of `data`. Fails
    ///      closed (reverts) on truncated calldata for an allowlisted selector.
    function _argWord(bytes memory data, uint256 index) internal pure returns (uint256 w) {
        uint256 off = 4 + index * 32;
        require(data.length >= off + 32, "PolicyModule: short calldata");
        assembly {
            w := mload(add(add(data, 0x20), off))
        }
    }
}
