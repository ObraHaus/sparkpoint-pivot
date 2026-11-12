/**
 * Pure display rules for the single `/vault` list.
 *
 * The page used to render two surfaces: "Earn across chains" rows and the curated board's
 * "All live vaults" cards. This module is the shared, testable logic for the merged list:
 * chain/protocol tags, the tag filter, and the honest balance display state machine.
 *
 * PURE: no React, no fetch, no clock read. The component injects every value, so the rules can be
 * unit-tested and a card can never invent a balance it did not read.
 */

export const DASH = "—";
export const ALL = "all";
export const READING = "Reading…";
export const UNAVAILABLE = "Unavailable";

/** A list item's filterable identity. */
export interface TaggedVault {
  readonly chain: string;
  readonly protocol: string;
  readonly live: boolean;
}

export interface VaultTagFilter {
  readonly chain: string;
  readonly protocol: string;
}

export function emptyFilter(): VaultTagFilter {
  return { chain: ALL, protocol: ALL };
}

// ── chain tags ───────────────────────────────────────────────────────────────────────────────────

const CHAIN_LABELS: Record<string, string> = {
  near: "NEAR",
  base: "Base",
  baseSepolia: "Base Sepolia",
  sol: "Solana",
  eth: "Ethereum",
  ethereum: "Ethereum",
  robinhood: "Robinhood Chain",
  robinhoodTestnet: "Robinhood Testnet",
};

/** Normalise the earn registry's chain slug into the list's chain tag. */
export function chainKeyFromSlug(chain: string | null | undefined): string {
  const key = (chain ?? "").trim();
  if (!key) return "unknown";
  if (key === "ethereum") return "eth";
  if (key === "robinhoodMainnet") return "robinhood";
  return key;
}

/** Map a numeric EVM chain id to the list's chain tag (Base, Ethereum, Robinhood, …). */
export function chainKeyFromId(chainId: number | null | undefined): string {
  switch (chainId) {
    case 8453:
      return "base";
    case 84532:
      return "baseSepolia";
    case 1:
      return "eth";
    case 4663:
      return "robinhood";
    case 46630:
      return "robinhoodTestnet";
    default:
      return chainId === null || chainId === undefined ? "unknown" : `chain:${chainId}`;
  }
}

/** Human chain label for a tag (unknown tags degrade to their own text, never a wrong chain). */
export function chainDisplayName(chain: string): string {
  return CHAIN_LABELS[chain] ?? chain.replace(/^chain:/, "Chain ");
}

// ── protocol tags ────────────────────────────────────────────────────────────────────────────────

/** Curated-board `source` → protocol tag. The board is a Morpho curator today. */
export function protocolKeyFromSource(source: string | null | undefined): string {
  return normalizeProtocolKey(source);
}

/** One filter key per protocol: every Morpho source variant (e.g. "morpho-api+onchain") is "morpho". */
export function normalizeProtocolKey(protocol: string | null | undefined): string {
  const key = (protocol ?? "").trim().toLowerCase();
  if (!key || key.startsWith("morpho")) return "morpho";
  return key;
}

export function protocolDisplayName(protocol: string): string {
  if (protocol === "kamino") return "Kamino";
  if (protocol === "rhea") return "Rhea";
  if (protocol === "morpho" || protocol.toLowerCase().startsWith("morpho")) return "Morpho";
  return protocol.charAt(0).toUpperCase() + protocol.slice(1);
}

/** The honest live/preview distinction. */
export function liveDisplayName(live: boolean): string {
  return live ? "Live deposit" : "Preview";
}

// ── filter ───────────────────────────────────────────────────────────────────────────────────────

export function matchesTagFilter(item: TaggedVault, filter: VaultTagFilter): boolean {
  if (filter.chain !== ALL && item.chain !== filter.chain) return false;
  if (filter.protocol !== ALL && normalizeProtocolKey(item.protocol) !== normalizeProtocolKey(filter.protocol)) {
    return false;
  }
  return true;
}

/** Filter by chain and/or protocol. An "all" side means no constraint on that axis. */
export function filterVaults<T extends TaggedVault>(items: readonly T[], filter: VaultTagFilter): T[] {
  return items.filter((item) => matchesTagFilter(item, filter));
}

