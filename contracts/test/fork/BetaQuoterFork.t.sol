// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { FeeRouter } from "../../src/revenue/FeeRouter.sol";
import { BetaQuoterV2 } from "../../src/revenue/BetaQuoterV2.sol";

/// @title BetaQuoterFork — the minimal quoter vs the REAL 4663 pool (pinned post-upgrade fork).
///
/// Proves `quoteExactInputSingle` returns exactly what the FeeRouter's own swap execution returns
/// for the same amount, in BOTH directions — i.e. the quote is the pool's math, not an
/// approximation. Also re-proves the canonical pool init-code hash against the live factory
/// (the quoter derives the pool address from it; a mismatch would revert `InvalidPool`).
///
/// Run it:
/// ```bash
/// export ROBINHOOD_MAINNET_RPC=<archive endpoint for 4663>
/// forge test --match-contract BetaQuoterFork -vv
/// ```
contract BetaQuoterForkTest is Test {
    uint256 internal constant FORK_BLOCK = 65_126_400; // same post-upgrade pin as the revenue proof
    address internal constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address internal constant FEE_ROUTER = 0x0f5c10d550387b2dE4E14F4855E67Ee3321ae7F3;

    uint24 internal constant POOL_FEE = 100;
    uint256 internal constant FEE_BPS = 20;
    uint256 internal constant FEE_DENOM = 10_000;

    bool internal forkReady;
    BetaQuoterV2 internal quoter;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return; // skips; the default suite stays offline
        vm.createSelectFork(rpc, FORK_BLOCK);
        assertGt(
            POOL.code.length, 0, "no pool at the real factory-derived address - re-pin the fork"
        );
        // Deploy the way production does: implementation + UUPS proxy (the owner is this test).
        BetaQuoterV2 impl = new BetaQuoterV2(FACTORY, WETH);
        quoter = BetaQuoterV2(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(BetaQuoterV2.initialize, ()))
                ))
        );
        forkReady = true;
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256)
    {
        (uint256 out,,,) = quoter.quoteExactInputSingle(
            BetaQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                fee: POOL_FEE,
                sqrtPriceLimitX96: 0
            })
        );
        return out;
    }

    /// @notice WETH→USDG: the quote equals what the FeeRouter's real swap returns for the same net
    /// input on the identical pool state.
    function test_fork_quoter_matchesTheRouterOnEthIn() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        uint256 gross = 0.0002 ether;
        uint256 net = gross - (gross * FEE_BPS) / FEE_DENOM;
        uint256 quoted = _quote(WETH, USDG, net);
        assertGt(quoted, 0, "quoter returned nothing");

        address user = makeAddr("quoter-user");
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 executed = FeeRouter(payable(FEE_ROUTER)).swapExactInputSingle{ value: gross }(
            FeeRouter.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: USDG,
                fee: POOL_FEE,
                recipient: user,
                amountIn: gross,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
        );

        assertEq(quoted, executed, "the quote must equal the execution for the same input");
    }

    /// @notice USDG→WETH: same equality on the token-in direction (the one the UI could not quote).
    function test_fork_quoter_matchesTheRouterOnTokenIn() public {
        if (!forkReady) {
            vm.skip(true);
            return;
        }

        uint256 gross = 400_000; // 0.4 USDG (6 dp)
        uint256 net = gross - (gross * FEE_BPS) / FEE_DENOM;
        uint256 quoted = _quote(USDG, WETH, net);
        assertGt(quoted, 0, "quoter returned nothing");

        address user = makeAddr("quoter-user-token");
        deal(USDG, user, gross);
        vm.startPrank(user);
        IERC20(USDG).approve(FEE_ROUTER, gross);
        uint256 executed = FeeRouter(payable(FEE_ROUTER))
            .swapExactInputSingle(
                FeeRouter.ExactInputSingleParams({
                tokenIn: USDG,
                tokenOut: WETH,
                fee: POOL_FEE,
                recipient: user,
                amountIn: gross,
                amountOutMinimum: 0,
                deadline: block.timestamp
            })
            );
        vm.stopPrank();

        assertEq(quoted, executed, "the quote must equal the execution for the same input");
    }
}
