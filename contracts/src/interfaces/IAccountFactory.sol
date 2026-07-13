// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AccountFactory
/// @notice Deterministically deploys one SparkPointAccount per user, binding owner at init.
/// @dev N3: `owner` is the user's self-custodied EOA, supplied by their wallet. SparkPoint NEVER
///      generates a private key and never appears as owner/guardian/recovery. Idempotent.
/// @dev Transcribed verbatim from specs/001-sparkpoint-pivot-mvp/contracts/smart-contracts.md §3.
interface IAccountFactory {
    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    /// @notice Deploy (or return existing) the account for `owner`. CREATE2 ⇒ deterministic address.
    /// @dev Initializes the account with owner == the user EOA. Supports gasless first deposit via
    ///      initCode + paymaster. Returns the existing account if already deployed (idempotent).
    function createAccount(address owner, uint256 salt) external returns (address account);

    /// @notice Counterfactual address for `owner`/`salt` BEFORE deployment (frontend shows this).
    function getAddress(address owner, uint256 salt) external view returns (address);

    /// @notice The account implementation this factory deploys (public for Trust Center provability).
    function accountImplementation() external view returns (address);
}
