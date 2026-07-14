// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { ICapRegistry } from "../../src/interfaces/ICapRegistry.sol";

/// @notice Minimal mintable/burnable ERC20 with configurable decimals (USDC = 6dp) for local tests.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice Mock aToken (aUSDC). Holds the underlying USDC reserve (mirrors Aave v3 where the aToken
///         custodies the underlying). Only the owning Pool may mint/burn or release underlying.
///         availableLiquidity() in the vault reads `USDC.balanceOf(address(aUSDC))`, so the reserve
///         lives here.
contract MockAToken is ERC20 {
    IERC20 public immutable underlying;
    address public immutable pool;

    error OnlyPool();

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(IERC20 underlying_, address pool_) ERC20("Mock aUSDC", "aUSDC") {
        underlying = underlying_;
        pool = pool_;
    }

    function decimals() public view override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }

    /// @notice Pool-gated release of the underlying USDC reserve on withdraw.
    function releaseUnderlying(address to, uint256 amount) external onlyPool {
        underlying.transfer(to, amount);
    }

    // ── IAToken surface consumed by the vault/adapter ──
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return address(underlying);
    }

    function POOL() external view returns (address) {
        return pool;
    }

    function scaledBalanceOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }
}

/// @notice Mock Aave v3 Pool. supply pulls USDC into the aToken + mints aUSDC 1:1; withdraw burns
///         aUSDC + releases USDC. Test helpers let a suite simulate interest (`accrueTo`) and
///         partial liquidity / utilization (`reduceLiquidity`).
contract MockAavePool is IPool {
    MockERC20 public immutable usdc;
    MockAToken public immutable aToken;

    constructor(MockERC20 usdc_) {
        usdc = usdc_;
        aToken = new MockAToken(usdc_, address(this));
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external override {
        require(asset == address(usdc), "MockAavePool: bad asset");
        // Underlying custodied by the aToken; aUSDC minted 1:1 to the depositor.
        usdc.transferFrom(msg.sender, address(aToken), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to)
        external
        override
        returns (uint256)
    {
        require(asset == address(usdc), "MockAavePool: bad asset");
        aToken.burn(msg.sender, amount);
        aToken.releaseUnderlying(to, amount);
        return amount;
    }

    /// @notice Simulate Aave interest: mint `amount` of yield-aUSDC to `holder` and fund the reserve
    ///         so the extra claim is fully liquid.
    function accrueTo(address holder, uint256 amount) external {
        usdc.mint(address(aToken), amount);
        aToken.mint(holder, amount);
    }

    /// @notice Simulate utilization: move `amount` USDC out of the reserve WITHOUT burning aUSDC, so
    ///         availableLiquidity() drops below the aUSDC claim (partial-liquidity N2 path).
    function reduceLiquidity(uint256 amount) external {
        aToken.releaseUnderlying(address(0xdead), amount);
    }
}

/// @notice A non-bounded ICapRegistry used by the shared, non-cap-focused suites (perf-fee, ERC-4626
///         correctness, non-custody / performance-fee invariants). Those suites are NOT testing caps
///         and deposit large single-user amounts (up to 500_000e6) that exceed the real CapRegistry's
///         hard-coded per-user ceiling (10_000e6). Deploying against this permissive registry keeps the
///         VAULT's cap ENFORCEMENT code fully intact (it is exercised end-to-end by CapsInvariantTest
///         against the real bounded CapRegistry); only these non-cap suites opt out of a binding cap.
contract MockCapRegistry is ICapRegistry {
    uint256 public perUserCap;
    uint256 public totalCap;
    uint256 public vaultCap;

    constructor(uint256 perUserCap_, uint256 totalCap_, uint256 vaultCap_) {
        perUserCap = perUserCap_;
        totalCap = totalCap_;
        vaultCap = vaultCap_;
    }
}
