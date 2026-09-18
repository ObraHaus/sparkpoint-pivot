/**
 * tokens.pure — dependency-free token data + helpers for the swap UI.
 *
 * Kept free of imports so `node --experimental-strip-types --test` can load it directly (the same
 * pattern as `route.pure.ts`). `tokens.ts` re-exports everything here and adds the address-book
 * lookups (native ETH + the chain stable) that need `@sparkpoint/shared/addresses`.
 */

/** Where a {@link SwapToken} came from — drives the picker section + the verified/unverified badge. */
export type TokenSource = "recommended" | "imported" | "native";

export interface SwapToken {
  readonly symbol: string;
  /** Decimals of the token amount the user enters/receives (native ETH + WETH are 18; USDC 6). Always
   * the ON-CHAIN value for a pasted token (resolved via metadata.ts) — never a wire/agent/cached hint. */
  readonly decimals: number;
  /** The ERC-20 address used on-chain — for the native-ETH pseudo-token this is WETH (routing). */
  readonly address: `0x${string}`;
  /** true ⇒ NATIVE ETH: balance is native, ETH-in needs no ERC-20 approve, ETH-out is unwrapped. */
  readonly isNative: boolean;
  /** Human name (`name()`), when known — display only. */
  readonly name?: string;
  /** Provenance: native ETH, a curated recommended token, or a user-imported custom token. */
  readonly source?: TokenSource;
  /** true ⇒ the ADDRESS is in the curated verified set (tokenList). Never inferred from the symbol. */
  readonly verified?: boolean;
}

/**
 * Robinhood Chain 4663 — canonical Stock Tokens (tokenized equities + ETFs).
 *
 * Addresses come from the OFFICIAL Robinhood asset registry (`GET https://api.robinhood.com/rhj/assets`,
 * the same source that generates https://docs.robinhood.com/chain/contracts — "a token with a matching
 * name/ticker but a different contract address is not a Robinhood Stock Token"). Every address below was
 * additionally verified ON-CHAIN on 2026-09-18: `symbol()`/`decimals()` (all 18dp) and a live Uniswap V3
 * pool against WETH or USDG (factory `0x1f7d…2EfA`). A wrong "verified" address is a safety bug, so only
 * tokens satisfying BOTH checks are listed; any other ERC-20 stays paste-importable.
 *
 * Ordering is display order in the picker (roughly by pool depth). SPCX stays for continuity with the
 * beta broker story. One source of truth: `tokenList.ts` derives the verified set from this list.
 */
export const RH_STOCK_TOKENS: readonly SwapToken[] = [
  { symbol: "SPY", decimals: 18, address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", isNative: false, source: "recommended", verified: true, name: "SPDR S&P 500 ETF Trust" },
  { symbol: "NVDA", decimals: 18, address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", isNative: false, source: "recommended", verified: true, name: "NVIDIA" },
  { symbol: "TSLA", decimals: 18, address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", isNative: false, source: "recommended", verified: true, name: "Tesla" },
  { symbol: "GOOGL", decimals: 18, address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", isNative: false, source: "recommended", verified: true, name: "Alphabet Class A" },
  { symbol: "META", decimals: 18, address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", isNative: false, source: "recommended", verified: true, name: "Meta Platforms" },
  { symbol: "COIN", decimals: 18, address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", isNative: false, source: "recommended", verified: true, name: "Coinbase" },
  { symbol: "AAPL", decimals: 18, address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", isNative: false, source: "recommended", verified: true, name: "Apple" },
  { symbol: "AMZN", decimals: 18, address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", isNative: false, source: "recommended", verified: true, name: "Amazon" },
  { symbol: "MSFT", decimals: 18, address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", isNative: false, source: "recommended", verified: true, name: "Microsoft" },
  { symbol: "SPCX", decimals: 18, address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", isNative: false, source: "recommended", verified: true, name: "Space Exploration Technologies" },
  { symbol: "QQQ", decimals: 18, address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", isNative: false, source: "recommended", verified: true, name: "Invesco QQQ Trust" },
  { symbol: "GLD", decimals: 18, address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", isNative: false, source: "recommended", verified: true, name: "SPDR Gold Trust" },
  { symbol: "CRCL", decimals: 18, address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", isNative: false, source: "recommended", verified: true, name: "Circle Internet Group" },
  { symbol: "RDDT", decimals: 18, address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C", isNative: false, source: "recommended", verified: true, name: "Reddit" },
];

/** Zero address sentinel used to detect an unconfigured token (a chain whose book leaves it at 0x0). */
export function isConfiguredToken(t: SwapToken): boolean {
  return !/^0x0{40}$/i.test(t.address);
}

/**
 * Seed the chat inline-swap amount field from an assistant-proposed base-unit amount.
 *
 * The assistant's `amount` is raw base units of the FROM token; the web only trusts it once the input
 * token is RESOLVED (a recommended token with pinned decimals, or a pasted token whose `decimals()`
 * was just read on-chain). Returns "" when there is no amount or the token isn't resolved yet — the
 * user types it rather than seeing a mis-scaled number (a 1e12 error is a fund-loss bug).
 */
export function formatSeedAmount(amountIn: bigint | undefined, token: SwapToken | undefined): string {
  if (amountIn === undefined || amountIn <= 0n || token === undefined) return "";
  const digits = amountIn.toString();
  const d = token.decimals;
  if (d <= 0) return digits;
  const padded = digits.padStart(d + 1, "0");
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
