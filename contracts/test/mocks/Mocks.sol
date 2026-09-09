// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
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

/// @notice A faithful, purpose-built ERC-4626 mock modelling a curated Morpho vault that
///         SparkPointMorphoVault wraps. Underlying = a MockERC20 (USDC). It decouples the CLAIM (the
///         valuation that drives the share price) from the withdrawable LIQUIDITY, so tests can model
///         Morpho utilization / Vaults-V2 semantics independently:
///           - simulateYield: CLAIM up (pps up) AND liquidity up (underlying minted to self).
///           - simulateLoss:  CLAIM down (pps DOWN) — a Morpho-side loss reflected, never fabricated.
///           - setAvailableLiquidity / lendOut: reduce withdrawable liquidity WITHOUT moving the claim/pps
///             (models market utilization). A withdraw above the live liquidity reverts CLEANLY — never a
///             silent short-fill.
///           - setMaxReturnsZero: maxWithdraw()/maxRedeem() return 0 while totalAssets>0 (Vaults V2),
///             yet an ACTUAL withdraw up to the real liquidity still SUCCEEDS.
///         Rounding mirrors OZ ERC4626 (virtual offset 0) so it NEVER favors the depositor. INVARIANT:
///         the mock physically holds exactly `available` underlying (claim minus lent-out), so any
///         withdraw of `assets <= available` can always be paid.
contract MockMorphoVault is ERC20, IERC4626 {
    using Math for uint256;

    MockERC20 public immutable underlying;

    uint256 internal _claim; // the valuation backing the shares (assets); drives the share price
    uint256 internal _lentOut; // claim currently NOT withdrawable (market utilization)
    bool internal _maxReturnsZero; // model Morpho Vaults V2 (max* return 0 while holding value)

    error InsufficientLiquidity();

    constructor(MockERC20 underlying_) ERC20("Mock Morpho USDC Vault", "mmUSDC") {
        underlying = underlying_;
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return underlying.decimals();
    }

    function asset() public view override returns (address) {
        return address(underlying);
    }

    function totalAssets() public view override returns (uint256) {
        return _claim;
    }

    // ── available (withdrawable) liquidity == claim minus lent-out; mirrored by the physical balance ──
    function _available() internal view returns (uint256) {
        return _claim > _lentOut ? _claim - _lentOut : 0;
    }

    // ── conversions (OZ ERC4626 formula, virtual offset 0; rounding never favors the depositor) ──
    function convertToShares(uint256 assets) public view override returns (uint256) {
        return assets.mulDiv(totalSupply() + 1, _claim + 1, Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return shares.mulDiv(_claim + 1, totalSupply() + 1, Math.Rounding.Floor);
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return assets.mulDiv(totalSupply() + 1, _claim + 1, Math.Rounding.Floor);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        return shares.mulDiv(_claim + 1, totalSupply() + 1, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        return assets.mulDiv(totalSupply() + 1, _claim + 1, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return shares.mulDiv(_claim + 1, totalSupply() + 1, Math.Rounding.Floor);
    }

    function maxDeposit(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Withdrawable assets. Clamped to live liquidity; returns 0 in Vaults-V2 mode (max*==0).
    function maxWithdraw(address owner) public view override returns (uint256) {
        if (_maxReturnsZero) return 0;
        return Math.min(convertToAssets(balanceOf(owner)), _available());
    }

    /// @notice Redeemable shares. Clamped to live liquidity; returns 0 in Vaults-V2 mode (max*==0).
    function maxRedeem(address owner) public view override returns (uint256) {
        if (_maxReturnsZero) return 0;
        return Math.min(balanceOf(owner), convertToShares(_available()));
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        shares = previewDeposit(assets);
        underlying.transferFrom(msg.sender, address(this), assets);
        _claim += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        assets = previewMint(shares);
        underlying.transferFrom(msg.sender, address(this), assets);
        _claim += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @dev Withdraw checks the REAL liquidity directly (NOT maxWithdraw) so a Vaults-V2-style max*==0
    ///      never blocks a legitimate exit; short liquidity reverts CLEANLY (no silent short-fill).
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        returns (uint256 shares)
    {
        if (assets > _available()) revert InsufficientLiquidity();
        shares = previewWithdraw(assets);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        _claim -= assets;
        underlying.transfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        returns (uint256 assets)
    {
        assets = previewRedeem(shares);
        if (assets > _available()) revert InsufficientLiquidity();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        _claim -= assets;
        underlying.transfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // ── Simulation hooks (test-only) ──────────────────────────────────────────

    /// @notice Morpho yield: the CLAIM grows (pps up) AND liquidity grows (underlying minted to self).
    function simulateYield(uint256 assets) external {
        underlying.mint(address(this), assets);
        _claim += assets;
    }

    /// @notice Morpho-side loss: the CLAIM shrinks (pps DOWN). Reflected, never fabricated; the physical
    ///         balance is reduced to the new available level so withdraw accounting stays sound.
    function simulateLoss(uint256 assets) external {
        require(assets <= _claim, "loss>claim");
        _claim -= assets;
        if (_lentOut > _claim) _lentOut = _claim;
        uint256 newAvail = _available();
        uint256 bal = underlying.balanceOf(address(this));
        if (bal > newAvail) underlying.burn(address(this), bal - newAvail);
    }

    /// @notice Model market utilization: reduce withdrawable liquidity WITHOUT changing the claim/pps.
    function lendOut(uint256 amount) external {
        require(amount <= _available(), "lend>avail");
        _lentOut += amount;
        underlying.burn(address(this), amount); // underlying leaves the vault (lent to a borrower)
    }

    /// @notice Set withdrawable liquidity to `target` (<= claim) WITHOUT changing the claim/pps.
    function setAvailableLiquidity(uint256 target) external {
        require(target <= _claim, "target>claim");
        uint256 avail = _available();
        if (target < avail) {
            uint256 d = avail - target;
            _lentOut += d;
            underlying.burn(address(this), d);
        } else if (target > avail) {
            uint256 d = target - avail;
            _lentOut = _lentOut > d ? _lentOut - d : 0;
            underlying.mint(address(this), d);
        }
    }

    /// @notice Model Morpho Vaults V2: max*() return 0 while totalAssets>0 (a real withdraw still works).
    function setMaxReturnsZero(bool v) external {
        _maxReturnsZero = v;
    }
}
