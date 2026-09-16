// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { IAccountFactory } from "../interfaces/IAccountFactory.sol";
import { SparkPointAccount } from "./SparkPointAccount.sol";

/// @title AccountFactory — CREATE2 factory (smart-contracts.md §3; N3).
/// @notice Deterministically deploys one SparkPointAccount per `(owner, salt)`, binding `owner` to the
///         user's self-custodied EOA at init. SparkPoint NEVER generates a private key and never appears
///         as owner/guardian/recovery (N3). The deployed address equals `getAddress(owner, salt)`
///         (counterfactual, shown by the frontend before deploy) and a repeat call is idempotent —
///         it returns the existing account. `owner` is folded into the proxy init calldata, so distinct
///         owners (or salts) yield distinct accounts even though the CREATE2 salt is `salt` alone.
contract AccountFactory is IAccountFactory {
    address public immutable accountImplementation;

    constructor(address accountImplementation_) {
        accountImplementation = accountImplementation_;
    }

    /// @notice Deploy (or return the existing) account for `owner`/`salt`. Idempotent.
    function createAccount(address owner, uint256 salt) external returns (address account) {
        account = getAddress(owner, salt);
        if (account.code.length > 0) {
            return account; // already deployed — idempotent
        }
        account = address(
            new ERC1967Proxy{ salt: bytes32(salt) }(accountImplementation, _initData(owner))
        );
        emit AccountCreated(account, owner, salt);
    }

    /// @notice Counterfactual address for `owner`/`salt` BEFORE deployment (frontend shows this).
    function getAddress(address owner, uint256 salt) public view returns (address) {
        // bytes.concat (not abi.encodePacked) for the same bytes — no collision ambiguity exists here
        // (the creation code is fixed-length and the abi.encode tail is self-delimiting), and holding
        // the encoding byte-identical keeps every counterfactual CREATE2 address stable. Also resolves
        // aderyn's `abi.encodePacked() Hash Collision` heuristic.
        return Create2.computeAddress(
            bytes32(salt),
            keccak256(
                bytes.concat(
                    type(ERC1967Proxy).creationCode,
                    abi.encode(accountImplementation, _initData(owner))
                )
            )
        );
    }

    /// @dev The proxy init calldata that binds `owner` at initialize (N3). Folded into the init-code
    ///      hash, so it participates in the CREATE2 address ⇒ distinct owners ⇒ distinct accounts.
    function _initData(address owner) internal pure returns (bytes memory) {
        return abi.encodeCall(SparkPointAccount.initialize, (owner));
    }
}
