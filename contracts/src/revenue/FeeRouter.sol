// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { ISwapRouter02 } from "./interfaces/ISwapRouter02.sol";
import { IWETH9 } from "./interfaces/IWETH9.sol";
import { RevenueSplitter } from "./RevenueSplitter.sol";

/// @title FeeRouter
/// @notice The beta swap fee-router for Robinhood Chain 4663: a thin, non-custodial wrapper around
/// the external Uniswap V3 `SwapRouter02` that charges the product's **0.20% fee on the input side**
/// and sends it to the immutable `RevenueSplitter`.
///
/// The deployed `SwapRouter02` has no fee hook the splitter could receive through — `sweepWithFee`
/// is absent and `sweepToken` is the platform's own — so the fee has to live in a router the user
/// signs against. This contract is that router and nothing more.
///
/// Design facts, each load-bearing:
///
/// - **Non-custodial.** The user signs the swap; the router pulls the input, swaps it, and pays the
///   output to the caller-named recipient inside the same transaction. It never holds funds between
///   calls and has no accounting state to get out of sync.
/// - **The fee is input-side, in the asset the user already pays with.** ETH-in pays the fee in ETH
///   straight to the splitter's `receive()`; ERC-20-in pays in that token, which the router hands to
///   the splitter and then settles through the splitter's own immutable 90/10 `sweepToken`. So the
///   fee can only ever reach the engine (then brokers) and the treasury — never an EOA.
/// - **Exactly 0.20%, forever.** `FEE_BPS` is a compile-time constant and the ceiling is an
///   immutable; there is no setter for either. Changing the rate or the recipient takes a new
///   implementation, i.e. an owner-visible UUPS upgrade.
/// - **Exact-input, single-hop, ETH↔token and token↔token only.** WETH is the native sentinel on
///   both sides (ETH-in ⇒ `tokenIn == weth`; ETH-out ⇒ `tokenOut == weth`); exact-output and
///   multi-hop are non-goals for the beta.
/// - **Slippage and deadline are caller-supplied and passed through unchanged.** The `02` router
///   takes no deadline, so this contract enforces `block.timestamp <= deadline` before the swap.
///
/// ⚠️ **No state write ever follows an external call.** The swap path writes no storage at all: the
/// validations run first, then the fee legs, the swap, the unwrap and the refund execute in order.
/// The only storage this contract ever writes is `owner` (during `initialize`) — which is why the
/// static analysers can stay happy with a contract that makes this many external calls.
contract FeeRouter is ReentrancyGuard, Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    /// @notice The swap fee in basis points of the input amount. 20 = 0.20%.
    uint16 public constant FEE_BPS = 20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @dev The hardest ceiling a deployment may accept, so a mis-parameterised deploy cannot ship
    /// a fee above 1% under this code.
    uint256 public constant MAX_FEE_CEILING_BPS = 100;

    // ---------------------------------------------------------------- immutable wiring

    /// @notice The wrapped-native token the ETH legs wrap/unwrap through (chain 4663 WETH).
    IWETH9 public immutable weth;

    /// @notice The external Uniswap V3 `SwapRouter02` every swap is routed to.
    ISwapRouter02 public immutable swapRouter;

    /// @notice The `RevenueSplitter` the fee is paid to — the only fee destination this code can
    /// ever name. Changing it takes a new implementation (an owner-visible upgrade).
    address public immutable splitter;

    /// @notice The deployment-time ceiling, in bps, that the fee can never exceed. Immutable and
    /// unsettable: the actual fee is the `FEE_BPS` constant below it.
    uint256 public immutable feeCeilingBps;

    // ---------------------------------------------------------------- storage

    /// @notice The beta deployer EOA — the only address that may authorise a UUPS upgrade or
    /// rescue value that was sent to this contract outside a swap.
    address public owner;

    // ---------------------------------------------------------------- types

    struct ExactInputSingleParams {
        /// @dev The input asset. `weth` means native ETH input (the router wraps `netIn`).
        address tokenIn;
        /// @dev The output asset. `weth` means native ETH output (the router unwraps it).
        address tokenOut;
        /// @dev The pool fee tier (100 on the 4663 WETH/USDG pool).
        uint24 fee;
        /// @dev The output recipient — the connecting account, never the router.
        address recipient;
        /// @dev The GROSS exact input, before the 0.20% fee. For ETH-in this is `msg.value` minus
        /// any amount to refund.
        uint256 amountIn;
        /// @dev The floor on the swap output, computed by the caller from a live quote of `netIn`.
        uint256 amountOutMinimum;
        /// @dev Absolute unix deadline. `block.timestamp` after this reverts.
        uint256 deadline;
    }

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error BadPair();
    error DeadlineExpired();
    error InsufficientValue();
    error UnexpectedValue();
    error BadFeeCeiling();
    error InsufficientOutput();

    // ---------------------------------------------------------------- events

    /// @notice A fee leg was paid to the splitter. `asset == address(0)` means the ETH leg.
    event FeeRouted(address indexed asset, uint256 amount, bool inEth);
    event SwapExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 fee,
        uint256 amountOut,
        address recipient
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------- construction

    /// @param weth_ The chain's WETH9 (4663: `0x0Bd7…AD73`).
    /// @param swapRouter_ The external Uniswap V3 `SwapRouter02` (4663: `0xCaf6…E5cb2`).
    /// @param splitter_ The `RevenueSplitter` fee destination. **Never an EOA** — that is the point
    /// of routing the fee through a contract.
    /// @param feeCeilingBps_ The immutable fee ceiling; must be at least `FEE_BPS` and at most
    /// `MAX_FEE_CEILING_BPS`.
    constructor(address weth_, address swapRouter_, address splitter_, uint256 feeCeilingBps_) {
        if (weth_ == address(0) || swapRouter_ == address(0) || splitter_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeCeilingBps_ < FEE_BPS || feeCeilingBps_ > MAX_FEE_CEILING_BPS) {
            revert BadFeeCeiling();
        }

        weth = IWETH9(weth_);
        swapRouter = ISwapRouter02(swapRouter_);
        splitter = splitter_;
        feeCeilingBps = feeCeilingBps_;

        _disableInitializers();
    }

    /// @notice Bind the owner (the beta deployer) — the only post-deploy wiring this contract needs,
    /// because everything else is an immutable. UUPS proxy deployment calls this once.
    function initialize() external initializer {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------- views

    /// @notice The fee, in bps, as the app's ABI reads it. Mirrors {FEE_BPS}.
    function feeBps() external pure returns (uint16) {
        return FEE_BPS;
    }

    // ---------------------------------------------------------------- swap

    /// @notice Swap an exact input for an output floor, charging the 0.20% fee on the input side.
    /// @dev Native in is `tokenIn == weth` (attach `msg.value`, any excess is refunded); native out
    /// is `tokenOut == weth` (the router unwraps and forwards ETH). Exactly one side may be native.
    function swapExactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.recipient == address(0)) revert ZeroAddress();
        if (params.amountIn == 0) revert ZeroAmount();

        bool fromNative = params.tokenIn == address(weth);
        bool toNative = params.tokenOut == address(weth);
        // WETH is the native sentinel on both sides, so a WETH↔WETH pair is the one shape with no
        // meaning, and the same token on both sides has no pool either. Everything else — ETH→token,
        // token→ETH, token→token — is a supported exact-input single hop.
        if ((fromNative && toNative) || params.tokenIn == params.tokenOut) revert BadPair();

        if (fromNative) {
            if (msg.value < params.amountIn) revert InsufficientValue();
        } else if (msg.value != 0) {
            revert UnexpectedValue();
        }

        // Truncating division on purpose: the dust from a fractional basis point stays on the user's
        // side of the swap, so the router can never take more than FEE_BPS.
        uint256 fee = (params.amountIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netIn = params.amountIn - fee;

        // ---- fee leg: paid to the immutable splitter, in the input asset ----
        if (fromNative) {
            if (fee != 0) {
                emit FeeRouted(address(0), fee, true);
                Address.sendValue(payable(splitter), fee);
            }
        } else {
            // Non-custodial: the gross input is pulled in this call and consumed by the swap below;
            // the router holds it only for the duration of the transaction.
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
            if (fee != 0) {
                emit FeeRouted(params.tokenIn, fee, false);
                IERC20(params.tokenIn).safeTransfer(splitter, fee);
                // The splitter's own immutable 90/10 path completes the fee's journey in this tx:
                // 90% is pushed to the engine (booked via `sweepAsset`; the fee token must be
                // `addAsset`-registered) and 10% to the treasury. `sweepToken` moves the splitter's
                // whole balance of this token — a permissionless entry point anyone could call, so
                // invoking it here grants no privilege; it just saves a separate keeper hop.
                RevenueSplitter(payable(splitter)).sweepToken(params.tokenIn);
            }
        }

        // ---- swap leg. No storage is written after this point. ----
        if (fromNative) {
            // ETH-in wraps `netIn` to WETH here, so the swap is a plain WETH→token trade.
            // The destination is the immutable, constructor-pinned WETH9 — never caller-controlled —
            // and the value is the caller's own `netIn` from `msg.value`; the swap is `nonReentrant`
            // and writes no storage at all. Slither's taint analysis cannot see through the
            // immutable, so it reads this as an arbitrary send: a documented false positive.
            // slither-disable-next-line arbitrary-send-eth
            IWETH9(address(weth)).deposit{ value: netIn }();
            IERC20(address(weth)).forceApprove(address(swapRouter), netIn);
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: address(weth),
                    tokenOut: params.tokenOut,
                    fee: params.fee,
                    recipient: params.recipient,
                    amountIn: netIn,
                    amountOutMinimum: params.amountOutMinimum,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            IERC20(params.tokenIn).forceApprove(address(swapRouter), netIn);
            amountOut = swapRouter.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: params.tokenIn,
                    // ETH-out: the pool pays WETH to this contract, which unwraps it below.
                    tokenOut: toNative ? address(weth) : params.tokenOut,
                    fee: params.fee,
                    recipient: toNative ? address(this) : params.recipient,
                    amountIn: netIn,
                    amountOutMinimum: params.amountOutMinimum,
                    sqrtPriceLimitX96: 0
                })
            );
            if (toNative) {
                IWETH9(address(weth)).withdraw(amountOut);
                Address.sendValue(payable(params.recipient), amountOut);
            }
        }

        // Belt to the swap router's own floor check: even a router that ignored `amountOutMinimum`
        // cannot under-deliver through this contract.
        if (amountOut < params.amountOutMinimum) revert InsufficientOutput();

        emit SwapExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            fee,
            amountOut,
            params.recipient
        );

        // Native-in callers may attach more than `amountIn` (e.g. a wallet prefilled the value) —
        // return the unspent remainder. Token-in calls with value were rejected above.
        uint256 refund = msg.value - (fromNative ? params.amountIn : 0);
        if (refund != 0) Address.sendValue(payable(msg.sender), refund);
    }

    /// @dev Accepts ETH only from the WETH unwrap path. Value pushed here outside a swap has no way
    /// out except `rescueEth`; nothing else in this contract can be made to depend on its balance.
    receive() external payable { }

    // ---------------------------------------------------------------- owner admin

    /// @notice Hand the owner role (upgrade + rescue authority) to another address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Recover native value sent to this contract outside a swap.
    function rescueEth(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(payable(to), amount);
    }

    /// @notice Recover an ERC-20 sent to this contract outside a swap.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner { }

    // ---------------------------------------------------------------- storage gap

    /// @dev Reserved so new variables are appended, never inserted (`owner` occupies one slot of
    /// the original 50).
    uint256[49] private __gap;
}