/** The distinct chain/protocol tags present, in first-seen order. */
export function collectFilterValues<T extends TaggedVault>(
  items: readonly T[],
  key: "chain" | "protocol",
): string[] {
  const seen: string[] = [];
  for (const item of items) {
    const value = key === "protocol" ? normalizeProtocolKey(item.protocol) : item[key];
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

/** True when any filter is active (the UI must always offer a way back to "all"). */
export function hasActiveFilter(filter: VaultTagFilter): boolean {
  return filter.chain !== ALL || filter.protocol !== ALL;
}

/**
 * The chains and protocols the product can list, independent of what has loaded so far. The
 * `/vault` board reads two sources (the curated board and the earn registry); without this the
 * chip row would briefly show only the first source's values and then grow under the user.
 */
export const KNOWN_CHAINS = ["robinhood", "base", "near", "sol"] as const;
export const KNOWN_PROTOCOLS = ["morpho", "rhea", "kamino"] as const;

/** Union of the values present in the list and the known values, preserving first-seen order. */
export function mergeFilterValues(
  present: readonly string[],
  known: readonly string[],
): string[] {
  const out = [...present];
  for (const value of known) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

// ── balances ────────────────────────────────────────────────────────────────────────────────────

/**
 * The account a Rhea read should use, and whether a NEAR wallet is available to SIGN for it.
 *
 * `source="near"` is a directly connected NEAR wallet (Meteor/Near Connect) and is always preferred.
 * `source="mca"` is the Multichain Account derived from the signed-in EVM wallet — the SAME account
 * the portfolio path reads — which is enough to READ a balance and resolve Max, but NOT to sign a
 * NEAR transaction. `source=null` means no Rhea account could be resolved.
 */
export interface RheaAccount {
  readonly account: string | null;
  readonly source: "near" | "mca" | null;
  /** True only when a connected NEAR wallet can sign; an MCA-only account cannot. */
  readonly canSign: boolean;
}

/** Direct NEAR wallet wins; otherwise fall back to the EVM session's MCA; otherwise none. */
export function resolveRheaAccount(
  directNear: string | null | undefined,
  mca: string | null | undefined,
): RheaAccount {
  const near = directNear?.trim() || null;
  if (near) return { account: near, source: "near", canSign: true };
  const derived = mca?.trim() || null;
  if (derived) return { account: derived, source: "mca", canSign: false };
  return { account: null, source: null, canSign: false };
}

export type BalanceState = "disconnected" | "loading" | "error" | "value";

export interface BalanceDisplay {
  readonly state: BalanceState;
  readonly text: string;
}

export interface BalanceInput {
  /** Is the wallet for THIS chain connected? (NEAR for Rhea, EVM for Morpho, Solana for Kamino.) */
  readonly connected: boolean;
  /** The wallet the read belongs to; when it differs from `currentAccount` the value is stale. */
  readonly valueAccount?: string | null;
  readonly currentAccount?: string | null;
  readonly loading?: boolean;
  readonly error?: boolean;
  /** A formatted amount (e.g. "1.25 USDC"); `null`/`undefined` means not read yet, never zero. */
  readonly value?: string | null;
}

function sameAccount(value: string | null | undefined, current: string | null | undefined): boolean {
  if (!value || !current) return true;
  return value === current;
}

/**
 * The one place a card decides what "Your balance" says.
 *
 * - no wallet on that chain → "—" (the only time a dash is allowed);
 * - a read for a previous account → loading, never the old amount;
 * - loading → "Reading…";
 * - a failed read → "Unavailable" (never a fake 0 or a leftover number);
 * - a successful read → the value, including a genuine "0 USDC".
 */
export function balanceDisplay(input: BalanceInput): BalanceDisplay {
  if (!input.connected) return { state: "disconnected", text: DASH };
  if (!sameAccount(input.valueAccount, input.currentAccount)) {
    return { state: "loading", text: READING };
  }
  if (input.error) return { state: "error", text: UNAVAILABLE };
  if (input.loading) return { state: "loading", text: READING };
  const value = input.value?.trim();
  if (!value) return { state: "loading", text: READING };
  return { state: "value", text: value };
}

/** Exact raw units → a plain decimal string (no float, no exponent). */
export function formatRawAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText =
    decimals === 0 ? "" : fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fractionText ? `${whole}.${fractionText}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/**
 * A Morpho/ERC-4626 position as USD-pegged asset units.
 *
 * `assetsRaw` is the vault's own `convertToAssets(shares)` result — NOT the raw share count. The
 * caller must pass the converted value; when it has not been read this returns `null` so the card
 * can stay in a loading/unavailable state rather than presenting shares as USDC.
 */
export function morphoPositionValue(
  shares: bigint | null | undefined,
  assetsRaw: bigint | null | undefined,
  assetDecimals = 6,
): string | null {
  if (shares === null || shares === undefined) return null;
  if (shares === 0n) return "0";
  if (assetsRaw === null || assetsRaw === undefined) return null;
  return formatRawAmount(assetsRaw, assetDecimals);
}
