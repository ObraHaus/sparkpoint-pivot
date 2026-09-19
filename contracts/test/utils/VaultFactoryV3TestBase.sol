// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { SparkPointUniversalVault } from "../../src/vault/SparkPointUniversalVault.sol";
import { SparkPointVaultFactoryV3 } from "../../src/factory/SparkPointVaultFactoryV3.sol";
import { ISparkPointVaultFactoryV3 } from "../../src/interfaces/ISparkPointVaultFactoryV3.sol";
import { MockERC20 } from "../mocks/Mocks.sol";
import { MockERC4626 } from "../mocks/MockERC4626.sol";

/// @notice Shared rig for the SparkPointVaultFactoryV3 suites (feature 049, amendment v4.1.0):
///         USDC + one honest ERC-4626 child + the timelock-owned beacon + the V3 factory behind a
///         Transparent proxy with the three roles granted atomically in the initializer.
abstract contract VaultFactoryV3TestBase is Test {
    uint256 internal constant ONE_USDC = 1e6;

    MockERC20 internal usdc;
    MockERC4626 internal child;

    SparkPointUniversalVault internal implementation;
    UpgradeableBeacon internal beacon;
    SparkPointVaultFactoryV3 internal factory;

    address internal timelock = makeAddr("timelock"); // DEFAULT_ADMIN_ROLE (the TimelockController)
    address internal admin = makeAddr("operator-admin"); // ADMIN_ROLE (operator EOA)
    address internal ai = makeAddr("ai-deployer"); // DEPLOYER_ROLE (scoped AI runner)
    address internal guardian = makeAddr("guardian");
    address internal feeRecipient = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    uint16 internal constant FEE_BPS = 1000; // 10%
    uint256 internal constant PER_USER = 1_000e6;
    uint256 internal constant TOTAL = 100_000e6;
    uint256 internal constant VAULT_CAP = 100_000e6;

    function setUp() public virtual {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        child = new MockERC4626(IERC20(address(usdc)), "Child USDC", "chUSDC");

        implementation = new SparkPointUniversalVault();
        beacon = new UpgradeableBeacon(address(implementation), timelock);

        factory = _deployFactory(timelock, admin, ai, address(beacon), guardian, feeRecipient);
    }

    /// @dev Deploys a fresh implementation + Transparent proxy (ProxyAdmin owner = the timelock
    ///      stand-in) with the six initializer args, exactly as the V.3 deploy script will.
    function _deployFactory(
        address defaultAdmin_,
        address admin_,
        address deployer_,
        address beacon_,
        address guardian_,
        address feeRecipient_
    ) internal returns (SparkPointVaultFactoryV3) {
        SparkPointVaultFactoryV3 impl = new SparkPointVaultFactoryV3();
        bytes memory init = abi.encodeCall(
            SparkPointVaultFactoryV3.initialize,
            (defaultAdmin_, admin_, deployer_, beacon_, guardian_, feeRecipient_)
        );
        return SparkPointVaultFactoryV3(
            address(new TransparentUpgradeableProxy(address(impl), defaultAdmin_, init))
        );
    }

    function _newChild() internal returns (MockERC4626 c) {
        c = new MockERC4626(IERC20(address(usdc)), "Child 2", "ch2");
    }

    function _params(address child_, bytes32 salt)
        internal
        view
        returns (ISparkPointVaultFactoryV3.CreateVaultParams memory)
    {
        return ISparkPointVaultFactoryV3.CreateVaultParams({
            child: IERC4626(child_),
            feeBps: FEE_BPS,
            perUserCap: PER_USER,
            totalCap: TOTAL,
            vaultCap: VAULT_CAP,
            name: "SparkPoint Universal USDC",
            symbol: "spuUSDC",
            label: "Test curated vault",
            salt: salt
        });
    }
}
