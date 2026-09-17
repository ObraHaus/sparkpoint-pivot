// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPonsFeeEscrow, IPonsCurve, IPonsHook } from "./interfaces/IPons.sol";

/// @title RevenueSplitter
/// @notice Splits utility-token trading revenue 90% to the engine (broker holders) and 10% to the
/// treasury.
///
/// @dev This contract exists so that split is enforced by **bytecode**. It is registered as the
/// launch platform's `creatorFeeRecipient`, which is possible because the platform's escrow pays
/// `msg.sender` — so the recipient can be a contract.
///
/// ⚠️ Deliberate divergence from the reference implementation: **this contract is NOT upgradeable
/// and has no owner.** The reference chose a UUPS owner because `creatorFeeRecipient` is fixed
/// forever at launch and a bug could never be exchanged for a fixed version. SparkPoint's
/// constitution (v3.2.0) requires value-bearing contracts to be immutable or upgrade-renounced, and
/// immutability is the stronger promise: the 90/10 split and the two destinations are constructor
/// immutables no key can change. The cost is acknowledged: a bug here means redeploying and
/// relaunching the token.
///
/// Every exit is permissionless and always callable: anyone may `pull`, `sweepCurve`, `sweepPool`,
/// `distribute` or `sweepToken` at any time. There is no state in which value is trapped.
///
/// Two collection paths because there are two venues: `sweepCurve` reaches the bonding curve (where
/// the fee is charged before graduation) and `sweepPool` reaches the v4 hook (after graduation).
/// Either sweep credits the escrow rather than paying this contract directly, so `pull` is the last
/// hop of both.
contract RevenueSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant HOLDER_BPS = 9_000;
    uint256 public constant TREASURY_BPS = 1_000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IPonsFeeEscrow public immutable escrow;
    address public immutable engine;
    address public immutable treasury;

    error ZeroAddress();
    error NothingToDistribute();
    error HolderTransferFailed();
    error TreasuryTransferFailed();
    error BadDestination();
    error BadSweepTarget();
    error NothingToSweep();

    event Distributed(uint256 toHolders, uint256 toTreasury);
    event TokenSwept(address indexed token, uint256 toHolders, uint256 toTreasury);
    event Received(address indexed from, uint256 amount);
    event Pulled(uint256 amount);
    event CurveSwept(address indexed curve);
    event PoolSwept(address indexed hook, bytes32 indexed poolId);

    /// @param escrow_ Pons' V2FeeEscrow (pays `msg.sender` on `claim()`).
    /// @param engine_ The revenue engine — the holder leg.
    /// @param treasury_ The 10% leg. **Effectively permanent**: no setter, and this contract becomes
    /// the token's `creatorFeeRecipient` at launch, which the platform fixes forever.
    constructor(address escrow_, address engine_, address treasury_) {
        if (escrow_ == address(0) || engine_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (engine_ == treasury_) revert BadDestination();
        escrow = IPonsFeeEscrow(escrow_);
        engine = engine_;
        treasury = treasury_;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- collection

    /// @notice Claim accrued fees from the platform escrow, then split them. **Anyone may call.**
    function pull() external nonReentrant {
        uint256 claimed = escrow.claim();
        emit Pulled(claimed);
        _distribute();
    }

    /// @notice Sweep fees still sitting on the trading curve, then split them. **Anyone may call.**
    /// @param minBuybackTokensOut Output floor for the buyback swap. Pass 0 while `buybackEnabled`
    /// is false (the production setting).
    function sweepCurve(address curve, uint256 minBuybackTokensOut) external nonReentrant {
        _requireSweepTarget(curve);
        IPonsCurve(curve).sweepFees(minBuybackTokensOut);
        emit CurveSwept(curve);

        // The sweep does not pay us — it credits the escrow. Claim here so one permissionless call
        // moves the money all the way to holders instead of parking it one hop short.
        uint256 claimed = escrow.claim();
        emit Pulled(claimed);

        _distribute();
    }

    /// @notice Sweep fees the v4 hook holds for the graduated pool, then split them.
    /// **Anyone may call.**
    /// @dev ⚠️ Partial mitigation only: the hook refuses the fee recipient while a token leg is
    /// waiting to be converted, and any buy leaves such a leg — so in steady trading this call can
    /// revert and the sweep is Pons' keeper's to perform. Shipping it before launch is still
    /// mandatory: `creatorFeeRecipient` can never be repointed, so a splitter without this path can
    /// never be exchanged for one that has it.
    function sweepPool(address hook, bytes32 poolId, uint256 minAmount0, uint256 minAmount1)
        external
        nonReentrant
    {
        _requireSweepTarget(hook);
        IPonsHook(hook).sweepPoolFees(poolId, minAmount0, minAmount1);
        emit PoolSwept(hook, poolId);

        uint256 claimed = escrow.claim();
        emit Pulled(claimed);

        _distribute();
    }

    /// @notice Split whatever is held. **Anyone may call.**
    function distribute() external nonReentrant {
        _distribute();
    }

    /// @notice Send a stray ERC-20 down the same 90/10 path. **Anyone may call.**
    function sweepToken(address token) external nonReentrant {
        if (token == address(0) || token == address(this)) revert BadSweepTarget();
        uint256 balance = IERC20(token).balanceOf(address(this));
        // A nothing-to-do guard, not balance-dependent logic.
        if (balance < 1) revert NothingToSweep();

        uint256 toTreasury = (balance * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 toHolders = balance - toTreasury;

        _requireDestinations();

        IERC20(token).safeTransfer(engine, toHolders);
        IERC20(token).safeTransfer(treasury, toTreasury);
        emit TokenSwept(token, toHolders, toTreasury);
    }

    // ---------------------------------------------------------------- internal

    /// @dev The holder share is the remainder rather than a second percentage, so truncation can
    /// never leave dust behind unaccounted — every wei goes to one side or the other. A failed leg
    /// reverts the whole distribution on purpose: the value stays here and the call can be repeated.
    function _distribute() private {
        uint256 balance = address(this).balance;
        // A nothing-to-do guard, not balance-dependent logic.
        if (balance < 1) revert NothingToDistribute();

        uint256 toTreasury = (balance * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 toHolders = balance - toTreasury;

        _requireDestinations();

        // A plain `.transfer` would not do: the engine's `receive()` records revenue, which costs
        // more than a 2,300-gas stipend. Both destinations are immutables, checked immediately
        // above at the point of payment.
        (bool okHolders,) = engine.call{ value: toHolders }("");
        if (!okHolders) revert HolderTransferFailed();

        (bool okTreasury,) = treasury.call{ value: toTreasury }("");
        if (!okTreasury) revert TreasuryTransferFailed();

        emit Distributed(toHolders, toTreasury);
    }

    /// @dev Check both destinations at the point of payment, every payment. The constructor rejects
    /// zero, so this cannot fire today — it is the standing guard against a future edit.
    function _requireDestinations() private view {
        address holderLeg = engine;
        address treasuryLeg = treasury;
        if (holderLeg == address(0) || holderLeg == address(this)) revert BadDestination();
        if (treasuryLeg == address(0) || treasuryLeg == address(this)) revert BadDestination();
    }

    /// @dev Reject the two sweep targets that turn a passthrough into something else: this contract
    /// (a self-call with foreign calldata) and the escrow (where this contract's own claimable
    /// balance lives).
    function _requireSweepTarget(address target) private view {
        if (target == address(0) || target == address(this) || target == address(escrow)) {
            revert BadSweepTarget();
        }
    }
}
