// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { AaveV3Adapter } from "../../src/adapters/AaveV3Adapter.sol";
import { IPool } from "../../src/interfaces/external/IPool.sol";

contract AaveV3AdapterTest is Test {
    AaveV3Adapter internal adapter;
    address internal poolAddr = makeAddr("aavePool");

    function setUp() public {
        adapter = new AaveV3Adapter(IPool(poolAddr));
    }

    function test_poolImmutableSet() public view {
        assertEq(address(adapter.POOL()), poolAddr, "adapter must pin the Aave Pool endpoint");
    }

    /// @dev STUB state: supply/withdraw are not yet implemented (impl wave fills them in).
    function test_supplyReverts_stub() public {
        vm.expectRevert(AaveV3Adapter.NotImplemented.selector);
        adapter.supply(makeAddr("asset"), 1e6);
    }

    function test_withdrawReverts_stub() public {
        vm.expectRevert(AaveV3Adapter.NotImplemented.selector);
        adapter.withdraw(makeAddr("asset"), 1e6);
    }
}
