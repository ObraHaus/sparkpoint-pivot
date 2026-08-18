/**
 * The minimum ABI surface the bots touch. Deliberately hand-trimmed rather than imported from
 * `packages/shared` so this tool stays outside the pnpm workspace and cannot drag shipped code
 * (or its lockfile) along with it.
 */

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** Uniswap V3 `SwapRouter02` — only the calls the fee-bearing swap needs. */
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
    // Sends (output − fee) to the recipient and the fee straight to feeRecipient, ON CHAIN.
    // This is what makes the 0.20% non-custodial: the app never holds it.
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
    // The native-ETH-out counterpart of sweepTokenWithFee. Needed because the bots must SELL as
    // well as buy: a buy-only fleet converts all its ETH to USDC and then cannot pay for gas or
    // for the next swap. Round-tripping also doubles the fee events per unit of capital.
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
    name: "multicall",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

export const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable", // simulate-only; it mutates then reverts internally
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
] as const;

/** `SparkPointVault` — ERC-4626 plus the fee surface. */
export const vaultAbi = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDeposit", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxRedeem", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewRedeem", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "highWaterMark", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "performanceFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "feeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  // ⚠️ PERMISSIONLESS by design — anyone may realise the fee. That is what lets a bot (or a
  // holder, or a cron) mint the accrual event without any privileged key.
  { type: "function", name: "accrueFee", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "feeShares", type: "uint256" }] },
] as const;

/** The Aave-market test-USDC faucet on Base Sepolia. */
export const faucetAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** `BrokerSale` — free and open, capped per wallet. */
export const brokerSaleAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "id", type: "uint256" }] },
  { type: "function", name: "remainingFor", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "perWalletCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "saleOpen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

/** `BrokerActivationRegistry` — retires SRK and flips activation in ONE transaction. */
export const brokerRegistryAbi = [
  // ⚠️ IRREVERSIBLE. The SRK leaves for a dead address and the activation cannot be undone;
  // a later transfer clears it, and the record cannot be rebuilt.
  { type: "function", name: "activate", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "tier", type: "uint8" }], outputs: [] },
  { type: "function", name: "weightOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "tiers", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ name: "price", type: "uint256" }, { name: "weightBps", type: "uint32" }] },
] as const;

/** The NFT itself — only what the bots read. */
export const brokerNftAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "activatedAt", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "totalMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
