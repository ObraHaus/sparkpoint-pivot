// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @title BetaQuoterV2
/// @notice A **minimal, read-only, upgradeable** exact-input single-hop quote source for the beta
/// swap on Robinhood Chain 4663, ABI-compatible with Uniswap's `QuoterV2.quoteExactInputSingle`.
///
/// @dev Why this exists: 4663 has **no working QuoterV2** — every canonical quoter address hosts a
/// dead 2 KB stub that answers nothing — so the app could not quote a swap at all (the router and
/// pools are fine). This contract implements only the single-hop exact-input path in the standard
/// way: it calls the real pool's `swap` and its callback reverts with the computed deltas, which
/// unwinds the pool's state change and hands the quote back through the `try/catch`. Because the
/// pool does the math, the answer is exact (fee, tick crossing and price all included) — no
/// off-chain approximation anywhere.
///
/// ⚠️ Never state-changing in effect: the `swap` is always unwound by the callback's revert, so the
/// call returns data and leaves no state behind. It is meant to be called via `eth_call`.
///
/// **Upgradeable (UUPS, owner = the beta deployer).** The contract is fundless read-only infra, so
/// an in-place upgrade is permitted (constitution v3.1.0: UUPS is allowed for fundless infra): new
/// quote features (multi-hop, exact-output, different discovery) can be added without changing the
/// address the app binds. The owner cannot reach user funds — there are none here.
contract BetaQuoterV2 is Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;
    /// @notice The Uniswap V3 factory the pools live on (4663: the REAL factory, not the book's
    /// historical canonical stub).
    address public immutable factory;

    /// @notice The chain's WETH9 (kept for ABI parity with QuoterV2; the quote itself does not use it).
    address public immutable WETH9;

    /// @notice The only address that may authorise an upgrade or hand over ownership.
    address public owner;

    /// @dev Uniswap V3 TickMath bounds; a zero `sqrtPriceLimitX96` is replaced by the bound in the
    /// swap direction, exactly as QuoterV2 does.
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev keccak256 of the canonical UniswapV3Pool creation code — verified for this factory: it
    /// reproduces the live WETH/USDG pool address from (token0, token1, fee).
    bytes32 internal constant POOL_INIT_CODE_HASH =
        0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    error ZeroAddress();
    error NotOwner();
    error ZeroAmount();
    error InvalidPool();
    error NotPool();
    error RescueFailed();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @param factory_ The Uniswap V3 factory whose pools are quoted.
    /// @param weth_ The chain's WETH9 (ABI parity only).
    constructor(address factory_, address weth_) {
        if (factory_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        factory = factory_;
        WETH9 = weth_;
        _disableInitializers();
    }

    /// @notice Bind the owner (the beta deployer) — the UUPS proxy calls this once.
    function initialize() external initializer {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Hand the owner role (upgrade authority) to another address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Recover native value force-sent to this contract (the quoter never needs ETH — only
    /// the inherited payable `upgradeToAndCall` can receive any, and nothing else here is payable).
    function rescueEth(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert RescueFailed();
    }

    /// @notice Recover an ERC-20 force-sent to this contract.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Quote an exact-input single-hop swap. Returns the pool's own math; reverts for a
    /// missing/empty pool or an invalid amount (same shape as QuoterV2).
    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        if (params.amountIn == 0) revert ZeroAmount();
        bool zeroForOne = params.tokenIn < params.tokenOut;
        address pool = _pool(params.tokenIn, params.tokenOut, params.fee);
        if (pool.code.length == 0) revert InvalidPool();

        uint160 limit = params.sqrtPriceLimitX96 == 0
            ? (zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1)
            : params.sqrtPriceLimitX96;

        // The pool pays the output to this contract, then calls the callback — which reverts with
        // the amounts, unwinding the whole swap. `try/catch` turns that revert into the return.
        try IUniswapV3PoolMinimal(pool)
            .swap(
                address(this), zeroForOne, int256(params.amountIn), limit, abi.encode(pool)
            ) returns (
            int256, int256
        ) { }
        catch (bytes memory reason) {
            (amountOut, sqrtPriceX96After) = abi.decode(reason, (uint256, uint160));
            initializedTicksCrossed = 0; // not tracked; no consumer uses it
            gasEstimate = 0; // not tracked; no consumer uses it
        }
    }

    /// @dev Called by the pool mid-swap; captures the deltas and the post-swap price, then reverts
    /// so the pool's state change is rolled back. The pool validates the payer separately — nothing
    /// here can move funds.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data)
        external
        view
    {
        address pool = abi.decode(data, (address));
        if (msg.sender != pool) revert NotPool();

        // Inside the callback the pool has already written its final slot0 for this swap.
        uint160 sqrtPriceX96After = IUniswapV3PoolMinimal(msg.sender).slot0();

        // Exactly one delta is negative (the output side); return its magnitude.
        uint256 amountOut = amount0Delta > 0 ? uint256(-amount1Delta) : uint256(-amount0Delta);

        bytes memory payload = abi.encode(amountOut, sqrtPriceX96After);
        assembly {
            revert(add(payload, 0x20), mload(payload))
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner { }

    /// @dev CREATE2 address of the pool, from the canonical init-code hash — verified for the real
    /// 4663 factory (the WETH/USDG fee-100 pool reproduces exactly).
    function _pool(address tokenA, address tokenB, uint24 fee) internal view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encode(token0, token1, fee)),
                            POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }

    /// @dev Reserved so new variables are appended, never inserted (`owner` occupies one slot of the
    /// original 50).
    uint256[49] private __gap;
}

/// @dev The slice of `IUniswapV3Pool` this quoter uses.
interface IUniswapV3PoolMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    /// @dev Only the price is read (the first return word); the rest is decoded away by not
    ///      declaring it — the selector is unchanged and extra returndata is ignored.
    function slot0() external view returns (uint160 sqrtPriceX96);
}
