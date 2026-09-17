// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IWETH9
/// @notice The wrapped-native surface the `FeeRouter` uses to turn ETH into the WETH leg of a swap
/// and to unwrap a WETH-denominated output back into native ETH for the recipient.
/// @dev Robinhood Chain 4663 WETH (`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`) is a proxy over a
/// standard WETH9 implementation (`deposit`/`withdraw` verified present on-chain); the ERC-20 half
/// is read through `IERC20`.
interface IWETH9 {
    /// @notice Wrap the sent native value into WETH credited to the caller.
    function deposit() external payable;

    /// @notice Burn `amount` WETH from the caller and send the same native value back.
    function withdraw(uint256 amount) external;
}
