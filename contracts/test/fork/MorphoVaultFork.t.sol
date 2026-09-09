// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import { SparkPointMorphoVault } from "../../src/vault/SparkPointMorphoVault.sol";
import { CapRegistry } from "../../src/governance/CapRegistry.sol";

/// @title MorphoVaultFork — live Base-mainnet fork end-to-end over a REAL curated Morpho USDC vault.
/// @notice Deploys the wrapper over a REAL curated Morpho `IERC4626` (address supplied via env — never a
///         guessed/hardcoded address), then deposit → wrapper supplies to Morpho → redeem returns
///         principal, and the profit-only HWM fee accrues ONLY above the seeded HWM.
/// @dev ENV-GATED exactly like VaultAaveFork.t.sol: it is a NO-OP/skip unless BOTH
///      `SIM_FORK_RPC_URL` (a Base-mainnet archive RPC) and `MORPHO_VAULT_ADDRESS` (a vetted curated
///      Morpho USDC ERC-4626 on 8453) are set, so the default CI suite stays green with no RPC.
contract MorphoVaultForkTest is Test {
    address internal guardian = makeAddr("guardian");
    address internal governance = makeAddr("governance");
    address internal factory = makeAddr("factory");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");

    SparkPointMorphoVault internal vault;
    CapRegistry internal caps;
    IERC4626 internal morphoVault;
    IERC20 internal usdc;
    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("SIM_FORK_RPC_URL", string(""));
        address morphoAddr = vm.envOr("MORPHO_VAULT_ADDRESS", address(0));
        if (bytes(rpc).length == 0 || morphoAddr == address(0)) return;

        vm.createSelectFork(rpc);
        forkReady = true;

        morphoVault = IERC4626(morphoAddr);
        usdc = IERC20(morphoVault.asset());

        caps = new CapRegistry(governance, 10_000e6, 5_000_000e6, 5_000_000e6);
        vault = new SparkPointMorphoVault(
            usdc,
            morphoVault,
            guardian,
            factory,
            address(caps),
            feeRecipient,
            1000, // 10%
            "SparkPoint Morpho USDC Vault",
            "spkmUSDC",
            "SparkPoint Morpho USDC"
        );
    }

    function test_fork_depositSuppliesToMorpho_redeemReturnsPrincipal_profitOnlyFee() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        uint256 principal = 10_000e6;
        deal(address(usdc), alice, principal);

        vm.startPrank(alice);
        usdc.approve(address(vault), principal);
        vault.deposit(principal, alice);
        vm.stopPrank();

        // The vault's USDC must be supplied to Morpho (held as Morpho shares), not left idle.
        assertGt(morphoVault.balanceOf(address(vault)), 0, "vault did not supply to Morpho");
        assertLe(usdc.balanceOf(address(vault)), 2, "vault left USDC idle instead of supplying");

        // totalAssets is the non-rebasing Morpho claim, ~= principal (minus at most Morpho rounding).
        assertApproxEqAbs(
            vault.totalAssets(),
            principal,
            2,
            "totalAssets must equal the Morpho-backed claim at deposit"
        );

        // Profit-only: with no gain above the seeded HWM, accrueFee() mints 0 and no fee shares appear.
        uint256 mintedFlat = vault.accrueFee();
        assertEq(mintedFlat, 0, "profit-only: no fee accrues at/below the seeded HWM");
        assertEq(vault.balanceOf(feeRecipient), 0, "no fee shares must exist without realized yield");

        // Alice redeems everything: principal is preserved (0% on principal, no fee on a flat position).
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertApproxEqAbs(out, principal, 3, "N-fee: principal must be preserved on a flat round-trip");
    }
}
