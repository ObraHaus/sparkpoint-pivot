// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { SparkPointTestToken } from "../../src/token/SparkPointTestToken.sol";

/// @notice Unit + FUZZ for the test SRK token (feature 012, T001). Proves: 18 decimals; the entire
///         fixed supply lands on the deployer at construction; there is no callable mint path (supply
///         is invariant under any transfer/approve/transferFrom); over-balance transfers revert; and
///         transferFrom respects the allowance. The token holds no funds and has no privileged role.
contract SparkPointTestTokenTest is Test {
    SparkPointTestToken internal srk;

    /// @dev The test contract is the broadcaster, so the constructor mints the whole supply to it.
    address internal deployer = address(this);

    function setUp() public {
        srk = new SparkPointTestToken();
    }

    function test_Metadata() public view {
        assertEq(srk.name(), "SparkPoint Test Token");
        assertEq(srk.symbol(), "SRK");
        assertEq(srk.decimals(), 18);
    }

    function test_AllSupplyToDeployerAtConstruction() public view {
        uint256 supply = srk.INITIAL_SUPPLY();
        assertEq(supply, 1_000_000_000 ether);
        assertEq(srk.totalSupply(), supply);
        assertEq(srk.balanceOf(deployer), supply, "deployer must hold the entire supply");
    }

    /// @dev A transfer moves balance and NEVER changes total supply (no mint path exists).
    function testFuzz_TransferPreservesSupplyAndBalances(address to, uint256 amount) public {
        vm.assume(to != address(0) && to != deployer);
        uint256 supply = srk.totalSupply();
        amount = bound(amount, 0, srk.balanceOf(deployer));

        srk.transfer(to, amount);

        assertEq(srk.balanceOf(deployer), supply - amount);
        assertEq(srk.balanceOf(to), amount);
        assertEq(srk.totalSupply(), supply, "supply is immutable - no mint/burn path");
    }

    /// @dev Transferring more than the balance reverts (never mints the shortfall).
    function testFuzz_OverBalanceTransferReverts(address to, uint256 excess) public {
        vm.assume(to != address(0) && to != deployer);
        uint256 bal = srk.balanceOf(deployer);
        excess = bound(excess, 1, type(uint256).max - bal); // avoid arithmetic overflow on bal+excess

        vm.expectRevert(); // OZ v5 ERC20InsufficientBalance
        srk.transfer(to, bal + excess);
    }

    /// @dev approve + transferFrom respects the allowance, spends it, and preserves supply.
    function testFuzz_ApproveAndTransferFrom(address spender, address to, uint256 amount) public {
        vm.assume(spender != address(0) && spender != deployer);
        vm.assume(to != address(0) && to != deployer);
        amount = bound(amount, 0, srk.balanceOf(deployer));
        uint256 supply = srk.totalSupply();

        srk.approve(spender, amount);
        assertEq(srk.allowance(deployer, spender), amount);

        vm.prank(spender);
        srk.transferFrom(deployer, to, amount);

        assertEq(srk.balanceOf(to), amount);
        assertEq(srk.allowance(deployer, spender), 0, "finite allowance is fully spent");
        assertEq(srk.totalSupply(), supply);
    }

    /// @dev transferFrom beyond the approved allowance reverts (allowance is enforced).
    function testFuzz_TransferFromOverAllowanceReverts(address spender, uint256 approved) public {
        vm.assume(spender != address(0) && spender != deployer);
        approved = bound(approved, 0, srk.balanceOf(deployer) - 1);

        srk.approve(spender, approved);
        vm.prank(spender);
        vm.expectRevert(); // OZ v5 ERC20InsufficientAllowance
        srk.transferFrom(deployer, spender, approved + 1);
    }
}
