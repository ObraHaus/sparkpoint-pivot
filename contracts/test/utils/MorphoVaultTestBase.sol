// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import { SparkPointMorphoVault } from "../../src/vault/SparkPointMorphoVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { MockERC20, MockMorphoVault, MockCapRegistry } from "../mocks/Mocks.sol";

/// @notice Shared local (non-fork) rig for the Morpho WRAPPER vault: MockERC20 USDC + MockMorphoVault
///         (the wrapped curated Morpho ERC-4626) + CapRegistry + the wrapper under test. Mirrors
///         VaultTestBase but swaps the Aave leg for one IERC4626 morphoVault. Yield/loss/liquidity are
///         simulated through the MockMorphoVault hooks. Cap values are overridable so cap suites can
///         drive small ceilings.
abstract contract MorphoVaultTestBase is Test {
    uint256 internal constant ONE_USDC = 1e6;
    uint16 internal constant DEFAULT_FEE_BPS = 1000; // 10%
    uint16 internal constant MAX_FEE_BPS = 2000; // 20% hard cap
    uint256 internal constant WAD = 1e18; // pps probe scale

    MockERC20 internal usdc;
    MockMorphoVault internal morpho;
    CapRegistry internal caps;
    SparkPointMorphoVault internal vault;

    address internal guardian = makeAddr("guardian");
    address internal governance = makeAddr("governance");
    address internal factory = makeAddr("factory");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    // Overridable caps (defaults LARGER than the real CapRegistry ceilings so the non-cap-focused fuzz
    // suites can deposit large single-user amounts). See VaultTestBase for the rationale.
    function capPerUser() internal view virtual returns (uint256) {
        return 1_000_000 * ONE_USDC;
    }

    function capTotal() internal view virtual returns (uint256) {
        return 1_000_000 * ONE_USDC;
    }

    function capVault() internal view virtual returns (uint256) {
        return 1_000_000 * ONE_USDC;
    }

    function _deployStack() internal {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        morpho = new MockMorphoVault(usdc);

        caps = new CapRegistry(
            governance,
            _min(capPerUser(), 10_000 * ONE_USDC),
            _min(capTotal(), 5_000_000 * ONE_USDC),
            _min(capVault(), 5_000_000 * ONE_USDC)
        );

        address reg = _capsFitCeilings()
            ? address(caps)
            : address(new MockCapRegistry(capPerUser(), capTotal(), capVault()));

        vault = new SparkPointMorphoVault(
            IERC20(address(usdc)),
            IERC4626(address(morpho)),
            guardian,
            factory,
            reg,
            feeRecipient,
            DEFAULT_FEE_BPS,
            "SparkPoint Morpho USDC Vault",
            "spkmUSDC",
            "SparkPoint Morpho USDC"
        );
    }

    function _capsFitCeilings() private view returns (bool) {
        return capPerUser() <= 10_000 * ONE_USDC && capTotal() <= 5_000_000 * ONE_USDC
            && capVault() <= 5_000_000 * ONE_USDC;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    // ── Helpers ──
    function _mintUSDC(address to, uint256 amount) internal {
        usdc.mint(to, amount);
    }

    function _deposit(address user, uint256 amount) internal returns (uint256 shares) {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        shares = vault.deposit(amount, user);
        vm.stopPrank();
    }

    /// @notice Simulate realized Morpho yield of `amount` USDC accruing to the wrapped position.
    function _simulateYield(uint256 amount) internal {
        morpho.simulateYield(amount);
    }

    /// @notice Simulate a Morpho-side loss of `amount` USDC (pps DOWN; reflected, never fabricated).
    function _simulateLoss(uint256 amount) internal {
        morpho.simulateLoss(amount);
    }

    /// @notice Current assets-per-share (1e18-scaled) — the HWM/price probe.
    function _pps() internal view returns (uint256) {
        return vault.convertToAssets(WAD);
    }
}
