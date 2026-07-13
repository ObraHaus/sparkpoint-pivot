// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";
import { VaultTestBase } from "../utils/VaultTestBase.sol";

/// @title RefuteN5 — ADVERSARIAL refutation of invariant N5
///        (non-upgradeable + provable + hard-capped forward-only fee + pause-only governance).
/// @notice Each test is a hostile PoC ATTEMPT. If the guarantee holds, the attempt is BLOCKED and the
///         test asserts that fact (suite GREEN => NOT REFUTED). If ANY attempt actually breaches the
///         invariant, its assertion fails (suite RED => REFUTED). Vectors probed:
///           (A) upgrade paths      — EIP-1967 impl/admin/beacon slots, upgradeTo/upgradeToAndCall,
///                                    initialize re-entry, changeAdmin, delegatecall-to-impl, fallback.
///           (B) custody immutables — no setter for guardian/pool/aUSDC/capRegistry/asset; stable after
///                                    every governance op.
///           (C) fee cap            — setter AND constructor reject > 2000 bps; the cap is a pure
///                                    bytecode constant with no setter; fuzzed exhaustively.
///           (D) governance ≠ funds — only pause bool + bounded feeRate + feeRecipient are mutable; no
///                                    governance call moves USDC; even worst-case max-fee governance
///                                    (feeRecipient := guardian, rate := 20%, harvest) can only collect
///                                    the bounded profit-only fee and NEVER dips into a holder's principal.
///           (E) timelock           — documented: the on-chain setter is IMMEDIATE (delay is delegated
///                                    to the guardian being an external Timelock/multisig), but the
///                                    change is still cap-bounded and moves no funds, so custody holds.
contract RefuteN5Test is VaultTestBase {
    // EIP-1967 standard slots (all MUST be empty for a plain, non-proxy contract).
    bytes32 internal constant EIP1967_IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant EIP1967_ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant EIP1967_BEACON_SLOT =
        0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    address internal attacker = makeAddr("n5_attacker");

    function setUp() public {
        _deployStack();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (A) Upgrade-path probes — there must be NO way to swap implementation/admin
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev A plain contract never writes the EIP-1967 slots; a proxy would.
    function test_refute_eip1967SlotsAllEmpty() public view {
        assertEq(vm.load(address(vault), EIP1967_IMPL_SLOT), bytes32(0), "N5: impl slot populated");
        assertEq(
            vm.load(address(vault), EIP1967_ADMIN_SLOT), bytes32(0), "N5: admin slot populated"
        );
        assertEq(
            vm.load(address(vault), EIP1967_BEACON_SLOT), bytes32(0), "N5: beacon slot populated"
        );
    }

    /// @dev Every upgrade/admin/initializer selector a proxy would expose must be UNIMPLEMENTED. With no
    ///      fallback, the raw call reverts (ok == false). A single `true` here would be a live upgrade path.
    function test_refute_noUpgradeOrInitSelectors() public {
        bytes[] memory payloads = new bytes[](10);
        payloads[0] = abi.encodeWithSignature("upgradeTo(address)", attacker);
        payloads[1] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", attacker, "");
        payloads[2] = abi.encodeWithSignature("initialize()");
        payloads[3] = abi.encodeWithSignature(
            "initialize(address,address,address,address,address,address,uint16)",
            attacker,
            attacker,
            attacker,
            attacker,
            attacker,
            attacker,
            uint16(2000)
        );
        payloads[4] = abi.encodeWithSignature("changeAdmin(address)", attacker);
        payloads[5] = abi.encodeWithSignature("admin()");
        payloads[6] = abi.encodeWithSignature("implementation()");
        payloads[7] = abi.encodeWithSignature("_authorizeUpgrade(address)", attacker);
        payloads[8] = abi.encodeWithSignature("proxiableUUID()");
        payloads[9] =
            abi.encodeWithSignature("upgradeToAndCall(address,bytes,bool)", attacker, "", true);

        for (uint256 i = 0; i < payloads.length; i++) {
            (bool ok,) = address(vault).call(payloads[i]);
            assertFalse(ok, "N5: an upgrade/init selector is implemented (upgrade path exists)");
        }
    }

    /// @dev No fallback/receive: an unknown selector and a bare value transfer both revert, so there is
    ///      no hidden dispatcher that could route to a delegatecall-to-impl gadget.
    function test_refute_noFallbackNoReceive() public {
        vm.deal(address(this), 1 ether);
        (bool okUnknown,) = address(vault).call(abi.encodeWithSelector(bytes4(0xdeadbeef)));
        assertFalse(okUnknown, "N5: vault has a fallback (possible proxy dispatch)");
        (bool okEth,) = address(vault).call{ value: 1 }("");
        assertFalse(okEth, "N5: vault accepts ETH via receive/fallback");
    }

    /// @dev Source-level proof (COMMENTS STRIPPED so only executable code counts): the vault contains no
    ///      upgrade/proxy/delegatecall/selfdestruct machinery whatsoever.
    function test_refute_noUpgradeMachineryInCode() public view {
        string memory code = _stripComments(vm.readFile("src/vault/SparkPointVault.sol"));
        assertFalse(_contains(code, "delegatecall"), "N5: delegatecall present in code");
        assertFalse(_contains(code, "upgradeTo"), "N5: upgradeTo present in code");
        assertFalse(_contains(code, "initialize"), "N5: an initializer is present in code");
        assertFalse(_contains(code, "Upgradeable"), "N5: an Upgradeable base is imported");
        assertFalse(_contains(code, "Proxy"), "N5: a Proxy base is imported");
        assertFalse(_contains(code, "selfdestruct"), "N5: selfdestruct present in code");
        assertFalse(_contains(code, "assembly"), "N5: inline assembly present (unaudited raw path)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (B) Custody immutables — no setter; stable across every governance action
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev There must be NO selector that rebinds a custody immutable, and the immutables must be
    ///      unchanged after exercising the full governance surface.
    function test_refute_custodyImmutablesHaveNoSetterAndAreStable() public {
        // No fund-relevant setter/escape-hatch selector exists (all revert with no fallback).
        bytes[] memory p = new bytes[](8);
        p[0] = abi.encodeWithSignature("setGuardian(address)", attacker);
        p[1] = abi.encodeWithSignature("setCapRegistry(address)", attacker);
        p[2] = abi.encodeWithSignature("setAavePool(address)", attacker);
        p[3] = abi.encodeWithSignature("setAsset(address)", attacker);
        p[4] = abi.encodeWithSignature("sweep(address,uint256)", address(usdc), uint256(1));
        p[5] = abi.encodeWithSignature("rescueTokens(address,uint256)", address(usdc), uint256(1));
        p[6] = abi.encodeWithSignature("migrate(address)", attacker);
        p[7] = abi.encodeWithSignature("emergencyWithdraw(uint256)", uint256(1));
        for (uint256 i = 0; i < p.length; i++) {
            (bool ok,) = address(vault).call(p[i]);
            assertFalse(ok, "N5: a custody-mutating/escape-hatch selector exists");
        }

        // Snapshot immutables, run the entire governance surface, and re-check.
        address g0 = vault.guardian();
        address pool0 = vault.aavePool();
        address a0 = vault.aUSDC();
        address reg0 = vault.capRegistry();
        address asset0 = vault.asset();

        _deposit(alice, 5_000e6);
        vm.startPrank(guardian);
        vault.pauseDeposits();
        vault.unpauseDeposits();
        vault.setPerformanceFeeBps(MAX_FEE_BPS);
        vault.setFeeRecipient(attacker);
        vm.stopPrank();

        assertEq(vault.guardian(), g0, "N5: guardian mutated");
        assertEq(vault.aavePool(), pool0, "N5: aavePool mutated");
        assertEq(vault.aUSDC(), a0, "N5: aUSDC mutated");
        assertEq(vault.capRegistry(), reg0, "N5: capRegistry mutated");
        assertEq(vault.asset(), asset0, "N5: asset mutated");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (C) Fee cap — 2000 bps hard ceiling, enforced everywhere, no way past it
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev The setter rejects anything above the cap; the cap value itself is a pure constant with no
    ///      setter (attempting to set it reverts as an unknown selector).
    function test_refute_setterCannotExceedCap() public {
        assertEq(vault.MAX_PERFORMANCE_FEE_BPS(), MAX_FEE_BPS, "N5: cap constant drifted");

        vm.startPrank(guardian);
        vm.expectRevert(SparkPointVault.FeeExceedsCap.selector);
        vault.setPerformanceFeeBps(uint16(MAX_FEE_BPS + 1));

        vm.expectRevert(SparkPointVault.FeeExceedsCap.selector);
        vault.setPerformanceFeeBps(type(uint16).max);

        // The boundary value is accepted; the getter never reports above the cap.
        vault.setPerformanceFeeBps(MAX_FEE_BPS);
        vm.stopPrank();
        assertEq(vault.performanceFeeBps(), MAX_FEE_BPS, "N5: boundary rate not applied");

        // No selector can rewrite the hard cap.
        (bool ok,) = address(vault)
            .call(abi.encodeWithSignature("setMaxPerformanceFeeBps(uint16)", uint16(9999)));
        assertFalse(ok, "N5: the fee cap is mutable");
        assertEq(vault.MAX_PERFORMANCE_FEE_BPS(), MAX_FEE_BPS, "N5: fee cap changed");
    }

    /// @dev The constructor also refuses to deploy a vault with a rate above the cap.
    function test_refute_constructorCannotExceedCap() public {
        vm.expectRevert(SparkPointVault.FeeExceedsCap.selector);
        new SparkPointVault(
            IERC20(address(usdc)),
            IPool(address(pool)),
            IERC20(address(aUSDC)),
            guardian,
            address(caps),
            feeRecipient,
            uint16(MAX_FEE_BPS + 1)
        );
    }

    /// @dev Exhaustive: for ANY rate, > cap always reverts and <= cap always yields a getter <= cap.
    function testFuzz_refute_feeRateNeverExceedsCap(uint16 newRate) public {
        vm.prank(guardian);
        if (newRate > MAX_FEE_BPS) {
            vm.expectRevert(SparkPointVault.FeeExceedsCap.selector);
            vault.setPerformanceFeeBps(newRate);
        } else {
            vault.setPerformanceFeeBps(newRate);
            assertEq(vault.performanceFeeBps(), newRate, "N5: rate mismatch");
        }
        assertLe(vault.performanceFeeBps(), MAX_FEE_BPS, "N5: effective fee exceeded the 20% cap");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (D) Governance ≠ a fund path — pause-only + bounded fee; never touches principal
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev A non-guardian cannot touch ANY governance selector.
    function test_refute_governanceIsGuardianGated() public {
        vm.startPrank(attacker);
        vm.expectRevert(SparkPointVault.NotGuardian.selector);
        vault.pauseDeposits();
        vm.expectRevert(SparkPointVault.NotGuardian.selector);
        vault.unpauseDeposits();
        vm.expectRevert(SparkPointVault.NotGuardian.selector);
        vault.setPerformanceFeeBps(0);
        vm.expectRevert(SparkPointVault.NotGuardian.selector);
        vault.setFeeRecipient(attacker);
        vm.stopPrank();
    }

    /// @dev Running the ENTIRE governance surface moves zero USDC to the vault, the guardian, or anyone.
    function test_refute_governanceMovesNoFunds() public {
        _deposit(alice, 5_000e6);
        uint256 vaultBal = usdc.balanceOf(address(vault));
        uint256 guardianBal = usdc.balanceOf(guardian);
        uint256 attackerBal = usdc.balanceOf(attacker);

        vm.startPrank(guardian);
        vault.pauseDeposits();
        vault.unpauseDeposits();
        vault.setPerformanceFeeBps(MAX_FEE_BPS);
        vault.setFeeRecipient(attacker);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), vaultBal, "N5: governance moved vault USDC");
        assertEq(usdc.balanceOf(guardian), guardianBal, "N5: governance moved USDC to guardian");
        assertEq(usdc.balanceOf(attacker), attackerBal, "N5: governance moved USDC to attacker");
    }

    /// @dev THE strong custody statement. A hostile guardian goes for maximum extraction:
    ///        rate := 20%, feeRecipient := guardian, then harvest a large realized yield.
    ///      Even so, (1) the guardian's take is bounded by feeRate × yield-above-HWM, never principal,
    ///      and (2) the honest depositor can still redeem AT LEAST her deposited principal.
    function test_refute_maxFeeGovernanceCannotTouchPrincipal() public {
        uint256 principal = 10_000e6;
        _deposit(alice, principal);

        uint256 yield = 10_000e6; // 100% gain, all above the seeded HWM
        _simulateYield(yield);

        // Hostile governance: crank the fee to the cap and redirect it to the guardian, then harvest.
        vm.startPrank(guardian);
        vault.setPerformanceFeeBps(MAX_FEE_BPS);
        vault.setFeeRecipient(guardian);
        vm.stopPrank();
        vault.harvest();

        // (1) The fee minted to the guardian is worth at most feeRate × yield — strictly the profit share.
        uint256 guardianClaim = vault.convertToAssets(vault.balanceOf(guardian));
        uint256 maxFee = (yield * MAX_FEE_BPS) / 10_000; // 2_000e6
        assertLe(
            guardianClaim, maxFee + 1, "N5: guardian extracted MORE than the capped profit fee"
        );

        // (2) The honest depositor still redeems >= her full principal (fee is profit-only dilution).
        //     Hoist the balanceOf read into a local: as an inline argument it would consume the prank
        //     (the Foundry arg-eval gotcha) and make redeem run as the test contract, not alice.
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        assertGe(out, principal, "N5: max-fee governance ate into depositor PRINCIPAL");
        // And she keeps the lion's share of the yield (>= 80% here).
        assertGe(
            out, principal + (yield * (10_000 - MAX_FEE_BPS)) / 10_000 - 1, "N5: over-taxed yield"
        );
    }

    /// @dev Exhaustive form of the above: for ANY deposit / realized yield / (capped) rate, hostile
    ///      max-extraction governance can take at most rate x yield and NEVER reduces the honest
    ///      depositor below her deposited principal (allowing only OZ offset-0 rounding dust).
    function testFuzz_refute_maxFeeGovernanceNeverEatsPrincipal(
        uint256 principal,
        uint256 yield,
        uint16 rate
    ) public {
        principal = bound(principal, 1e6, 100_000e6);
        yield = bound(yield, 0, 200_000e6);
        rate = uint16(bound(rate, 0, MAX_FEE_BPS));

        _deposit(alice, principal);
        if (yield > 0) _simulateYield(yield);

        vm.startPrank(guardian);
        vault.setPerformanceFeeBps(rate);
        vault.setFeeRecipient(guardian);
        vm.stopPrank();
        vault.harvest();

        // The guardian's fee-share claim is at most rate x yield (profit-only), never principal.
        uint256 guardianClaim = vault.convertToAssets(vault.balanceOf(guardian));
        assertLe(
            guardianClaim, (yield * rate) / 10_000 + 1, "N5: guardian took more than capped fee"
        );

        // The honest depositor still redeems at least her full principal (fee is profit-only dilution).
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        assertGe(out + 2, principal, "N5: max-fee governance ate depositor principal");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (E) Timelock — DOCUMENTED deviation; on-chain change is immediate but cap-bounded & fund-safe
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev The letter of N5 says the feeRate is "timelocked". This impl enforces the delay OFF-CHAIN
    ///      (the guardian address is an external Timelock/multisig; GREEN report interpretation #3), so
    ///      the on-chain setter takes effect in the same block — there is no on-chain delay to bypass.
    ///      This is NOT a custody breach: the change is still hard-capped at 20% (see (C)) and moves no
    ///      funds (see (D)). We assert exactly that immediate-but-bounded behaviour so the deviation is
    ///      pinned and any future custody-relevant regression trips this test.
    function test_note_feeGovernanceImmediateButCapBoundedAndFundSafe() public {
        _deposit(alice, 5_000e6);
        uint256 vaultBal = usdc.balanceOf(address(vault));

        vm.prank(guardian);
        vault.setPerformanceFeeBps(MAX_FEE_BPS); // takes effect immediately (no on-chain timelock)

        assertEq(vault.performanceFeeBps(), MAX_FEE_BPS, "note: rate not immediate");
        assertLe(vault.performanceFeeBps(), MAX_FEE_BPS, "note: bypassed the cap");
        assertEq(usdc.balanceOf(address(vault)), vaultBal, "note: rate change moved funds");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // helpers (comment-stripping source scanner, mirrors NonCustody.t.sol)
    // ─────────────────────────────────────────────────────────────────────────

    function _stripComments(string memory src) internal pure returns (string memory) {
        bytes memory b = bytes(src);
        bytes memory out = new bytes(b.length);
        uint256 k;
        uint256 i;
        bytes1 slash = bytes1("/");
        bytes1 star = bytes1("*");
        bytes1 nl = bytes1("\n");
        while (i < b.length) {
            if (i + 1 < b.length && b[i] == slash && b[i + 1] == slash) {
                while (i < b.length && b[i] != nl) i++;
            } else if (i + 1 < b.length && b[i] == slash && b[i + 1] == star) {
                i += 2;
                while (i + 1 < b.length && !(b[i] == star && b[i + 1] == slash)) i++;
                i += 2;
            } else {
                out[k++] = b[i++];
            }
        }
        bytes memory res = new bytes(k);
        for (uint256 j = 0; j < k; j++) {
            res[j] = out[j];
        }
        return string(res);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
