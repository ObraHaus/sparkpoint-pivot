// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import { SparkPointUniversalVault } from "../../src/vault/SparkPointUniversalVault.sol";
import { SparkPointVaultFactoryV2 } from "../../src/factory/SparkPointVaultFactoryV2.sol";
import { ISparkPointVaultFactoryV2 } from "../../src/interfaces/ISparkPointVaultFactoryV2.sol";
import { ISparkPointUniversalVault } from "../../src/interfaces/ISparkPointUniversalVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { MockERC20 } from "../mocks/Mocks.sol";
import { MockERC4626 } from "../mocks/MockERC4626.sol";

/// @notice Feature 049 — the universal wrapper: binding, fee invariants, N2 exit, caps, upgrades.
contract UniversalVaultTest is Test {
    MockERC20 internal usdc;
    MockERC4626 internal child;

    SparkPointUniversalVault internal implementation;
    UpgradeableBeacon internal beacon;
    SparkPointVaultFactoryV2 internal factory;
    SparkPointUniversalVault internal vault;

    address internal owner = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal feeRecipient = makeAddr("treasury");
    address internal deployer = makeAddr("ai-deployer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint16 internal constant FEE_BPS = 1000; // 10%
    uint256 internal constant PER_USER = 1_000e6;
    uint256 internal constant TOTAL = 100_000e6;
    uint256 internal constant VAULT_CAP = 100_000e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        child = new MockERC4626(IERC20(address(usdc)), "Child USDC", "chUSDC");

        implementation = new SparkPointUniversalVault();
        beacon = new UpgradeableBeacon(address(implementation), owner);

        // Fundless factory behind a UUPS proxy (owner = the timelock stand-in).
        SparkPointVaultFactoryV2 factoryImpl = new SparkPointVaultFactoryV2();
        bytes memory init = abi.encodeCall(
            SparkPointVaultFactoryV2.initialize, (owner, address(beacon), guardian, feeRecipient)
        );
        factory = SparkPointVaultFactoryV2(address(new ERC1967Proxy(address(factoryImpl), init)));

        vm.startPrank(owner);
        factory.setAllowlisted(address(child), true);
        factory.setDeployer(deployer, true);
        vm.stopPrank();

        vault = _createVault(keccak256("v1"));

        for (uint256 i = 0; i < 2; i++) {
            address user = i == 0 ? alice : bob;
            usdc.mint(user, 1_000e6);
            vm.prank(user);
            usdc.approve(address(vault), type(uint256).max);
            vm.prank(user);
            usdc.approve(address(child), type(uint256).max);
        }
    }

    function _createVault(bytes32 salt) internal returns (SparkPointUniversalVault v) {
        vm.prank(deployer);
        address proxy = factory.createVault(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(child)),
                feeBps: FEE_BPS,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "SparkPoint Universal USDC",
                symbol: "spuUSDC",
                label: "Test curated vault",
                salt: salt
            })
        );
        v = SparkPointUniversalVault(proxy);
    }

    function _deposit(address user, uint256 assets) internal returns (uint256 shares) {
        vm.prank(user);
        shares = vault.deposit(assets, user);
    }

    // ── binding + factory gates ────────────────────────────────────────────────

    function test_deploy_binds_child_and_records_provenance() public view {
        assertEq(vault.child(), address(child));
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.guardian(), guardian);
        assertEq(vault.factory(), address(factory));
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.performanceFeeBps(), FEE_BPS);
        assertEq(vault.label(), "Test curated vault");
        assertEq(vault.entryFeeBasisPoints(), 0);
        assertEq(vault.exitFeeBasisPoints(), 0);
        assertEq(vault.managementFeeBasisPoints(), 0);
        assertEq(vault.MAX_PERFORMANCE_FEE_BPS(), 2000);
    }

    function test_predict_matches_deployed_address() public {
        bytes32 salt = keccak256("predict-me");
        address predicted = factory.predictVaultAddress(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(child)),
                feeBps: FEE_BPS,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "SparkPoint Universal USDC",
                symbol: "spuUSDC",
                label: "Test curated vault",
                salt: salt
            })
        );
        SparkPointUniversalVault v = _createVault(salt);
        assertEq(address(v), predicted);
    }

    function test_only_deployer_can_create() public {
        vm.prank(alice);
        vm.expectRevert(SparkPointVaultFactoryV2.NotDeployer.selector);
        factory.createVault(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(child)),
                feeBps: FEE_BPS,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "x",
                symbol: "x",
                label: "x",
                salt: keccak256("no")
            })
        );
    }

    function test_non_allowlisted_child_is_refused() public {
        MockERC4626 other = new MockERC4626(IERC20(address(usdc)), "Other", "oth");
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactoryV2.NotAllowlisted.selector, address(other))
        );
        factory.createVault(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(other)),
                feeBps: FEE_BPS,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "x",
                symbol: "x",
                label: "x",
                salt: keccak256("no2")
            })
        );
    }

    function test_fee_above_cap_is_refused() public {
        vm.prank(deployer);
        vm.expectRevert(SparkPointVaultFactoryV2.FeeExceedsCap.selector);
        factory.createVault(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(child)),
                feeBps: 2001,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "x",
                symbol: "x",
                label: "x",
                salt: keccak256("no3")
            })
        );
    }

    function test_deploy_limit_makes_spam_loud() public {
        vm.prank(owner);
        factory.setDeployLimit(1);
        _createVault(keccak256("limit-1"));
        vm.prank(deployer);
        vm.expectRevert(SparkPointVaultFactoryV2.DeployLimitReached.selector);
        factory.createVault(
            ISparkPointVaultFactoryV2.CreateVaultParams({
                child: IERC4626(address(child)),
                feeBps: FEE_BPS,
                perUserCap: PER_USER,
                totalCap: TOTAL,
                vaultCap: VAULT_CAP,
                name: "x",
                symbol: "x",
                label: "x",
                salt: keccak256("limit-2")
            })
        );
    }

    // ── initializer guards ─────────────────────────────────────────────────────

    function test_implementation_cannot_be_initialized() public {
        // Build params FIRST: `expectRevert` applies to the very next external call, and
        // `_initParams()` itself makes one (vault.capRegistry()).
        ISparkPointUniversalVault.InitParams memory params = _initParams();
        vm.expectRevert();
        implementation.initialize(params);
    }

    function test_proxy_cannot_be_initialized_twice() public {
        ISparkPointUniversalVault.InitParams memory params = _initParams();
        vm.expectRevert();
        vault.initialize(params);
    }

    function _initParams() internal view returns (ISparkPointUniversalVault.InitParams memory) {
        return ISparkPointUniversalVault.InitParams({
            asset: IERC20(address(usdc)),
            child: IERC4626(address(child)),
            guardian: guardian,
            factory: address(factory),
            capRegistry: vault.capRegistry(),
            feeRecipient: feeRecipient,
            performanceFeeBps: FEE_BPS,
            name: "x",
            symbol: "x",
            label: "x"
        });
    }

    // ── deposit / withdraw (N2) ────────────────────────────────────────────────

    function test_deposit_and_withdraw_roundtrip() public {
        uint256 shares = _deposit(alice, 100e6);
        assertGt(shares, 0);
        assertEq(child.balanceOf(address(vault)) > 0, true);

        uint256 maxOut = vault.maxWithdraw(alice);
        vm.prank(alice);
        vault.withdraw(maxOut, alice, alice);
        assertGe(usdc.balanceOf(alice), 1_000e6 - 2);
    }

    function test_pause_blocks_deposits_but_never_withdrawals() public {
        _deposit(alice, 100e6);

        vm.prank(guardian);
        vault.pauseDeposits();

        vm.prank(bob);
        vm.expectRevert(SparkPointUniversalVault.DepositsArePaused.selector);
        vault.deposit(10e6, bob);

        // N2: the pause must NOT gate the exit.
        uint256 maxOut = vault.maxWithdraw(alice);
        assertGt(maxOut, 0);
        vm.prank(alice);
        vault.withdraw(maxOut, alice, alice);
    }

    function test_withdraw_works_when_child_max_views_are_zero() public {
        _deposit(alice, 100e6);
        child.setZeroMaxViews(true);
        // The wrapper's liquidity fallback keeps the escape hatch open.
        uint256 maxOut = vault.maxWithdraw(alice);
        assertGt(maxOut, 0);
        vm.prank(alice);
        vault.withdraw(maxOut, alice, alice);
        assertGe(usdc.balanceOf(alice), 1_000e6 - 2);
    }

    // ── fee invariants (performance-only, above HWM) ───────────────────────────

    function test_no_fee_at_flat_or_after_loss() public {
        _deposit(alice, 100e6);
        uint256 supplyBefore = vault.totalSupply();

        // Flat: nothing accrued (beyond any dust rounding, which the fee floor refuses).
        vault.accrueFee();
        assertEq(vault.totalSupply(), supplyBefore);

        // Loss: share price drops, still no fee.
        child.skim(address(this), 50e6);
        vault.accrueFee();
        assertEq(vault.totalSupply(), supplyBefore);
    }

    function test_fee_only_on_gains_above_the_high_water_mark() public {
        _deposit(alice, 1_000e6);
        uint256 supplyBefore = vault.totalSupply();

        // +10% yield -> fee shares minted to the recipient.
        usdc.mint(address(child), 100e6);
        vault.accrueFee();
        uint256 supplyAfterGain = vault.totalSupply();
        assertGt(supplyAfterGain, supplyBefore);

        uint256 recipientClaim = vault.convertToAssets(vault.balanceOf(feeRecipient));
        assertApproxEqRel(recipientClaim, 10e6, 0.05e18); // ~10% of the 100e6 gain

        // Loss below the new HWM -> no further fee.
        child.skim(address(this), 100e6);
        vault.accrueFee();
        assertEq(vault.totalSupply(), supplyAfterGain);

        // Partial recovery, still below the HWM -> no fee.
        usdc.mint(address(child), 50e6);
        vault.accrueFee();
        assertEq(vault.totalSupply(), supplyAfterGain);
    }

    function test_fee_never_touches_principal() public {
        _deposit(alice, 1_000e6);
        vault.accrueFee(); // flat
        uint256 maxOut = vault.maxWithdraw(alice);
        vm.prank(alice);
        vault.withdraw(maxOut, alice, alice);
        assertGe(usdc.balanceOf(alice), 1_000e6 - 2);
    }

    function test_donation_does_not_move_the_share_price() public {
        _deposit(alice, 100e6);
        uint256 ppsBefore = vault.convertToAssets(1e18);
        usdc.mint(address(vault), 50e6); // raw donation to the wrapper itself
        assertEq(vault.totalAssets(), 100e6);
        assertEq(vault.convertToAssets(1e18), ppsBefore);
    }

    // ── caps + slippage ────────────────────────────────────────────────────────

    function test_caps_limit_deposits() public {
        CapRegistry reg = CapRegistry(vault.capRegistry());
        vm.prank(owner); // owner() of the factory is also the CapRegistry governance
        reg.setPerUserCap(50e6);
        assertEq(vault.maxDeposit(alice), 50e6);
        _deposit(alice, 50e6);
        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(alice);
        vm.expectRevert(SparkPointUniversalVault.CapExceeded.selector);
        vault.deposit(1e6, alice);
    }

    function test_min_shares_out_slippage() public {
        vm.prank(alice);
        vm.expectRevert(SparkPointUniversalVault.SlippageExceeded.selector);
        vault.deposit(100e6, alice, type(uint256).max);
    }

    // ── upgrades (beacon is the only path; never an asset path) ────────────────

    function test_beacon_upgrade_preserves_state_and_only_owner_may_upgrade() public {
        _deposit(alice, 100e6);
        uint256 sharesBefore = vault.balanceOf(alice);
        uint256 suppliedBefore = child.balanceOf(address(vault));

        SparkPointUniversalVault newImpl = new SparkPointUniversalVault();
        vm.prank(alice);
        vm.expectRevert();
        beacon.upgradeTo(address(newImpl));

        vm.prank(owner);
        beacon.upgradeTo(address(newImpl));

        assertEq(vault.balanceOf(alice), sharesBefore);
        assertEq(child.balanceOf(address(vault)), suppliedBefore);
        assertEq(vault.child(), address(child)); // the upgrade cannot re-point the child
        assertEq(beacon.implementation(), address(newImpl));
    }

    function test_factory_upgrade_only_owner() public {
        SparkPointVaultFactoryV2 newImpl = new SparkPointVaultFactoryV2();
        vm.prank(alice);
        vm.expectRevert();
        factory.upgradeToAndCall(address(newImpl), "");
        vm.prank(owner);
        factory.upgradeToAndCall(address(newImpl), "");
        assertEq(factory.guardian(), guardian);
    }

    // ── governance guards ──────────────────────────────────────────────────────

    function test_only_guardian_can_change_bounded_params() public {
        vm.prank(alice);
        vm.expectRevert(SparkPointUniversalVault.NotGuardian.selector);
        vault.setPerformanceFeeBps(500);

        vm.prank(guardian);
        vault.setPerformanceFeeBps(500);
        assertEq(vault.performanceFeeBps(), 500);

        vm.prank(guardian);
        vm.expectRevert(SparkPointUniversalVault.FeeExceedsCap.selector);
        vault.setPerformanceFeeBps(2001);
    }
}
