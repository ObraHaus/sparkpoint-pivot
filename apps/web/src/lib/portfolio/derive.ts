/**
 * Pure portfolio derivation from the LIVE `useVault` reads + native ETH — no agent, no indexer.
 *
 * Decimals are the hazard and are pinned here: USDC (underlying + idle) is 6-dp, vault shares
 * (spvUSDC) + native ETH are 18-dp. USD-denominated net worth is USDC-only — ETH is shown in ETH
 * (no price oracle, so it is never converted to USD or mixed into the USD total).
 *
 * Multi-vault (011 Phase 4): the closed `'vault' | 'idle'` union widens with an ADDITIVE
 * `ext:${vaultAddress}` discriminant so branded Morpho-wrapper vaults coexist with the launch Aave
 * vault in ONE portfolio view. This is a display discriminant only — NOT a policy change, and the
 * launch `'vault'` position keeps its exact existing derivation (calling with no `wrappers` is
 * byte-identical to before). A wrapper carries `external: true` (its yield is Morpho, not Aave). Only
 * USDC-priced wrapper assets fold into the USD total; an unknown-price asset is never invented into it.
 */

import { formatUnits } from "viem";

const toNum = (x: bigint | undefined, decimals: number): number =>
  x === undefined ? 0 : Number(formatUnits(x, decimals));

export interface LivePosition {
  /** `ext:<vaultAddress>` identifies a registered branded wrapper; the launch vault stays `'vault'`. */
  readonly key: "vault" | "idle" | `ext:${string}`;
  readonly label: string;
  readonly sub: string;
  readonly valueUsd: number;
  readonly shares?: number;
  /** The on-chain vault this position is held in (launch vault or a wrapper). Idle cash has none. */
  readonly vaultAddress?: `0x${string}`;
  /** true ⇒ a branded Morpho wrapper — external yield (Morpho, NOT Aave); drives the disclosure chrome. */
  readonly external?: boolean;
}

/** One registered branded-wrapper position the user provably holds (read-only). */
export interface WrapperPositionInput {
  /** The deployed wrapper (CREATE2) address — its `ext:` key + provenance identity. */
  readonly vaultAddress: `0x${string}`;
  /** Branded display name from the 010 registry (e.g. "SparkPoint · Steakhouse USDC"). */
  readonly label: string;
  /** `convertToAssets(shares)` in the wrapper asset's base units (undefined ⇒ 0 / no position). */
  readonly underlying?: bigint;
  /** The user's wrapper shares (undefined ⇒ 0). */
  readonly shares?: bigint;
  /** The wrapper asset's on-chain decimals (read per vault; defaults to USDC 6-dp). */
  readonly decimals?: number;
  /**
   * The wrapper's SHARE-token decimals (053). V3 wrappers read 9 share decimals over a 6-dp asset,
   * so formatting a share amount with the asset scale would silently understate it. Absent ⇒
   * `decimals` (the launch-style equal-decimals case).
   */
  readonly shareDecimals?: number;
  /**
   * Whether the wrapper's asset is USD-priced (USDC) so its value folds into the USD net-worth total.
   * Defaults true (Phase-4 wrappers wrap USDC). An unknown-price asset (false) is shown in its own
   * unit and NEVER folded into the USD total (no oracle invented) — data-model §5.
   */
  readonly usdPriced?: boolean;
}

export interface DerivedPortfolio {
  readonly vaultValue: number; // USDC value of the LAUNCH vault position (6-dp source)
  readonly idleUsdc: number; // idle wallet USDC (6-dp source)
  readonly sharesNum: number; // launch vault shares (6-dp source: ERC-4626 share decimals == USDC)
  readonly ethBalance: number; // native ETH (18-dp source) — displayed in ETH, never USD
  readonly wrapperValue: number; // summed USD value of registered wrapper positions (USD-priced only)
  readonly totalUsd: number; // net worth in USD = launch vault + idle + USD-priced wrappers (ETH excluded)
  readonly hasPositions: boolean; // totalUsd > 0 (drives the empty state)
  readonly vaultPct: number; // launch-vault allocation share of net worth (0 when empty)
  readonly idlePct: number; // idle allocation share of net worth (0 when empty)
  readonly positions: readonly LivePosition[];
}

export function derivePortfolio(input: {
  underlying?: bigint; // convertToAssets(shares) — 6-dp USDC (launch vault)
  usdcBalance?: bigint; // idle stable — 6-dp by default (see `stableDecimals`)
  shares?: bigint; // spvUSDC — 6-dp (vault share decimals == the USDC asset's)
  ethWei?: bigint; // native ETH — 18-dp
  /** The idle stable's on-chain decimals (053; USDG/USDC are 6-dp on every supported chain). */
  stableDecimals?: number;
  /** The launch vault address, carried onto the `'vault'` position for multi-vault views. */
  vaultAddress?: `0x${string}`;
  /** Registered branded-wrapper positions to render alongside the launch vault (011 Phase 4). */
  wrappers?: readonly WrapperPositionInput[];
}): DerivedPortfolio {
  const vaultValue = toNum(input.underlying, 6);
  const idleUsdc = toNum(input.usdcBalance, input.stableDecimals ?? 6);
  const sharesNum = toNum(input.shares, 6);
  const ethBalance = toNum(input.ethWei, 18);

  // Each wrapper's USD value (only when its asset is USD-priced; an unknown-price asset is shown in
  // its own unit and excluded from the USD total — no oracle invented).
  const wrappers = input.wrappers ?? [];
  const wrapperPositions: LivePosition[] = wrappers.map((w) => {
    const dec = w.decimals ?? 6;
    const value = toNum(w.underlying, dec);
    const usdPriced = w.usdPriced ?? true;
    const wShares = toNum(w.shares, w.shareDecimals ?? dec);
    return {
      key: `ext:${w.vaultAddress.toLowerCase()}`,
      label: w.label,
      sub: `${wShares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares · Morpho`,
      valueUsd: usdPriced ? value : 0,
      shares: wShares,
      vaultAddress: w.vaultAddress,
      external: true,
    };
  });
  const wrapperValue = wrapperPositions.reduce((sum, p) => sum + p.valueUsd, 0);

  const totalUsd = vaultValue + idleUsdc + wrapperValue;
  const hasPositions = totalUsd > 0;
  // Computed directly against the total (not `100 - vaultPct`) so the split stays honest once
  // wrappers contribute to net worth. With no wrappers this is identical to the prior behavior.
  const vaultPct = hasPositions ? (vaultValue / totalUsd) * 100 : 0;
  const idlePct = hasPositions ? (idleUsdc / totalUsd) * 100 : 0;

  const positions: LivePosition[] = [
    {
      key: "vault",
      label: "Aave Yield Vault",
      sub: `${sharesNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} spvUSDC`,
      valueUsd: vaultValue,
      shares: sharesNum,
      vaultAddress: input.vaultAddress,
    },
    ...wrapperPositions,
    { key: "idle", label: "Idle USDC", sub: "in your wallet", valueUsd: idleUsdc },
  ];
  return {
    vaultValue,
    idleUsdc,
    sharesNum,
    ethBalance,
    wrapperValue,
    totalUsd,
    hasPositions,
    vaultPct,
    idlePct,
    positions,
  };
}
