// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { SparkPointVaultFactory } from "../../src/factory/SparkPointVaultFactory.sol";
import { ISparkPointVaultFactory } from "../../src/interfaces/ISparkPointVaultFactory.sol";
import { SparkPointMorphoVault } from "../../src/vault/SparkPointMorphoVault.sol";
import { MockERC20, MockMorphoVault } from "../mocks/Mocks.sol";

/// @title VaultFactoryTest — §2 contract obligations for SparkPointVaultFactory (T013).
/// @notice createVault: reverts from a non-owner, from a non-allowlisted morphoVault, and with feeBps>2000;
///         a success pushes to vaults, sets isSparkPointVault, emits VaultCreated, and lands EXACTLY at
///         predictVaultAddress; a second createVault at the same (morphoVault,label) is guarded (no
///         duplicate at the same salt); the factory rejects value (balance stays 0); the deployed wrapper
///         is a REAL full-bytecode wrapper (code>1000, factory()==factory, morphoVault()==arg) — not a
///         minimal proxy (N5).
contract VaultFactoryTest is Test {
    uint256 internal constant ONE_USDC = 1e6;

    MockERC20 internal usdc;
    MockMorphoVault internal morpho;
    SparkPointVaultFactory internal factory;

    address internal owner = makeAddr("owner"); // stands in for the OZ TimelockController
    address internal guardian = makeAddr("guardian");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal stranger = makeAddr("stranger");

    uint16 internal constant FEE_BPS = 1000; // 10%
    string internal constant LABEL = "SparkPoint Morpho USDC";

    event VaultCreated(
        address indexed vault, address indexed morphoVault, uint16 feeBps, string label
    );

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        morpho = new MockMorphoVault(usdc);
        factory = new SparkPointVaultFactory(owner, IERC20(address(usdc)), guardian, feeRecipient);

        // Allowlist the curated Morpho vault (owner-gated / timelocked).
        vm.prank(owner);
        factory.allowlistMorphoVault(address(morpho), true);
    }

    function _caps() internal pure returns (ISparkPointVaultFactory.Caps memory) {
        return ISparkPointVaultFactory.Caps({ perAddressCap: 5_000 * ONE_USDC, totalCap: 1_000_000 * ONE_USDC });
    }

    // ── Access control ──

    function test_createVault_revertsFromNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);
    }

    function test_createVault_revertsForNonAllowlistedMorphoVault() public {
        MockMorphoVault other = new MockMorphoVault(usdc);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactory.NotAllowlisted.selector, address(other)
            )
        );
        factory.createVault(address(other), FEE_BPS, _caps(), LABEL);
    }

    function test_createVault_revertsWhenFeeExceedsCap() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SparkPointVaultFactory.FeeExceedsCap.selector, uint16(2001)));
        factory.createVault(address(morpho), 2001, _caps(), LABEL);
    }

    function test_createVault_acceptsFeeAtExactCap() public {
        vm.prank(owner);
        address vault = factory.createVault(address(morpho), 2000, _caps(), LABEL);
        assertEq(SparkPointMorphoVault(vault).performanceFeeBps(), 2000, "fee at cap should deploy");
    }

    // ── Success path: registry + provenance + event + predicted address ──

    function test_createVault_success_registersEmitsAndLandsAtPredicted() public {
        address predicted = factory.predictVaultAddress(address(morpho), FEE_BPS, _caps(), LABEL);
        assertEq(predicted.code.length, 0, "predicted address must be empty pre-deploy");

        vm.expectEmit(true, true, false, true, address(factory));
        emit VaultCreated(predicted, address(morpho), FEE_BPS, LABEL);

        vm.prank(owner);
        address vault = factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);

        // Lands EXACTLY at the predicted CREATE2 address.
        assertEq(vault, predicted, "deployed vault must equal predictVaultAddress");

        // Registry + provenance.
        assertEq(factory.vaultsLength(), 1, "vaults length");
        assertEq(factory.vaultAt(0), vault, "vaultAt(0)");
        assertEq(factory.vaults()[0], vault, "vaults()[0]");
        assertTrue(factory.isSparkPointVault(vault), "isSparkPointVault");
        assertEq(factory.vaultBySalt(_salt()), vault, "vaultBySalt");
    }

    function test_deployedWrapper_isRealFullBytecodeVault() public {
        vm.prank(owner);
        address vault = factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);

        // A minimal proxy is ~45 bytes; a real wrapper is thousands (N5: full-bytecode, not a clone).
        assertGt(vault.code.length, 1000, "wrapper must be full bytecode, not a minimal proxy");

        SparkPointMorphoVault w = SparkPointMorphoVault(vault);
        assertEq(w.factory(), address(factory), "provenance: factory() == the factory");
        assertEq(w.morphoVault(), address(morpho), "wrapper wraps the arg morphoVault");
        assertEq(w.guardian(), guardian, "guardian == factory guardian immutable");
        assertEq(w.feeRecipient(), feeRecipient, "feeRecipient == factory immutable");
        assertEq(w.asset(), address(usdc), "asset == USDC");
        assertEq(w.performanceFeeBps(), FEE_BPS, "feeBps wired");
        assertTrue(w.capRegistry() != address(0), "per-wrapper CapRegistry wired");

        // No EIP-1967 proxy slots (N5: not upgradeable / not a proxy).
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        assertEq(vm.load(vault, implSlot), bytes32(0), "N5: EIP-1967 impl slot must be empty");
    }

    // ── Idempotency guard: same (morphoVault,label) → same salt → guarded ──

    function test_secondCreateVault_sameSalt_isGuarded() public {
        vm.prank(owner);
        address first = factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);

        // Same (morphoVault, label) → same salt → rejected regardless of feeBps/caps.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactory.VaultAlreadyExists.selector, _salt(), first
            )
        );
        factory.createVault(address(morpho), FEE_BPS, _caps(), LABEL);

        // Even with a DIFFERENT feeBps (different init code), the salt-keyed guard still blocks it.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SparkPointVaultFactory.VaultAlreadyExists.selector, _salt(), first
            )
        );
        factory.createVault(address(morpho), 500, _caps(), LABEL);

        assertEq(factory.vaultsLength(), 1, "no duplicate registered");
    }

    function test_differentLabel_yieldsDistinctVault() public {
        vm.prank(owner);
        address a = factory.createVault(address(morpho), FEE_BPS, _caps(), "Label A");
        vm.prank(owner);
        address b = factory.createVault(address(morpho), FEE_BPS, _caps(), "Label B");
        assertTrue(a != b, "distinct labels must yield distinct wrappers");
        assertEq(factory.vaultsLength(), 2, "both registered");
    }

    // ── N1: the factory holds no funds and has no fund path ──

    function test_factory_rejectsValue_andHoldsNoBalance() public {
        vm.deal(address(this), 1 ether);

        // No receive/fallback: a bare value transfer reverts.
        (bool ok,) = address(factory).call{ value: 1 }("");
        assertFalse(ok, "N1: factory must reject a bare value transfer (no receive/fallback)");

        // createVault is non-payable: a value-bearing call reverts even from the owner.
        vm.prank(owner);
        (bool ok2,) = address(factory).call{ value: 1 }(
            abi.encodeCall(factory.createVault, (address(morpho), FEE_BPS, _caps(), LABEL))
        );
        assertFalse(ok2, "N1: createVault must reject value (non-payable)");

        assertEq(address(factory).balance, 0, "N1: factory balance must stay 0");
    }

    function test_vaultAt_outOfBounds_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(SparkPointVaultFactory.IndexOutOfBounds.selector, uint256(0), uint256(0))
        );
        factory.vaultAt(0);
    }

    function _salt() internal view returns (bytes32) {
        return keccak256(abi.encode(address(morpho), LABEL, block.chainid));
    }
}
