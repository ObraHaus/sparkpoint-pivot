// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { KillSwitch } from "../src/governance/KillSwitch.sol";
import { SparkPointVaultFactory } from "../src/factory/SparkPointVaultFactory.sol";
import { ISparkPointVaultFactory } from "../src/interfaces/ISparkPointVaultFactory.sol";
import { MockERC20, MockMorphoVault } from "./mocks/Mocks.sol";

/// @title DeployDeterminismTest — proves the deploy script's fixed CREATE2 salt gives DETERMINISTIC
///        addresses, so redeploys of the same bytecode + constructor args + deployer don't churn
///        contract addresses. CREATE2 changes only the deploy METHOD; the runtime bytecode is
///        unchanged and nothing becomes upgradeable (the vault stays immutable + non-custodial).
contract DeployDeterminismTest is Test {
    // Must match DeploySepolia.SALT.
    bytes32 internal constant SALT = keccak256("sparkpoint-core-v1");
    // Must match DeployMorphoWrapperFactory.SALT.
    bytes32 internal constant FACTORY_SALT = keccak256("sparkpoint-morpho-factory-v1");
    address internal guardian = makeAddr("guardian");
    address internal owner = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");

    function test_create2AddressIsDeterministic() public {
        KillSwitch a = new KillSwitch{ salt: SALT }(guardian);
        // The deployed address is a PURE function of (salt, initcode, deployer) — so the same
        // bytecode + args + salt + deployer always lands at the SAME address (no churn on redeploy).
        bytes32 initHash = keccak256(abi.encodePacked(type(KillSwitch).creationCode, abi.encode(guardian)));
        // 3-arg form: this test contract is the CREATE2 deployer here (in the real script it's the
        // canonical 0x4e59… factory, which is likewise deterministic).
        assertEq(
            address(a),
            vm.computeCreate2Address(SALT, initHash, address(this)),
            "not the deterministic address"
        );
    }

    function test_differentArgsYieldDifferentAddress() public {
        KillSwitch a = new KillSwitch{ salt: SALT }(guardian);
        KillSwitch b = new KillSwitch{ salt: SALT }(makeAddr("other-guardian"));
        // A genuinely different deployment (different constructor args) correctly gets a new address.
        assertTrue(address(a) != address(b), "different args must yield a different address");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 011 (T018) — the factory + a wrapper deploy at their predicted CREATE2 addresses
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev The factory itself lands at its fixed-salt CREATE2 address (this test contract is the
    ///      deployer here; the script uses the canonical 0x4e59… factory, likewise deterministic).
    function test_factory_create2AddressIsDeterministic() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        SparkPointVaultFactory factory =
            new SparkPointVaultFactory{ salt: FACTORY_SALT }(owner, IERC20(address(usdc)), guardian, feeRecipient);

        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(SparkPointVaultFactory).creationCode,
                abi.encode(owner, IERC20(address(usdc)), guardian, feeRecipient)
            )
        );
        assertEq(
            address(factory),
            vm.computeCreate2Address(FACTORY_SALT, initHash, address(this)),
            "factory not at its deterministic CREATE2 address"
        );
    }

    /// @dev A wrapper deployed by the factory lands EXACTLY at predictVaultAddress — the same
    ///      full-bytecode CREATE2 determinism, now proven end-to-end through the factory's own predictor.
    function test_wrapper_landsAtPredictedCreate2Address() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockMorphoVault morpho = new MockMorphoVault(usdc);
        SparkPointVaultFactory factory =
            new SparkPointVaultFactory(owner, IERC20(address(usdc)), guardian, feeRecipient);

        vm.prank(owner);
        factory.allowlistMorphoVault(address(morpho), true);

        ISparkPointVaultFactory.Caps memory caps =
            ISparkPointVaultFactory.Caps({ perAddressCap: 5_000e6, totalCap: 1_000_000e6 });
        string memory label = "SparkPoint Morpho USDC";

        address predicted = factory.predictVaultAddress(address(morpho), 1000, caps, label);
        vm.prank(owner);
        address vault = factory.createVault(address(morpho), 1000, caps, label);

        assertEq(vault, predicted, "wrapper must deploy at its predicted CREATE2 address");
        assertGt(vault.code.length, 1000, "wrapper is full bytecode (not a minimal proxy)");
    }

    /// @dev Different constructor args (different feeBps ⇒ different init code) ⇒ a different predicted
    ///      address, even at the same (morphoVault,label) salt.
    function test_wrapper_differentFeeBps_predictsDifferentAddress() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockMorphoVault morpho = new MockMorphoVault(usdc);
        SparkPointVaultFactory factory =
            new SparkPointVaultFactory(owner, IERC20(address(usdc)), guardian, feeRecipient);

        ISparkPointVaultFactory.Caps memory caps =
            ISparkPointVaultFactory.Caps({ perAddressCap: 5_000e6, totalCap: 1_000_000e6 });
        string memory label = "SparkPoint Morpho USDC";

        address p1 = factory.predictVaultAddress(address(morpho), 1000, caps, label);
        address p2 = factory.predictVaultAddress(address(morpho), 500, caps, label);
        assertTrue(p1 != p2, "different feeBps must predict a different address");
    }
}
