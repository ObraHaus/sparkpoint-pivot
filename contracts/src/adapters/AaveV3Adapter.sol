// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IPool } from "../interfaces/external/IPool.sol";

/// @title AaveV3Adapter
/// @notice Stateless allowlist adapter over the Aave v3 Pool (smart-contracts.md §1/§7). The supply
///         recipient (`onBehalfOf`) and the withdraw recipient (`to`) are FORCED to the calling
///         account — never a SparkPoint or arbitrary external address (N1). No admin/sweep path.
/// @dev COMPILE-ONLY STUB (W5-US1 TDD RED): signatures only; bodies revert until the impl wave.
///      The single immutable `POOL` is the ONLY code naming the Aave endpoint, so the allowlist
///      stays auditable in one place (§7).
contract AaveV3Adapter {
    IPool public immutable POOL;

    error NotImplemented();

    constructor(IPool pool_) {
        POOL = pool_;
    }

    /// @notice Supply `amount` of `asset` to Aave, minting aTokens to msg.sender (recipient forced).
    function supply(address asset, uint256 amount) external {
        asset;
        amount;
        revert NotImplemented();
    }

    /// @notice Withdraw `amount` of `asset` from Aave to msg.sender (recipient forced).
    function withdraw(address asset, uint256 amount) external returns (uint256) {
        asset;
        amount;
        revert NotImplemented();
    }
}
