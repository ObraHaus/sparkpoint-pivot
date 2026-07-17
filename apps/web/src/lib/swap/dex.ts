/**
 * DEX-selector config for the manual swap page.
 *
 * The page lets the user choose WHICH DEX routes their swap. Uniswap V3 is wired + executable on
 * Base Sepolia (and Base mainnet); Aerodrome is a Base-mainnet-only DEX (no Base-Sepolia deployment),
 * shown in the selector but NOT executable on the testnet — an honest "Base mainnet only" state,
 * mirroring the chat assistant's refusal. Only DEXes with a resolvable router on the active chain
 * actually execute this pass.
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
    liveChains: [84532, 8453], // Base Sepolia (alpha) + Base mainnet — both verified on-chain
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
