// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SparkPointVault } from "../../src/vault/SparkPointVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";

/// @title VaultAaveFork — live Base-mainnet fork end-to-end (§6/§6.1/§7).
/// @notice deposit USDC → vault supplies to Aave v3 → aUSDC accrues → redeem returns principal +
///         realized yield MINUS the profit-only perf fee (10% of yield above HWM, 0% on principal).
///         RED against the stub: the stub never routes funds to Aave, so the aUSDC assertion fails.
contract VaultAaveForkTest is Test {
    // Base mainnet (8453).
    address internal constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant AUSDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    address internal guardian = makeAddr("guardian");
    address internal governance = makeAddr("governance");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");

    SparkPointVault internal vault;
    CapRegistry internal caps;
    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("SIM_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forkReady = true;

        caps = new CapRegistry(governance, 10_000e6, 5_000_000e6, 5_000_000e6);
        vault = new SparkPointVault(
            IERC20(USDC),
            IPool(AAVE_POOL),
            IERC20(AUSDC),
            guardian,
            address(caps),
            feeRecipient,
            1000 // 10%
        );
    }

    function test_fork_depositSuppliesToAave_redeemReturnsPrincipalPlusNetYield() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        uint256 principal = 10_000e6;
        deal(USDC, alice, principal);

        vm.startPrank(alice);
        IERC20(USDC).approve(address(vault), principal);
        vault.deposit(principal, alice);
        vm.stopPrank();

        // The vault's USDC must be supplied to Aave (held as aUSDC), not left idle.
        assertApproxEqAbs(
            IERC20(AUSDC).balanceOf(address(vault)), principal, 2, "vault did not supply to Aave"
        );
        assertLe(
            IERC20(USDC).balanceOf(address(vault)), 2, "vault left USDC idle instead of supplying"
        );

        // Warp a year so Aave interest accrues into the aUSDC balance.
        vm.warp(block.timestamp + 365 days);
        uint256 grown = IERC20(AUSDC).balanceOf(address(vault));
        assertGt(grown, principal, "aUSDC must accrue Aave interest over time");
        uint256 yield = grown - principal;

        // Realize the profit-only performance fee on the gain above the seeded HWM.
        uint256 minted = vault.accrueFee();
        assertGt(minted, 0, "perf fee must be minted on realized yield above HWM");
        assertGt(vault.balanceOf(feeRecipient), 0, "feeRecipient must hold the fee shares");

        // Alice redeems everything: principal + ~90% of the yield (10% profit-only fee).
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertGe(out, principal, "N-fee: principal must be preserved (0% on principal)");
        assertLt(out, principal + yield, "yield must be reduced by the profit-only perf fee");
        // Fee is ~10% of yield, so the user keeps ~90%.
        assertApproxEqRel(
            out - principal, (yield * 9000) / 10_000, 0.05e18, "user keeps ~90% of yield"
        );
    }
}
