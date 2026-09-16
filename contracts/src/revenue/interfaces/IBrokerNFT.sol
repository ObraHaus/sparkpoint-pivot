// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IBrokerNFT
/// @notice The entire view the beta revenue engine has of the Sparky Broker collection.
///
/// @dev The collection is a plain OpenSea SeaDrop factory clone: no hooks, no `isActive`, no
/// `weightOf`, no rank. The engine holds the whole state machine and reads the collection for two
/// things only, writing it never:
///
/// - `ownerOf(id)` — the single source of ownership truth; it **reverts** for a burned/absorbed id
///   (OpenZeppelin v5 / ERC721A revert rather than return `address(0)`), so every call site must
///   `try`/`catch` and treat a revert as "gone" — a burned id must never revert a permissionless
///   `deliver` batch.
/// - `burn(id)` — how `fuse` destroys an absorbed broker. Holder/approved-gated on the clone, so
///   the engine can only call it after the holder granted ERC-721 approval (approve-then-fuse).
interface IBrokerNFT {
    /// @notice The current owner of `tokenId`. Reverts for a nonexistent/burned id.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Destroy `tokenId` (holder or approved operator only).
    function burn(uint256 tokenId) external;
}
