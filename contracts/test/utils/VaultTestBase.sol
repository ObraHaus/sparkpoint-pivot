// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { MockERC20, MockAToken, MockAavePool, MockCapRegistry } from "../mocks/Mocks.sol";

/// @notice Shared local (non-fork) rig: MockERC20 USDC + MockAavePool/aUSDC + CapRegistry + the vault
///         under test. Yield is simulated with `_simulateYield`. Cap values are overridable so cap
///         suites can drive small ceilings.
abstract contract VaultTestBase is Test {
    // Shared/policy constants (packages/shared/src/policy/constants.ts — T098 parity).
    uint256 internal constant ONE_USDC = 1e6;
    uint16 internal constant DEFAULT_FEE_BPS = 1000; // 10%
    uint16 internal constant MAX_FEE_BPS = 2000; // 20% hard cap
    uint256 internal constant WAD = 1e18; // pps probe scale

    MockERC20 internal usdc;
    MockAavePool internal pool;
    MockAToken internal aUSDC;
    CapRegistry internal caps;
    SparkPointVault internal vault;

    address internal guardian = makeAddr("guardian");
    address internal governance = makeAddr("governance");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    // Overridable caps. The defaults are LARGER than the real CapRegistry ceilings so the shared,
    // non-cap-focused suites (perf-fee, ERC-4626 correctness, non-custody / perf-fee invariants) can
    // deposit large single-user amounts (up to 500_000e6) — those suites are not testing caps. The
    // cap-focused CapsInvariantTest OVERRIDES these with tight, within-ceiling values to exercise the
    // vault's min(perUser,total,vault) enforcement against the real bounded CapRegistry.
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
        pool = new MockAavePool(usdc);
        aUSDC = pool.aToken();

        // `caps` is ALWAYS a real, bounded CapRegistry (values clamped to its ceilings). It backs any
        // `address(caps)` reference (e.g. AccrueRevertVault, whose deposits are <= the per-user cap).
        caps = new CapRegistry(
            governance,
            _min(capPerUser(), 10_000 * ONE_USDC),
            _min(capTotal(), 5_000_000 * ONE_USDC),
            _min(capVault(), 5_000_000 * ONE_USDC)
        );

        // The MAIN vault's registry: the real bounded `caps` when the suite requested within-ceiling
        // (cap-testing) values, else a permissive registry so non-cap fuzz deposits are not gated.
        address reg = _capsFitCeilings()
            ? address(caps)
            : address(new MockCapRegistry(capPerUser(), capTotal(), capVault()));

        vault = new SparkPointVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            reg,
            feeRecipient,
            DEFAULT_FEE_BPS
        );
    }

    /// @dev True when every requested cap fits within the real CapRegistry's hard ceilings — i.e. the
    ///      suite is exercising cap behaviour and the main vault should read the bounded registry.
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

    /// @notice Simulate realized Aave interest of `amount` USDC accruing to the vault's aUSDC claim.
    function _simulateYield(uint256 amount) internal {
        pool.accrueTo(address(vault), amount);
    }

    /// @notice Current assets-per-share (1e18-scaled) — the HWM/price probe used across §6.1.
    function _pps() internal view returns (uint256) {
        return vault.convertToAssets(WAD);
    }
}
