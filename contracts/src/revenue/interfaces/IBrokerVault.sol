// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IBrokerVault
/// @notice Holdings recorded against a **token id**, not a wallet, so earned value rides a resale.
/// @dev Multi-asset, AS-IS: `asset == address(0)` means **native ETH**; anything else is an ERC-20.
interface IBrokerVault {
    /// @notice Record `amount` of `asset` for `tokenId`. Engine only.
    function credit(uint256 tokenId, address asset, uint256 amount) external;

    /// @notice Record native ETH for `tokenId`. Engine only (ETH arrives with the call).
    function creditEth(uint256 tokenId) external payable;

    /// @notice Move everything `from` holds into `to`. Engine only, called on every fusion.
    /// @dev Iterates the vault's **own** per-token asset set rather than a list supplied by the
    /// caller — a stale or wrong list is exactly how value gets stranded, so the vault enumerates
    /// what it actually holds.
    function merge(uint256 from, uint256 to) external;

    function balanceOf(uint256 tokenId, address asset) external view returns (uint256);

    function assetsOf(uint256 tokenId) external view returns (address[] memory);
}
