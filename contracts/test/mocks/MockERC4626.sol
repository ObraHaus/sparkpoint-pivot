// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title MockERC4626 — a plain, honest child vault for wrapper tests
/// @notice Supports simulated yield (asset donation → pps up), simulated loss (`skim` → pps down),
///         a deposit cap, and a "V2-style" mode where every `max*` view returns 0 while value is
///         held (the exact behavior the wrapper's liquidity fallback exists for).
contract MockERC4626 is ERC4626 {
    bool public zeroMaxViews;
    uint256 public depositCap = type(uint256).max;

    constructor(IERC20 asset_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
    { }

    function setZeroMaxViews(bool zero) external {
        zeroMaxViews = zero;
    }

    function setDepositCap(uint256 cap) external {
        depositCap = cap;
    }

    /// @notice Simulated loss: move assets out, lowering the share price.
    function skim(address to, uint256 amount) external {
        IERC20(asset()).transfer(to, amount);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (zeroMaxViews) return 0;
        return Math.min(super.maxDeposit(receiver), depositCap);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (zeroMaxViews) return 0;
        if (depositCap == type(uint256).max) return super.maxMint(receiver);
        return Math.min(super.maxMint(receiver), convertToShares(depositCap));
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (zeroMaxViews) return 0;
        return super.maxWithdraw(owner);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (zeroMaxViews) return 0;
        return super.maxRedeem(owner);
    }

    /// @dev V2-style behavior: `max*` views return 0 but the OPERATION still works. OZ's own
    ///      withdraw/redeem enforce `maxWithdraw(maxRedeem)`, so in zero mode the checks are
    ///      bypassed here — exactly the situation the wrapper's liquidity fallback exists for.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        returns (uint256 shares)
    {
        if (!zeroMaxViews) return super.withdraw(assets, receiver, owner);
        shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        returns (uint256 assets)
    {
        if (!zeroMaxViews) return super.redeem(shares, receiver, owner);
        assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }
}
