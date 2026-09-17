// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IUtilityToken
/// @notice The slice of the Pons-launched utility token the revenue engine needs: a real burn.
///
/// @dev Pons writes this ERC-20, not us — `PonsV2LauncherToken` extends OpenZeppelin's
/// `ERC20Burnable`, so `burnFrom` exists on every token that factory has produced. The engine burns
/// with `burnFrom` (reduces `totalSupply()`) rather than a transfer to a dead address, which would
/// leave the tokens in circulating supply.
///
/// ⚠️ The engine's `setToken` is one-shot, so a token without this selector would make clockIn /
/// promote / fuse revert with no way back — verify the selector on the launched token BEFORE
/// spending that setter.
interface IUtilityToken {
    function burnFrom(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}
