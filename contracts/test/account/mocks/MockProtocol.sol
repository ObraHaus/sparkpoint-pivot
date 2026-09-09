// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A fake protocol endpoint exposing the EXACT allowlisted selectors (smart-contracts.md §4/§5,
///         constants.ts). Used as `target` for building in-scope session UserOps and for allowlist
///         seeding in the account suites. Inert: it records the last call and returns plausible values;
///         it moves no tokens (the scope suites assert at the validation layer, not on fund flow).
contract MockProtocol {
    /// @dev Aerodrome Route = {from, to, stable, factory} (constants.ts §3 selector 0xcac88ea9).
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    bytes public lastCallData;

    // ── SparkPointVault surface ──
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        lastCallData = msg.data;
        receiver;
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner)
        external
        returns (uint256 assets)
    {
        lastCallData = msg.data;
        receiver;
        owner;
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner)
        external
        returns (uint256 shares)
    {
        lastCallData = msg.data;
        receiver;
        owner;
        return assets;
    }

    // ── Aave v3 Pool surface ──
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
        external
    {
        lastCallData = msg.data;
        asset;
        amount;
        onBehalfOf;
        referralCode;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        lastCallData = msg.data;
        asset;
        to;
        return amount;
    }

    // ── Aerodrome Router surface ──
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        lastCallData = msg.data;
        amountOutMin;
        routes;
        to;
        deadline;
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn;
    }
}

/// @notice A minimal UUPS-shaped upgrade target used by the onlyOwnerUpgrades tests. Anything with a
///         valid proxiableUUID is a legal upgrade destination; this proves an UNGATED upgrade succeeds.
contract UpgradeTarget {
    // ERC-1822 proxiableUUID (EIP-1967 impl slot) so UUPSUpgradeable.upgradeToAndCall accepts it.
    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }

    function version() external pure returns (string memory) {
        return "pwned";
    }
}
