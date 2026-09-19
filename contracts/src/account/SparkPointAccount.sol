// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { PackedUserOperation } from "@account-abstraction/interfaces/PackedUserOperation.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

import { ISparkPointAccount } from "../interfaces/ISparkPointAccount.sol";
import { IPolicyModule } from "../interfaces/IPolicyModule.sol";
import { ISessionKeyValidator } from "../interfaces/ISessionKeyValidator.sol";
import { PolicyModule } from "./PolicyModule.sol";
import { SessionScopeLib } from "./SessionScopeLib.sol";

/// @title SparkPointAccount — the user's ERC-4337 v0.7 smart account (smart-contracts.md §2; N1/N3/N4).
/// @notice Holds funds, validates UserOps, executes calls. The sole admin authority is the user's owner
///         EOA (N3). The ONLY outbound paths are `execute`/`executeBatch`, each gated by
///         `_requireFromEntryPointOrOwner()` (N1): the EntryPoint reaches them only after a validated
///         owner signature or an in-scope session-key validation. There is NO sweep/rescue/admin
///         transfer-to-arbitrary path. UUPS upgrade is gated to `owner()` ONLY (N3).
/// @dev Path-A (feature 022 §R1): this account OWNS all per-session state — the session `Policy` (caps,
///      window, monotonic `spent`) AND each session's `(target,selector)` allowlist snapshot live in
///      THIS contract's own storage. `validateUserOp` therefore reads config and writes `spent` touching
///      ONLY the account's own storage (the scope math is the inlined pure `SessionScopeLib`), which
///      keeps validation within the ERC-7562/bundler storage-access rules. PolicyModule is consulted
///      ONLY at authorization time (a normal owner tx) to enforce the §6 "allowlist ⊆ global" rule.
contract SparkPointAccount is ISparkPointAccount, Initializable, UUPSUpgradeable {
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    bytes1 internal constant MODE_OWNER = 0x00;
    bytes1 internal constant MODE_SESSION = 0x01;

    /// @dev maxSessionDurationDays = 30 (constants.ts SessionBounds). A session key must expire within
    ///      this window of its authorization — an owner cannot arm a decade-long key (N4 bound).
    uint256 internal constant MAX_SESSION_DURATION = 30 days;

    // ── checkAction reason codes (surfaced off-chain when !ok) ──
    bytes32 internal constant OK = bytes32(0);
    bytes32 internal constant REASON_NOT_ALLOWLISTED = "TARGET_NOT_ALLOWLISTED";
    bytes32 internal constant REASON_PER_TX_CAP = "PER_TX_CAP";
    bytes32 internal constant REASON_CUMULATIVE_CAP = "CUMULATIVE_CAP";
    bytes32 internal constant REASON_EXPIRED = "EXPIRED";
    bytes32 internal constant REASON_REVOKED = "REVOKED";
    bytes32 internal constant REASON_RECIPIENT = "RECIPIENT_NOT_ACCOUNT";
    bytes32 internal constant REASON_SLIPPAGE = "SLIPPAGE_FLOOR";
    bytes32 internal constant REASON_UNKNOWN_SELECTOR = "UNKNOWN_SELECTOR";

    // ── Immutables (live in the implementation bytecode; read through the proxy delegatecall) ──
    IEntryPoint internal immutable _ENTRY_POINT;
    /// @notice The view-only parity mirror of this account's session validation (informational; the
    ///         account validates in-line and does not delegate to it). Exposed for Trust Center/tooling.
    ISessionKeyValidator public immutable sessionValidator;
    /// @notice The global arming allowlist, consulted ONLY at `authorizeSessionKey` time (N4/§6 subset).
    PolicyModule public immutable policyModule;

    // ── Proxy storage ──
    address internal _owner;
    // Per-session policy (sessionKey => Policy) — the account's OWN storage (Path-A §R1). `spent` is
    // monotonic and never reset (even by re-authorization).
    mapping(address => IPolicyModule.Policy) internal _sessionPolicies;
    // Per-session (target,selector) allowlist snapshot (sessionKey => keccak256(target ‖ selector)[]).
    // Overwritten wholesale on each authorization (stale generations are unreachable).
    mapping(address => bytes32[]) internal _sessionAllowlist;
    // The account's active session key (last authorized) — resolves the keyless checkAction() view.
    address internal _activeSessionKey;

    error NotFromEntryPoint();
    error NotFromEntryPointOrOwner();
    error NotOwner();
    error ZeroOwner();
    /// @dev A session with `validUntil == 0` (the "infinite session" sentinel) is REFUSED at
    ///      authorization — no infinite session (constants.ts SessionBounds, policy-schema.md §6).
    error ZeroValidUntil();
    /// @dev A session may not be valid more than `MAX_SESSION_DURATION` past authorization (N4 bound).
    error SessionTooLong();
    error AllowlistLengthMismatch();
    error EmptyAllowlist();
    error ZeroSessionKey();
    /// @dev A `(target,selector)` in the requested session scope is not in the global arming allowlist
    ///      (or is a forbidden selector) — the §6 "allowlist ⊆ global" narrowing rule.
    error TargetNotArmed();
    /// @dev The monotonic session `spent` ledger would overflow its packed uint128 — refuse rather
    ///      than truncate (replaces the unchecked uint128 downcast).
    error SpentOverflow();

    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotOwner();
        _;
    }

    constructor(IEntryPoint entryPoint_, address sessionValidator_, address policyModule_) {
        _ENTRY_POINT = entryPoint_;
        sessionValidator = ISessionKeyValidator(sessionValidator_);
        policyModule = PolicyModule(policyModule_);
        _disableInitializers();
    }

    /// @notice Bind the sole owner (the user EOA). No SparkPoint address may appear here (N3).
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroOwner();
        _owner = owner_;
        emit SparkPointAccountInitialized(address(_ENTRY_POINT), owner_);
    }

    function entryPoint() external view returns (address) {
        return address(_ENTRY_POINT);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function activeSessionKey() external view returns (address) {
        return _activeSessionKey;
    }

    /// @notice ERC-4337 validation. Owner-signed UserOps (mode 0x00) validate ECDSA against `owner()`;
    ///         session-key UserOps (mode 0x01) run the §4 scope flow inline over this account's OWN
    ///         session storage. Reads/writes ONLY account-own storage (ERC-7562 compliant, §R1).
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        if (msg.sender != address(_ENTRY_POINT)) revert NotFromEntryPoint();

        bytes calldata sig = userOp.signature;
        if (sig.length == 66 && sig[0] == MODE_OWNER) {
            validationData = _validateOwnerSignature(sig, userOpHash);
        } else if (sig.length == 66 && sig[0] == MODE_SESSION) {
            validationData = _validateSession(userOp, userOpHash);
        } else {
            validationData = SIG_VALIDATION_FAILED;
        }

        _payPrefund(missingAccountFunds);
    }

    /// @notice Execute a single call. N1: gated by `_requireFromEntryPointOrOwner()`. For a session-key
    ///         UserOp the EntryPoint reaches this only after `_validateSession` passed the exact same
    ///         callData through the §4 scope flow.
    function execute(address target, uint256 value, bytes calldata data) external {
        _requireFromEntryPointOrOwner();
        _call(target, value, data);
        emit Executed(target, value, bytes4(data));
    }

    /// @notice Execute a batch. Same N1 gating as `execute()`.
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external {
        _requireFromEntryPointOrOwner();
        require(
            targets.length == values.length && targets.length == datas.length,
            "SparkPointAccount: length mismatch"
        );
        for (uint256 i = 0; i < targets.length; i++) {
            _call(targets[i], values[i], datas[i]);
            emit Executed(targets[i], values[i], bytes4(datas[i]));
        }
    }

    /// @inheritdoc ISparkPointAccount
    function authorizeSessionKey(
        IPolicyModule.Policy calldata policy,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external onlyOwner {
        if (policy.sessionKey == address(0)) revert ZeroSessionKey();
        if (targets.length != selectors.length) revert AllowlistLengthMismatch();
        if (targets.length == 0) revert EmptyAllowlist();
        // N4 hard-expiry at the SOURCE: refuse the `validUntil == 0` infinite-session sentinel and any
        // key valid more than MAX_SESSION_DURATION out.
        if (policy.validUntil == 0) revert ZeroValidUntil();
        if (uint256(policy.validUntil) > block.timestamp + MAX_SESSION_DURATION) {
            revert SessionTooLong();
        }

        // Compute the session's (target,selector) snapshot keys — memory only, no external calls.
        bytes32[] memory keys = new bytes32[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            keys[i] = keccak256(abi.encodePacked(targets[i], selectors[i]));
        }

        // EFFECTS before INTERACTIONS. A later revert rolls every write back atomically, so the §6
        // "allowlist ⊆ global" validation (an external read) can safely run after them — and no state
        // change follows an external call in this function.
        _sessionAllowlist[policy.sessionKey] = keys;
        // Store the scope, PRESERVING the existing monotonic spend ledger — a re-authorization of the
        // same key can NEVER reset `spent` (the on-input `policy.spent` is ignored).
        IPolicyModule.Policy memory p = policy;
        p.spent = _sessionPolicies[policy.sessionKey].spent;
        _sessionPolicies[policy.sessionKey] = p;
        _activeSessionKey = policy.sessionKey;

        // INTERACTIONS last: each pair MUST be armed in the global PolicyModule allowlist (which also
        // rejects forbidden selectors BY CONSTRUCTION). This is a normal owner tx (not bundler-
        // validated), so the external `isAllowedTarget` read here is unrestricted.
        for (uint256 i = 0; i < targets.length; i++) {
            if (!policyModule.isAllowedTarget(targets[i], selectors[i])) revert TargetNotArmed();
        }

        emit SessionKeyAuthorized(policy.sessionKey, policy.validUntil);
    }

    /// @notice Revoke a session key. Owner-only, INSTANT, UNILATERAL — no timelock, no pause. The next
    ///         UserOp under this key fails validateUserOp because validation reads live storage
    ///         (N4, FR-031, SC-008). A sacred exit (N2): never gated by anything.
    function revokeSessionKey(address sessionKey) external onlyOwner {
        _sessionPolicies[sessionKey].revoked = true;
        emit SessionKeyRevoked(sessionKey);
    }

    /// @notice Owner-only ownership transfer (N3) — the only way `owner()` changes.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    /// @notice UUPS upgrade entrypoint. Resolves the ISparkPointAccount/UUPSUpgradeable diamond.
    function upgradeToAndCall(address newImplementation, bytes memory data)
        public
        payable
        override(ISparkPointAccount, UUPSUpgradeable)
    {
        super.upgradeToAndCall(newImplementation, data);
    }

    // ── Session views (read this account's OWN storage) ──

    /// @inheritdoc ISparkPointAccount
    function sessionPolicyOf(address sessionKey)
        external
        view
        returns (IPolicyModule.Policy memory)
    {
        return _sessionPolicies[sessionKey];
    }

    /// @inheritdoc ISparkPointAccount
    function isSessionAllowed(address sessionKey, address target, bytes4 selector)
        public
        view
        returns (bool)
    {
        if (SessionScopeLib.isForbiddenSelector(selector)) return false;
        bytes32 k = keccak256(abi.encodePacked(target, selector));
        bytes32[] storage keys = _sessionAllowlist[sessionKey];
        uint256 len = keys.length;
        for (uint256 i = 0; i < len; i++) {
            // Non-strict loop shape: slither's field-insensitive taint marks `keys[i] == k` as a
            // dangerous strict equality (FP — both sides are keccak256 hashes). A `!=`/continue loop
            // is the identical predicate with no strict equality.
            if (keys[i] != k) continue;
            return true;
        }
        return false;
    }

    /// @inheritdoc ISparkPointAccount
    function checkAction(IPolicyModule.Call calldata call, uint256 valueUSD)
        external
        view
        returns (bool ok, bytes32 reason)
    {
        address key = _activeSessionKey;
        IPolicyModule.Policy memory p = _sessionPolicies[key];
        bytes4 selector = bytes4(call.data);

        if (p.revoked) return (false, REASON_REVOKED);
        if (block.timestamp < p.validAfter || block.timestamp > p.validUntil) {
            return (false, REASON_EXPIRED);
        }
        if (!isSessionAllowed(key, call.target, selector)) return (false, REASON_NOT_ALLOWLISTED);

        (uint256 notional, address recipient, uint256 amountOutMin, bool isSwap, bool known) =
            SessionScopeLib._decodeAction(selector, call.data);
        if (!known) return (false, REASON_UNKNOWN_SELECTOR);

        if (valueUSD > p.perTxCap) return (false, REASON_PER_TX_CAP);
        if (uint256(p.spent) + valueUSD > p.cumulativeCap) return (false, REASON_CUMULATIVE_CAP);
        if (
            isSwap
                && (amountOutMin == 0
                    || amountOutMin < SessionScopeLib.slippageFloor(notional, p.maxSlippageBps))
        ) {
            return (false, REASON_SLIPPAGE);
        }
        if (recipient != address(this)) return (false, REASON_RECIPIENT);
        return (true, OK);
    }

    /// @dev N3: SparkPoint has no authority here — only the user's owner EOA may upgrade the account.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        newImplementation;
    }

    receive() external payable { }

    // ── Internals ──

    function _requireFromEntryPointOrOwner() internal view {
        if (msg.sender != address(_ENTRY_POINT) && msg.sender != _owner) {
            revert NotFromEntryPointOrOwner();
        }
    }

    /// @dev The §4 session scope flow over this account's OWN storage. Reads the stored policy +
    ///      allowlist snapshot; on a full pass advances the monotonic `spent` ledger (own storage write)
    ///      and returns the packed window; otherwise returns SIG_VALIDATION_FAILED or the out-of-window
    ///      pack. Touches NO external contract storage (ERC-7562 compliant).
    function _validateSession(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        returns (uint256)
    {
        address signer = SessionScopeLib.recoverSessionSigner(userOp.signature, userOpHash);
        if (signer == address(0)) return SIG_VALIDATION_FAILED;

        IPolicyModule.Policy memory p = _sessionPolicies[signer];
        SessionScopeLib.Scope memory scope =
            SessionScopeLib.inspect(p, userOp, userOpHash, block.timestamp);
        if (!scope.preAllowlistOk) return scope.validationData;

        if (isSessionAllowed(signer, scope.target, scope.innerSelector)) {
            uint256 newSpent = uint256(p.spent) + scope.notional;
            // Bounded downcast (aderyn unsafe-casting): the ledger is uint128; refuse to truncate.
            if (newSpent > type(uint128).max) revert SpentOverflow();
            _sessionPolicies[signer].spent = uint128(newSpent);
            emit SessionKeySpent(signer, scope.notional, newSpent);
            return scope.validationData;
        }
        return SIG_VALIDATION_FAILED;
    }

    /// @dev Recover the owner from the 66-byte `mode(1) || r(32) || s(32) || v(1)` signature over
    ///      `EIP-191(userOpHash)`; SIG_VALIDATION_FAILED on any malformed/invalid/non-owner signature.
    function _validateOwnerSignature(bytes calldata sig, bytes32 userOpHash)
        internal
        view
        returns (uint256)
    {
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
        if (err != ECDSA.RecoverError.NoError || signer != _owner) return SIG_VALIDATION_FAILED;
        return SIG_VALIDATION_SUCCESS;
    }

    function _call(address target, uint256 value, bytes calldata data) internal {
        // Defense in depth at the value-bearing call site: re-assert N1. Callers (execute /
        // executeBatch) already gate on `_requireFromEntryPointOrOwner`; this direct msg.sender
        // check keeps the low-level call inside a guarded frame even if a future caller forgets.
        if (msg.sender != address(_ENTRY_POINT) && msg.sender != _owner) {
            revert NotFromEntryPointOrOwner();
        }
        (bool success, bytes memory ret) = target.call{ value: value }(data);
        if (!success) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    /// @dev Standard ERC-4337 prefund payment to the EntryPoint during validation. Sends to the
    ///      IMMUTABLE `_ENTRY_POINT` (never to an arbitrary `msg.sender`); `validateUserOp` already
    ///      requires the caller to be that EntryPoint.
    function _payPrefund(uint256 missingAccountFunds) internal {
        // Defense in depth at the value-bearing call site: only the EntryPoint may ever receive the
        // prefund. `validateUserOp` already gates the caller; re-asserting it here keeps the transfer
        // inside a caller-checked frame even if a future caller forgets.
        if (msg.sender != address(_ENTRY_POINT)) revert NotFromEntryPoint();
        if (missingAccountFunds != 0) {
            (bool success,) = address(_ENTRY_POINT).call{ value: missingAccountFunds }("");
            (success);
        }
    }
}
