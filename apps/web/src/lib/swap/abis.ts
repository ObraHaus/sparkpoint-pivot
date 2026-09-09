/**
 * Minimal, hand-authored Uniswap V3 ABIs for the manual swap page.
 *
 * These are THIRD-PARTY contracts (Uniswap V3 QuoterV2 + SwapRouter02), so — per the repo
 * convention (`lib/chain/abis.ts:15-17`: third-party ABIs are sourced at the call site, never
 * put through the T015 `export-abis` generator) — only the exact functions the swap flow uses are
 * declared here, `as const` for viem type inference.
 *
 * Non-custody: these describe READ (QuoterV2 quote, off-chain simulate) + the user-signed swap
 * (SwapRouter02). The app never holds a key; the wallet signs. Addresses live in the shared
 * registry (`@sparkpoint/shared/addresses`), never inlined here.
 */

/** QuoterV2.quoteExactInputSingle — off-chain quote (nonpayable ⇒ called via `simulateContract`). */
export const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    // Multi-hop quote — `path` is packed (token,fee,token[,fee,token]); outputs are ARRAYS (per hop).
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/**
 * SwapRouter02 — user-signed swap surface. `exactInputSingle` has NO deadline field in the "02"
 * router; deadline protection comes from the `multicall(uint256 deadline, bytes[])` overload, which
 * we always use. `unwrapWETH9` + the `ADDRESS_THIS` recipient handle the USDC→native-ETH direction.
 */
export const swapRouter02Abi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    // Multi-hop swap — `path` packed (token,fee,token[,fee,token]); no deadline field (deadline is on
    // `multicall`). Output goes to `recipient` (ADDRESS_THIS when a fee/unwrap pay-leg follows).
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  // §fee — the routing-fee variants (Uniswap PeripheryPaymentsWithFee, feeBips ≤ 100 = 1% cap). They
  // send (output − fee) to the user and the fee straight to feeRecipient ON-CHAIN, so the app never
  // custodies the fee. Used with a swap that sends output to ADDRESS_THIS first.
  {
    type: "function",
    name: "unwrapWETH9WithFee",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "feeBips", type: "uint256" },
      { name: "feeRecipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sweepTokenWithFee",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "feeBips", type: "uint256" },
      { name: "feeRecipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refundETH",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

/**
 * Uniswap V3-periphery Constants: recipient sentinels used with `multicall`.
 * `ADDRESS_THIS` (address(2)) keeps swap output IN the router so a following `unwrapWETH9` can
 * convert WETH→native ETH and forward it to the real user. (MSG_SENDER = address(1), unused here.)
 */
export const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;
