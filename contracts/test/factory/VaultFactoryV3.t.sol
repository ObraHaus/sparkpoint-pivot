// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { SparkPointVaultFactoryV3 } from "../../src/factory/SparkPointVaultFactoryV3.sol";
import { ISparkPointVaultFactoryV3 } from "../../src/interfaces/ISparkPointVaultFactoryV3.sol";
import { SparkPointUniversalVault } from "../../src/vault/SparkPointUniversalVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { MockERC4626 } from "../mocks/MockERC4626.sol";
import { VaultFactoryV3TestBase } from "../utils/VaultFactoryV3TestBase.sol";

/// @title VaultFactoryV3Test — core factory obligations for `SparkPointVaultFactoryV3` (V.2/049).
/// @notice Initializer role grants (atomic), RBAC separation (the timelock cannot admit; the admin
///         cannot touch non-admission params), the deploy path's provenance/CapRegistry wiring, fee
///         and child validation, the rolling deploy limit, N1 (no value), and the timelock-only
///         upgrade path. The admission lifecycle lives in `VaultFactoryV3Admission.t.sol`.
contract VaultFactoryV3Test is VaultFactoryV3TestBase {
    event VaultCreated(
        address indexed child,
        address indexed proxy,
        address capRegistry,
        address indexed deployer,
        uint16 feeBps,
        string label
    );

    // ── initializer + role grants ──────────────────────────────────────────────

    function test_initializer_grantsTheThreeRolesAtomically() public view {
        assertTrue(
            factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), timelock), "timelock is role admin"
        );
        assertTrue(factory.hasRole(factory.ADMIN_ROLE(), admin), "operator EOA is ADMIN_ROLE");
        assertTrue(factory.hasRole(factory.DEPLOYER_ROLE(), ai), "AI key is DEPLOYER_ROLE");
    }

    function test_initializer_separatesPowers() public view {
        // The timelock is deliberately NOT in the admission lane.
        assertFalse(factory.hasRole(factory.ADMIN_ROLE(), timelock), "timelock must not be ADMIN");
        assertFalse(
            factory.hasRole(factory.DEPLOYER_ROLE(), timelock), "timelock must not be DEPLOYER"
        );
        // The admin EOA cannot widen its own powers.
        assertFalse(
            factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), admin), "admin must not be role admin"
        );
        assertFalse(factory.hasRole(factory.DEPLOYER_ROLE(), admin), "admin must not be DEPLOYER");
        // The AI key is admission-only.
        assertFalse(factory.hasRole(factory.ADMIN_ROLE(), ai), "AI must not be ADMIN");
        assertFalse(factory.hasRole(factory.DEFAULT_ADMIN_ROLE(), ai), "AI must not be role admin");
    }

    function test_initializer_setsFleetDefaults() public view {
        assertEq(factory.beacon(), address(beacon));
        assertEq(factory.guardian(), guardian);
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.timelock(), timelock, "recorded CapRegistry governance");
        assertEq(factory.cooldown(), factory.DEFAULT_COOLDOWN(), "default cooldown is 24h");
        assertEq(factory.DEFAULT_COOLDOWN(), 24 hours);
        assertEq(factory.MIN_COOLDOWN(), 1 hours);
        assertEq(factory.MAX_COOLDOWN(), 7 days);
        assertEq(factory.deployLimit(), 0, "unlimited until the timelock sets one");
    }

    function test_implementation_cannot_be_initialized() public {
        SparkPointVaultFactoryV3 impl = new SparkPointVaultFactoryV3();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(timelock, admin, ai, address(beacon), guardian, feeRecipient);
    }

    function test_proxy_cannot_be_initialized_twice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        factory.initialize(timelock, admin, ai, address(beacon), guardian, feeRecipient);
    }

    function test_initialize_revertsOnZeroAddress() public {
        address[6] memory defaults = [timelock, admin, ai, address(beacon), guardian, feeRecipient];
        for (uint256 i; i < 6; ++i) {
            address[6] memory args = defaults;
            args[i] = address(0);
            SparkPointVaultFactoryV3 impl = new SparkPointVaultFactoryV3();
            bytes memory init = abi.encodeCall(
                SparkPointVaultFactoryV3.initialize,
                (args[0], args[1], args[2], args[3], args[4], args[5])
            );
            vm.expectRevert(SparkPointVaultFactoryV3.ZeroAddress.selector);
            new TransparentUpgradeableProxy(address(impl), timelock, init);
        }
    }

    function test_initialize_revertsOnDuplicateRoleHolder() public {
        _expectInitRevert(timelock, timelock, ai);
        _expectInitRevert(timelock, admin, timelock);
        _expectInitRevert(timelock, admin, admin);
    }

    /// @dev `expectRevert` must sit directly before the reverting create — the impl deploy is done
    ///      first so the cheatcode cannot be consumed by a successful call.
    function _expectInitRevert(address defaultAdmin_, address admin_, address deployer_) internal {
        SparkPointVaultFactoryV3 impl = new SparkPointVaultFactoryV3();
        bytes memory init = abi.encodeCall(
            SparkPointVaultFactoryV3.initialize,
            (defaultAdmin_, admin_, deployer_, address(beacon), guardian, feeRecipient)
        );
        vm.expectRevert(SparkPointVaultFactoryV3.DuplicateRoleHolder.selector);
        new TransparentUpgradeableProxy(address(impl), timelock, init);
    }

    // ── RBAC ───────────────────────────────────────────────────────────────────

    function test_roleAdmin_isTimelock_only() public {
        // Neither the operator admin nor a stranger can grant roles.
        bytes32 roleAdmin = factory.DEFAULT_ADMIN_ROLE();
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, roleAdmin
            )
        );
        factory.grantRole(admissionAdminRole, stranger);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, roleAdmin
            )
        );
        factory.revokeRole(admissionAdminRole, admin);

        // The timelock can grant and revoke; revocation bites immediately.
        vm.startPrank(timelock);
        factory.grantRole(factory.ADMIN_ROLE(), stranger);
        factory.revokeRole(factory.ADMIN_ROLE(), admin);
        vm.stopPrank();
        assertTrue(factory.hasRole(factory.ADMIN_ROLE(), stranger));
        assertFalse(factory.hasRole(factory.ADMIN_ROLE(), admin));
    }

    function test_timelock_cannotAdmitOrDeploy() public {
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(timelock);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                timelock,
                admissionAdminRole
            )
        );
        factory.whitelistVault(address(child));

        vm.prank(timelock);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                timelock,
                admissionAdminRole
            )
        );
        factory.createVault(_params(address(child), keccak256("timelock")));
    }

    function test_admin_cannotChangeNonAdmissionParams() public {
        vm.startPrank(admin);
        bytes32 adminRole = factory.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, adminRole
            )
        );
        factory.setBeacon(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, adminRole
            )
        );
        factory.setGuardian(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, adminRole
            )
        );
        factory.setFeeRecipient(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, adminRole
            )
        );
        factory.setDeployLimit(1);
        vm.stopPrank();
    }

    function test_deployer_cannotChangeNonAdmissionNorAdminParams() public {
        vm.startPrank(ai);
        bytes32 adminRole = factory.DEFAULT_ADMIN_ROLE();
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, adminRole
            )
        );
        factory.setBeacon(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.setCooldown(1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.unwhitelist(address(child));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, ai, admissionAdminRole
            )
        );
        factory.releaseNow(address(child));
        vm.stopPrank();
    }

    function test_defaultAdmin_updatesNonAdmissionParams() public {
        address newBeacon = makeAddr("new-beacon");
        address newGuardian = makeAddr("new-guardian");
        address newFeeRecipient = makeAddr("new-treasury");

        vm.startPrank(timelock);
        factory.setBeacon(newBeacon);
        factory.setGuardian(newGuardian);
        factory.setFeeRecipient(newFeeRecipient);
        factory.setDeployLimit(3);
        vm.stopPrank();

        assertEq(factory.beacon(), newBeacon);
        assertEq(factory.guardian(), newGuardian);
        assertEq(factory.feeRecipient(), newFeeRecipient);
        assertEq(factory.deployLimit(), 3);
    }

    function test_nonAdmissionParams_rejectZeroAddress() public {
        vm.startPrank(timelock);
        vm.expectRevert(SparkPointVaultFactoryV3.ZeroAddress.selector);
        factory.setBeacon(address(0));
        vm.expectRevert(SparkPointVaultFactoryV3.ZeroAddress.selector);
        factory.setGuardian(address(0));
        vm.expectRevert(SparkPointVaultFactoryV3.ZeroAddress.selector);
        factory.setFeeRecipient(address(0));
        vm.stopPrank();
    }

    // ── deploy path ────────────────────────────────────────────────────────────

    function test_adminDeploy_bindsChildWiresCapRegistryAndRecordsProvenance() public {
        address predicted = factory.predictVaultAddress(_params(address(child), keccak256("v1")));
        assertEq(predicted.code.length, 0, "predicted address must be empty pre-deploy");

        vm.prank(admin);
        factory.whitelistVault(address(child));

        vm.expectEmit(true, true, true, false, address(factory));
        emit VaultCreated(address(child), predicted, predicted, admin, 0, "");
        vm.prank(admin);
        address proxy = factory.createVault(_params(address(child), keccak256("v1")));

        assertEq(proxy, predicted, "deployed proxy must equal predictVaultAddress");
        SparkPointUniversalVault vault = SparkPointUniversalVault(proxy);
        assertEq(vault.child(), address(child), "child bound");
        assertEq(vault.asset(), address(usdc), "asset inherited from the child");
        assertEq(vault.factory(), address(factory), "factory provenance");
        assertEq(vault.guardian(), guardian, "guardian == factory guardian");
        assertEq(vault.feeRecipient(), feeRecipient, "fee recipient wired");
        assertEq(vault.performanceFeeBps(), FEE_BPS, "fee wired");
        assertEq(
            CapRegistry(vault.capRegistry()).governance(),
            timelock,
            "CapRegistry governance is the timelock, not an EOA"
        );

        assertEq(factory.wrapperOf(address(child)), proxy, "wrapperOf recorded");
        (, uint64 readyAt) = factory.whitelistOf(address(child));
        assertEq(readyAt, 0, "admission consumed");
        assertFalse(factory.isWhitelisted(address(child)), "entry consumed by createVault");
        assertEq(address(factory).balance, 0, "N1: factory holds no funds");
    }

    function test_predict_matches_deployed() public {
        bytes32 salt = keccak256("predict-me");
        address predicted = factory.predictVaultAddress(_params(address(child), salt));
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        address proxy = factory.createVault(_params(address(child), salt));
        vm.stopPrank();
        assertEq(proxy, predicted);
    }

    function test_createVault_revertsFromStranger() public {
        bytes32 admissionAdminRole = factory.ADMIN_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                admissionAdminRole
            )
        );
        factory.createVault(_params(address(child), keccak256("stranger")));
    }

    function test_createVault_revertsWhenNotWhitelisted() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactoryV3.NotWhitelisted.selector, address(child))
        );
        factory.createVault(_params(address(child), keccak256("not-whitelisted")));
    }

    function test_createVault_requiresNonZeroSalt() public {
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        vm.expectRevert(SparkPointVaultFactoryV3.SaltRequired.selector);
        factory.createVault(_params(address(child), bytes32(0)));
        vm.stopPrank();
    }

    function test_createVault_revertsWhenFeeExceedsCap() public {
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        ISparkPointVaultFactoryV3.CreateVaultParams memory p =
            _params(address(child), keccak256("fee"));
        p.feeBps = 2001;
        vm.expectRevert(SparkPointVaultFactoryV3.FeeExceedsCap.selector);
        factory.createVault(p);
        vm.stopPrank();
    }

    function test_createVault_acceptsFeeAtExactCap() public {
        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        ISparkPointVaultFactoryV3.CreateVaultParams memory p =
            _params(address(child), keccak256("fee-cap"));
        p.feeBps = 2000;
        address proxy = factory.createVault(p);
        vm.stopPrank();
        assertEq(SparkPointUniversalVault(proxy).performanceFeeBps(), 2000);
    }

    function test_createVault_rejectsInvalidChildren() public {
        _expectInvalidChild(address(0xBEEF), keccak256("no-code"));
        _expectInvalidChild(address(new ZeroAssetChild()), keccak256("zero-asset"));
        _expectInvalidChild(
            address(new HighDecimalsChild(address(usdc))), keccak256("high-decimals")
        );
        _expectInvalidChild(
            address(new ZeroConversionChild(address(usdc))), keccak256("zero-conversion")
        );
        _expectInvalidChild(
            address(new RevertingConversionChild(address(usdc))), keccak256("reverting")
        );
    }

    function test_deployLimit_isRollingAndAppliesToBothAdmissionRoles() public {
        MockERC4626 second = _newChild();

        vm.prank(timelock);
        factory.setDeployLimit(1);

        vm.startPrank(admin);
        factory.setCooldown(1 hours); // keep the AI entry inside the same 1-day window
        factory.whitelistVault(address(child));
        factory.createVault(_params(address(child), keccak256("limit-1")));
        vm.stopPrank();

        vm.prank(ai);
        factory.whitelistVault(address(second));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(ai);
        vm.expectRevert(SparkPointVaultFactoryV3.DeployLimitReached.selector);
        factory.createVault(_params(address(second), keccak256("limit-2")));

        // The window rolls after a day: the same entry deploys without a new admission.
        vm.warp(block.timestamp + 1 days);
        vm.prank(ai);
        address proxy = factory.createVault(_params(address(second), keccak256("limit-2")));
        assertEq(factory.wrapperOf(address(second)), proxy);
    }

    // ── N1: no value, no fund path ─────────────────────────────────────────────

    function test_factory_rejectsValue() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(factory).call{ value: 1 }("");
        assertFalse(ok, "N1: factory must reject a bare value transfer (no receive/fallback)");

        vm.startPrank(admin);
        factory.whitelistVault(address(child));
        (bool ok2,) = address(factory).call{ value: 1 }(
            abi.encodeCall(factory.createVault, (_params(address(child), keccak256("value"))))
        );
        vm.stopPrank();
        assertFalse(ok2, "N1: createVault must reject value (non-payable)");
        assertEq(address(factory).balance, 0, "N1: factory balance stays 0");
    }

    // ── upgrade path (timelock only) ───────────────────────────────────────────

    function test_factory_upgrade_onlyTimelock() public {
        bytes32 proxyAdminSlot = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
        ProxyAdmin proxyAdmin =
            ProxyAdmin(address(uint160(uint256(vm.load(address(factory), proxyAdminSlot)))));
        SparkPointVaultFactoryV3 newImpl = new SparkPointVaultFactoryV3();

        vm.prank(admin);
        vm.expectRevert();
        proxyAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(factory)), address(newImpl), ""
        );

        vm.prank(timelock);
        proxyAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(factory)), address(newImpl), ""
        );
        assertEq(factory.guardian(), guardian);
        assertEq(factory.cooldown(), factory.DEFAULT_COOLDOWN());
        assertTrue(factory.hasRole(factory.ADMIN_ROLE(), admin), "roles survive the upgrade");
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    function _expectInvalidChild(address badChild, bytes32 salt) internal {
        ISparkPointVaultFactoryV3.CreateVaultParams memory p = _params(badChild, salt);
        vm.startPrank(admin);
        factory.whitelistVault(badChild);
        vm.expectRevert(SparkPointVaultFactoryV3.InvalidChild.selector);
        factory.createVault(p);
        vm.stopPrank();
    }
}

/// @dev Invalid-child probes: each one fails a different `_validateChild` branch.
contract ZeroAssetChild {
    function asset() external pure returns (address) {
        return address(0);
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        return 1;
    }
}

contract HighDecimalsChild {
    address internal immutable _asset;

    constructor(address asset_) {
        _asset = asset_;
    }

    function asset() external view returns (address) {
        return _asset;
    }

    function decimals() external pure returns (uint8) {
        return 37;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        return 1;
    }
}

contract ZeroConversionChild {
    address internal immutable _asset;

    constructor(address asset_) {
        _asset = asset_;
    }

    function asset() external view returns (address) {
        return _asset;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        return 0;
    }
}

contract RevertingConversionChild {
    address internal immutable _asset;

    constructor(address asset_) {
        _asset = asset_;
    }

    function asset() external view returns (address) {
        return _asset;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        revert("no conversion");
    }
}
