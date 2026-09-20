// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniversalWrapper {
    function asset() external view returns (address);
    function child() external view returns (address);
    function totalAssets() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function convertToAssets(uint256) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
}

/// @title UniversalWrapperV3Fork — V.8 end-to-end proof against the LIVE V3 wrapper on 4663.
///
/// Runs the exact user flow on a fork of the real chain: approve USDG → deposit → assert shares
/// and share price → redeem the full position → assert USDG comes back. It proves the deployed
/// `SparkPointUniversalVault` (behind the timelock beacon, deployed by `SparkPointVaultFactoryV3`)
/// is functional, not just present.
///
/// Run it:
/// ```bash
/// export ROBINHOOD_MAINNET_RPC=<4663 RPC>
/// forge test --match-contract UniversalWrapperV3Fork -vv
/// ```
contract UniversalWrapperV3ForkTest is Test {
    address internal constant WRAPPER = 0xd43FC69F019d1c1fd509Bd340B44E4aBb6F77cfE;
    address internal constant CHILD = 0xBeEff033F34C046626B8D0A041844C5d1A5409dd;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 internal constant AMOUNT = 10e6; // 10 USDG (well inside the 5,000 USDG per-user cap)

    bool internal forkReady;
    address internal alice = makeAddr("alice");

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return; // skips; the default suite stays offline
        vm.createSelectFork(rpc);
        assertGt(WRAPPER.code.length, 0, "no wrapper at the live address - re-pin the fork");
        assertEq(IUniversalWrapper(WRAPPER).asset(), USDG, "wrapper asset must be USDG");
        assertEq(IUniversalWrapper(WRAPPER).child(), CHILD, "wrapper child must be Steakhouse");
        forkReady = true;
    }

    /// @notice The full round trip: deposit 10 USDG, receive shares, redeem them back to USDG.
    function test_fork_liveWrapper_depositAndRedeem() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        deal(USDG, alice, AMOUNT);

        vm.startPrank(alice);
        IERC20(USDG).approve(WRAPPER, AMOUNT);
        uint256 shares = IUniversalWrapper(WRAPPER).deposit(AMOUNT, alice);
        assertGt(shares, 0, "deposit must mint shares");
        assertEq(IUniversalWrapper(WRAPPER).balanceOf(alice), shares, "shares credited to alice");
        assertGt(IUniversalWrapper(WRAPPER).totalAssets(), 0, "wrapper now holds assets");
        assertEq(IERC20(USDG).balanceOf(alice), 0, "the deposit moved the full amount");

        // Redeem what the wrapper says is redeemable. OZ's ERC-4626 rounds `maxRedeem` down, so it
        // can be 1 wei below `balanceOf` — the app's exit flow must use maxRedeem, and so does this
        // proof (redeeming balanceOf would revert ERC4626ExceededMaxRedeem, which is correct OZ).
        uint256 redeemable = IUniversalWrapper(WRAPPER).maxRedeem(alice);
        assertGt(redeemable, 0, "position is redeemable");
        uint256 assetsBack = IUniversalWrapper(WRAPPER).redeem(redeemable, alice, alice);
        assertApproxEqAbs(assetsBack, AMOUNT, 2, "redeem returns the principal (rounding only)");
        assertEq(IERC20(USDG).balanceOf(alice), assetsBack, "USDG is back in alice's wallet");
        assertLe(IUniversalWrapper(WRAPPER).balanceOf(alice), 1, "position effectively closed");
        vm.stopPrank();
    }

    /// @notice The wrapper's share price never lets a redeemer extract more than was deposited.
    function test_fork_liveWrapper_noValueExtraction() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }
        deal(USDG, alice, AMOUNT);
        vm.startPrank(alice);
        IERC20(USDG).approve(WRAPPER, AMOUNT);
        IUniversalWrapper(WRAPPER).deposit(AMOUNT, alice);
        uint256 assetsBack = IUniversalWrapper(WRAPPER)
            .redeem(IUniversalWrapper(WRAPPER).maxRedeem(alice), alice, alice);
        vm.stopPrank();
        assertLe(assetsBack, AMOUNT, "a round trip can never return more than it put in");
    }
}
