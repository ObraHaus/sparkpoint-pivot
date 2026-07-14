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

/// @title SparkPointAccount — the user's ERC-4337 v0.7 smart account (smart-contracts.md §2; N1/N3/N4).
/// @notice Holds funds, validates UserOps, executes calls. The sole admin authority is the user's owner
///         EOA (N3). The ONLY outbound paths are `execute`/`executeBatch`, each gated by
///         `_requireFromEntryPointOrOwner()` (N1): the EntryPoint reaches them only after a validated
///         owner signature or an in-scope session-key validation. There is NO sweep/rescue/admin
///         transfer-to-arbitrary path — no code lets the protocol/agent name a SparkPoint or external
///         recipient. UUPS upgrade is gated to `owner()` ONLY (N3): SparkPoint can never upgrade a
///         user's account.
contract SparkPointAccount is ISparkPointAccount, Initializable, UUPSUpgradeable {
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    bytes1 internal constant MODE_OWNER = 0x00;
    bytes1 internal constant MODE_SESSION = 0x01;

    // ── Immutables (live in the implementation bytecode; read through the proxy delegatecall) ──
    IEntryPoint internal immutable _ENTRY_POINT;
    ISessionKeyValidator public immutable sessionValidator;
    PolicyModule public immutable policyModule;

    // ── Proxy storage ──
    address internal _owner;

    error NotFromEntryPoint();
    error NotFromEntryPointOrOwner();
    error NotOwner();
    error ZeroOwner();

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

    /// @notice ERC-4337 validation. Owner-signed UserOps (mode 0x00) validate ECDSA against `owner()`;
    ///         session-key UserOps (mode 0x01) delegate to SessionKeyValidator, returning its packed
    ///         validationData. Reads only account-associated storage (§2/§5/§7).
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
            validationData = sessionValidator.validateUserOp(userOp, userOpHash);
        } else {
            validationData = SIG_VALIDATION_FAILED;
        }

        _payPrefund(missingAccountFunds);
    }

    /// @notice Execute a single call. N1: gated by `_requireFromEntryPointOrOwner()`. For a session-key
    ///         UserOp the EntryPoint reaches this only after SessionKeyValidator passed the exact same
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

    /// @notice Authorize an opt-in session key with an on-chain Policy. Owner-only (N4). Seeds the
    ///         account's session policy in PolicyModule; the protocol (target,selector) allowlist is the
    ///         global armed set (which NEVER contains approve/transfer/arbitrary), so a session key can
    ///         neither self-grant spend power nor reach an unknown contract.
    function authorizeSessionKey(IPolicyModule.Policy calldata policy) external onlyOwner {
        require(policy.sessionKey != address(0), "SparkPointAccount: zero session key");
        policyModule.registerSession(policy);
        emit SessionKeyAuthorized(policy.sessionKey, policy.validUntil);
    }

    /// @notice Revoke a session key. Owner-only, INSTANT, UNILATERAL — no timelock, no pause. The next
    ///         UserOp under this key fails validateUserOp because validation reads live storage
    ///         (N4, FR-031, SC-008).
    function revokeSessionKey(address sessionKey) external onlyOwner {
        policyModule.revokeSession(sessionKey);
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
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v, r, s);
        if (err != ECDSA.RecoverError.NoError || signer != _owner) return SIG_VALIDATION_FAILED;
        return SIG_VALIDATION_SUCCESS;
    }

    function _call(address target, uint256 value, bytes calldata data) internal {
        (bool ok, bytes memory ret) = target.call{ value: value }(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    /// @dev Standard ERC-4337 prefund payment to the EntryPoint during validation.
    function _payPrefund(uint256 missingAccountFunds) internal {
        if (missingAccountFunds != 0) {
            (bool ok,) = msg.sender.call{ value: missingAccountFunds }("");
            (ok);
        }
    }
}
