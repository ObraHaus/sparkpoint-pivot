/**
 * The slices of this repo's beta revenue contracts the runners call.
 *
 * Hand-written against the shipped source (`contracts/src/revenue/*.sol`) — there is no generated
 * ABI in this package. A wrong interface shape against a real deployment compiles and passes tests
 * written against the same mistake; the sibling repo paid for that lesson twice. Keep these in
 * lockstep with the contracts.
 *
 * Beta channel only (4663). Nothing here is privileged: `settle`/`sync`/`deliver`/`pull`/sweeps are
 * all permissionless, which is why the runners hold only gas.
 */

export const engineAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "sync",
    stateMutability: "nonpayable",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "deliver",
    stateMutability: "nonpayable",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "MAX_DELIVER_BATCH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "currentRound",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "settledRound",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    /** Per-asset revenue received and not yet settled. `address(0)` is native ETH. */
    type: "function",
    name: "pendingPot",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "ClockedIn",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "burned", type: "uint256", indexed: false },
    ],
  },
] as const;

export const splitterAbi = [
  /**
   * Pre-graduation: sweep the bonding curve's fees, claim them from the escrow and split 90/10 in
   * ONE permissionless call. Pass `minBuybackTokensOut = 0` — the launch has `buybackEnabled: false`.
   */
  {
    type: "function",
    name: "sweepCurve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "curve", type: "address" },
      { name: "minBuybackTokensOut", type: "uint256" },
    ],
    outputs: [],
  },
  /** Claim whatever the escrow has credited to the splitter, then split it. */
  { type: "function", name: "pull", stateMutability: "nonpayable", inputs: [], outputs: [] },
  /** Split whatever ETH the splitter holds (90% engine / 10% treasury). */
  { type: "function", name: "distribute", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    /** Post-graduation v4-hook path (kept for when the token graduates; env-gated in the sweeper). */
    type: "function",
    name: "sweepPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "hook", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "minAmount0", type: "uint256" },
      { name: "minAmount1", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "engine",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "escrow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "Distributed",
    inputs: [
      { name: "toHolders", type: "uint256", indexed: false },
      { name: "toTreasury", type: "uint256", indexed: false },
    ],
  },
] as const;

/** The immutable royalty sink: empty `receive()`, permissionless `flush()` into the splitter. */
export const royaltySinkAbi = [
  { type: "function", name: "flush", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "splitter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/** The Pons bonding curve: `sweepFees(uint256)` — NOT the no-argument form. */
export const curveAbi = [
  {
    type: "function",
    name: "sweepFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "minBuybackTokensOut", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "graduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
