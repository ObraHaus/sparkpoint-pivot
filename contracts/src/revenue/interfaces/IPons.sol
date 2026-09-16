// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IPonsFeeEscrow
/// @notice Where utility-token trading fees accumulate before anyone collects them.
/// `V2FeeEscrow` on Robinhood Chain is `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`.
/// @dev `claim()` pays **`msg.sender`**. That is why `RevenueSplitter` must itself be the registered
/// `creatorFeeRecipient` rather than a bot claiming and forwarding on its behalf.
interface IPonsFeeEscrow {
    function claim() external returns (uint256);
}

/// @title IPonsCurve
/// @notice The bonding curve a Pons launch trades on until it graduates.
/// @dev ⚠️ The signature is `sweepFees(uint256)`, not `sweepFees()` — verified against the deployed
/// source. The no-argument form compiles and reverts against every real curve.
///
/// `sweepFees` is gated on the fee **recipient**, not the launching wallet — sweeping as the
/// launcher reverts `NotFeeSweepOperator` (`0x8d42130c`). A non-operator may only sweep while
/// `buybackQuoteBalance == 0`, guaranteed by launching with `buybackEnabled: false`.
interface IPonsCurve {
    /// @param minBuybackTokensOut Output floor for the buyback swap. Pass 0 while `buybackEnabled`
    /// is false.
    function sweepFees(uint256 minBuybackTokensOut) external;
}

/// @title IPonsHook
/// @notice Pons' Uniswap v4 hook — where the same trading fee accrues **after** graduation.
/// @dev ⚠️ The fee is charged in each swap's **output** currency, so an ETH-only reading looks like
/// zero after a run of buys while the money sits in the token leg. `sweepPoolFees` is the hop that
/// converts and credits the escrow; it is gated to the registered `creatorFeeRecipient`, and
/// Pons' own keeper can always perform it — a disclosed liveness dependency, not a loss.
interface IPonsHook {
    /// @param poolId `keccak256(abi.encode(key))` over the v4 `PoolKey`'s five fields, padded — not
    /// `encodePacked`, which names no pool and reverts `UnknownPool()`.
    function sweepPoolFees(bytes32 poolId, uint256 minAmount0, uint256 minAmount1) external;

    /// @notice The 1% base leg waiting for this pool, in `currency`.
    function pendingFees(bytes32 poolId, address currency) external view returns (uint256);

    /// @notice The 1% creator-tax leg waiting for this pool, in `currency`.
    function pendingCreatorTax(bytes32 poolId, address currency) external view returns (uint256);
}
