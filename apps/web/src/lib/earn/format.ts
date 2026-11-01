/**
 * 069 — display-only formatting for the Morpho earn cards.
 *
 * The agent already serializes money and APY as display strings (never floats the UI can feed back
 * into a quote). A `null` TVL/APY is a real "unknown" from the snapshot, so it renders as an em
 * dash — the card never invents a number to fill the gap.
 */

import type { EarnVault } from "@sparkpoint/shared/schemas";

const DASH = "—";

/** Chain slugs for Morpho's app (`eth` is `ethereum` there). */
export function morphoChainSlug(chain: string): string {
  return chain === "eth" ? "ethereum" : chain;
}

/** Human chain label used by the preview prompt and the row badge. */
export function chainLabel(chain: string): string {
  switch (chain) {
    case "eth":
      return "Ethereum";
    case "base":
      return "Base";
    case "arbitrum":
      return "Arbitrum";
    case "optimism":
      return "Optimism";
    case "polygon":
      return "Polygon";
    case "unichain":
      return "Unichain";
    case "world":
      return "World Chain";
    case "hyperevm":
      return "HyperEVM";
    case "katana":
      return "Katana";
    case "monad":
      return "Monad";
    case "robinhood":
      return "Robinhood Chain";
    default:
      return chain.charAt(0).toUpperCase() + chain.slice(1);
  }
}

/** `$420.7M` / `$115M` / `$12.3K` from a decimal string; `—` when absent or unparseable. */
export function formatTvl(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DASH;
  if (n >= 1_000_000_000) return `$${trim(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `$${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${trim(n / 1_000)}K`;
  return `$${trim(n)}`;
}

function trim(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

/**
 * `4.41%` from the API's display-percent string. Truncates (never rounds up) beyond two decimals
 * so a displayed APY can never be higher than the snapshot's figure. `—` when absent.
 */
export function formatNetApy(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  const truncated = Math.trunc(n * 100) / 100;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(truncated)}%`;
}

/**
 * The snapshot freshness line. A shipped fallback is called a cached snapshot; a fresh snapshot is
 * attributed to Morpho's API with its age in minutes.
 */
export function snapshotAgeCopy(
  ageMinutes: number | null | undefined,
  source: string | null | undefined,
): string {
  if (ageMinutes === null || ageMinutes === undefined || !Number.isFinite(ageMinutes)) {
    return "cached snapshot";
  }
  const age = Math.max(0, Math.floor(ageMinutes));
  if (source === "shipped") {
    return `cached snapshot, ${age} min old`;
  }
  return `data from Morpho API, ${age} min ago`;
}

export interface RailChip {
  key: "direct" | "oneclick_earn" | "intents_connect";
  label: string;
  available: boolean;
}

/**
 * The three rails, always named so a missing one is visible rather than omitted. A 1Click receipt
 * is only "live" when the last dry quote proved it; an unprobed receipt says so, and a no-liquidity
 * receipt says that instead. Intents Connect without an Aurora key is "needs key", never "live".
 */
export function railChips(vault: EarnVault): RailChip[] {
  const { direct, oneclickEarn, intentsConnect } = vault.rails;

  let oneclickLabel = "1Click Earn";
  if (!oneclickEarn.available) {
    oneclickLabel =
      oneclickEarn.liveness === "no_liquidity"
        ? "1Click Earn no liquidity"
        : "1Click Earn unavailable";
  } else if (oneclickEarn.liveness === "live") {
    oneclickLabel = "1Click Earn live";
  }

  // An unavailable Intents Connect rail is always the same honest answer: it needs the Aurora
  // key/config that this deployment does not have. A live rail says so plainly.
  const intentsLabel = intentsConnect.available ? "Intents Connect" : "Intents Connect needs key";

  return [
    { key: "direct", label: "Direct", available: direct.available },
    { key: "oneclick_earn", label: oneclickLabel, available: oneclickEarn.available },
    { key: "intents_connect", label: intentsLabel, available: intentsConnect.available },
  ];
}

/** `Deposit 100 USDC into Morpho Gauntlet USDC Prime on Base` — the row's Preview follow-up. */
export function previewPrompt(vault: EarnVault): string {
  return `Deposit 100 ${vault.asset.symbol} into Morpho ${vault.name || vault.symbol} on ${chainLabel(vault.chain)}`;
}

/** The external (non-transactional) Morpho app link for this vault. */
export function morphoVaultUrl(vault: Pick<EarnVault, "chain" | "address">): string {
  return `https://app.morpho.org/${morphoChainSlug(vault.chain)}/vault/${vault.address}`;
}
