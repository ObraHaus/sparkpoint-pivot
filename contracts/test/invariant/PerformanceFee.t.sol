// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { VaultTestBase } from "../utils/VaultTestBase.sol";
import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { MockERC20, MockAavePool } from "../mocks/Mocks.sol";

/// @notice Performance-fee fuzz driver: deposits/withdraws, Aave yield-up + flat, keeper accruals, and
///         timelocked fee-rate changes. Ghost-tracks principal + any fee minted below the HWM.
contract FeeHandler is Test {
    SparkPointVault internal vault;
    MockERC20 internal usdc;
    MockAavePool internal pool;
    address internal governance;
    address[] internal actors;

    mapping(address => uint256) public deposited;
    mapping(address => uint256) public withdrawn;
    mapping(address => uint256) public ops;
    bool public feeMintedBelowHwm;

    constructor(
        SparkPointVault vault_,
        MockERC20 usdc_,
        MockAavePool pool_,
        address governance_,
        address[] memory actors_
    ) {
        vault = vault_;
        usdc = usdc_;
        pool = pool_;
        governance = governance_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        amount = bound(amount, 1e6, 500_000e6);
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(vault), amount);
        try vault.deposit(amount, a) {
            deposited[a] += amount;
            ops[a] += 1;
        } catch { }
        vm.stopPrank();
    }

    function withdraw(uint256 seed, uint256 amount) public {
        address a = _actor(seed);
        uint256 maxW = vault.maxWithdraw(a);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(a);
        try vault.withdraw(amount, a, a) {
            withdrawn[a] += amount;
            ops[a] += 1;
        } catch { }
    }

    function simulateYield(uint256 amount) public {
        amount = bound(amount, 0, 20_000e6);
        pool.accrueTo(address(vault), amount);
    }

    function accrue() public {
        uint256 hwmBefore = vault.highWaterMark();
        uint256 ppsBefore = vault.convertToAssets(1e18);
        address fr = vault.feeRecipient();
        uint256 feeBefore = vault.balanceOf(fr);
        try vault.accrueFee() { } catch { }
        uint256 feeAfter = vault.balanceOf(fr);
        // A fee minted when price was NOT above the mark violates the profit-only rule.
        if (feeAfter > feeBefore && ppsBefore <= hwmBefore) {
            feeMintedBelowHwm = true;
        }
    }

    function setFeeRate(uint16 bps) public {
        bps = uint16(bound(bps, 0, 2000));
        vm.prank(governance);
        try vault.setPerformanceFeeBps(bps) { } catch { }
    }
}

/// @title Performance-fee invariants (§6.1, N-fee).
contract PerformanceFeeInvariantTest is StdInvariant, VaultTestBase {
    FeeHandler internal handler;

    function setUp() public {
        _deployStack();
        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        handler = new FeeHandler(vault, usdc, pool, governance, actors);
        targetContract(address(handler));
    }

    /// @dev RED against the stub: HWM is never seeded, so it sits at 0 from block 0.
    function invariant_hwmNeverBelowInitial() public view {
        assertGe(vault.highWaterMark(), 1e18, "N-fee/FR-050: HWM fell below the 1e18 seed");
    }

    /// @dev Profit-only: no fee share is ever minted when price is at/below the HWM.
    function invariant_feeOnlyAboveHwm() public view {
        assertFalse(handler.feeMintedBelowHwm(), "N-fee: fee minted at/below the high-water mark");
    }

    /// @dev feeRate is always within the immutable hard cap.
    function invariant_feeRateLeCap() public view {
        assertLe(vault.performanceFeeBps(), vault.MAX_PERFORMANCE_FEE_BPS(), "fee rate above cap");
        assertLe(vault.MAX_PERFORMANCE_FEE_BPS(), 2000, "hard cap must be 2000 bps");
    }

    /// @dev Fee dilution never pushes a holder's redeemable assets below deposited principal.
    function invariant_principalPreserved() public view {
        _assertPrincipal(alice);
        _assertPrincipal(bob);
        _assertPrincipal(carol);
    }

    function _assertPrincipal(address a) internal view {
        uint256 redeemable = vault.convertToAssets(vault.balanceOf(a));
        uint256 out = handler.withdrawn(a);
        uint256 dep = handler.deposited(a);
        // EIP-4626 rounds in the vault's favour, so each op sheds at most ONE share's worth of assets
        // to integer-share rounding. That is ~1 wei at a ~1.0 share price, but grows WITH the price —
        // a tiny withdraw at an elevated price still burns a whole share — so the per-op dust budget is
        // scaled by the current per-share value (convertToAssets(1)). This bounds ROUNDING dust only;
        // a fee that actually taxed principal would be a PROPORTIONAL loss, far exceeding this budget,
        // and would still trip the assertion.
        uint256 tol = (2 * handler.ops(a) + 3) * (vault.convertToAssets(1) + 1);
        assertGe(redeemable + out + tol, dep, "N-fee: fee dilution ate into principal");
    }
}
