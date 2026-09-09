/**
 * DEX-selector config for the manual swap page.
 *
 * The page lets the user choose WHICH DEX routes their swap. Uniswap V3 is wired + executable on
 * Base Sepolia and Base mainnet, and on Robinhood Chain Testnet (46630) via Synthra V3 — a Uniswap-V3
 * fork with an ABI-identical SwapRouter02/QuoterV2 and a deep WETH/USDC pool (verified on-chain). It
 * is named honestly per chain via {@link dexDisplayLabel}. Aerodrome is a Base-mainnet-only DEX (no
 * Base-Sepolia deployment), shown in the selector but NOT executable on the testnet — an honest "Base
 * mainnet only" state, mirroring the chat assistant's refusal. Only DEXes with a resolvable router on
 * the active chain actually execute this pass.
 */

export type DexId = "uniswap_v3" | "aerodrome";

export interface DexInfo {
  readonly id: DexId;
  readonly label: string;
  /** Chains where this DEX is wired AND executable in the app. */
  readonly liveChains: readonly number[];
  /** Shown when the DEX is selected on a chain it isn't live on (honest, not a fabricated route). */
  readonly unavailableNote?: string;
}

export const DEXES: readonly DexInfo[] = [
  {
    id: "uniswap_v3",
    label: "Uniswap V3",
    // Base Sepolia (alpha) + Base mainnet (real Uniswap V3) + Robinhood testnet 46630 (Synthra V3,
    // a Uniswap-V3 fork with the same router/quoter ABI) — all verified on-chain.
    liveChains: [84532, 8453, 46630],
  },
  {
    id: "aerodrome",
    label: "Aerodrome",
    liveChains: [8453], // Base mainnet only — no Base-Sepolia deployment
    unavailableNote:
      "Aerodrome is deployed on Base mainnet only — it isn't available on Base Sepolia. It arrives with mainnet.",
  },
];

export function dexById(id: DexId): DexInfo {
  const d = DEXES.find((x) => x.id === id);
  if (!d) throw new Error(`unknown dex ${id}`);
  return d;
}

/** True iff the DEX is executable on this chain (has a wired router there). */
export function dexLiveOn(dex: DexInfo, chainId: number | undefined): boolean {
  return chainId !== undefined && dex.liveChains.includes(chainId);
}

/**
 * User-facing DEX name for a chain. The "uniswap_v3" route is REAL Uniswap V3 on Base, but on
 * Robinhood testnet (46630) it routes through Synthra V3 (a Uniswap-V3 fork) — so name it honestly
 * rather than claiming it's Uniswap there.
 */
export function dexDisplayLabel(dex: DexInfo, chainId: number | undefined): string {
  if (dex.id === "uniswap_v3" && chainId === 46630) return "Synthra V3";
  return dex.label;
}
