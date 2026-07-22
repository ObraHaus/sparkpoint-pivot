// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SparkPointTestToken — the test "SRK" utility token used to purchase Premium on testnets.
/// @notice A fresh, standard 18-decimal ERC-20. It is DELIBERATELY NOT the old, CoinMarketCap-listed
///         SparkPoint (SRK) mainnet token — only the display name/symbol are shared for tester
///         familiarity. The ENTIRE fixed supply is minted to the deployer at construction; there is NO
///         mint function and NO faucet, so `totalSupply()` can never change after deploy (SparkPoint
///         hand-distributes the supply off this contract). Non-essential to any core capability
///         (Constitution V — the vault/chat/withdraw work fully without SRK).
contract SparkPointTestToken is ERC20 {
    /// @notice The fixed total supply, minted once to the deployer at construction (1e9 SRK, 18 dp).
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    /// @dev Decimals default to 18 (OZ ERC20) and are intentionally not overridden. The whole supply
    ///      is minted to the broadcaster; the contract exposes no mint path, so supply is immutable.
    constructor() ERC20("SparkPoint Test Token", "SRK") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
