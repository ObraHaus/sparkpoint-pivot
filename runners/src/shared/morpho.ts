/**
 * The Morpho GraphQL adapter — one of the curator's two sources (the other is the chain itself,
 * `onchain-vaults.ts`).
 *
 * Shape verified against the live API on 2026-09-19 (`api.morpho.org/graphql`):
 *
 *   vaultV2s(first, orderBy: TotalAssetsUsd, orderDirection: Desc, where: {chainId_in: [$chain]}) {
 *     items { address name symbol listed creationTimestamp
 *             asset { address symbol decimals }
 *             curator { address }
 *             totalAssetsUsd liquidityUsd netApy performanceFee managementFee } }
 *   vaults(...)   # V1/MetaMorpho, same shape as before
 *
 * ⚠️ Two corrections worth keeping:
 *   1. The endpoint is `api.morpho.org/graphql`; `blue-api.morpho.org` is the legacy host.
 *   2. On chain 4663 the vaults are **Vault V2s** — the V1 `vaults(...)` query returns `items: []`
 *      there, which is a VALID response and NOT evidence that the chain is empty. The chain has had
 *      V2 vaults since July 2026; `vaultV2s(...)` is the query that sees them.
 *
 * The parser is deliberately defensive — this is third-party JSON. Anything malformed is DROPPED
 * rather than guessed at; a vault we cannot parse is not a vault we can screen.
 */

import type { CuratorConfig, DiscoveredVault } from "./curator-core.ts";
import { isAddress } from "./curator-core.ts";

export const MORPHO_VAULTS_QUERY = `
query CuratorVaults($chainId: Int!, $first: Int!) {
  vaults(
    first: $first
    orderBy: TotalAssetsUsd
    orderDirection: Desc
    where: { chainId_in: [$chainId] }
  ) {
    items {
      address
      name
      symbol
      listed
      creationTimestamp
      asset { address symbol decimals }
      liquidity { underlying usd }
      state {
        totalAssetsUsd
        netApy
        curator
        curators { name verified }
      }
      warnings { type level }
    }
  }
}
`.trim();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Parse one GraphQL vault item. `label` prefers the human name and falls back to the symbol then
 * the address — never a fabricated name. `ageSeconds` is relative to `now` so the value stored on
 * every row is consistent within a run.
 */
export function parseMorphoVault(item: unknown, now: Date): DiscoveredVault | null {
  const record = asRecord(item);
  if (!record) return null;
  const address = asString(record.address);
  if (!isAddress(address)) return null;

  const asset = asRecord(record.asset);
  const liquidity = asRecord(record.liquidity);
  const state = asRecord(record.state);
  const curators = asArray(state?.curators);
  const firstCurator = asRecord(curators[0]);

  const creationTimestamp = asNumber(record.creationTimestamp);
  const ageSeconds =
    creationTimestamp === null ? null : Math.max(0, Math.floor(now.getTime() / 1000 - creationTimestamp));

  // netApy arrives as a FRACTION (0.044 = 4.4%); the store speaks basis points.
  const netApy = asNumber(state?.netApy);
  const netApyBps = netApy === null ? null : Math.round(netApy * 10_000);

  const curatorName = asString(firstCurator?.name);
  const curatorAddress = asString(state?.curator);
  const warnings = asArray(record.warnings)
    .map((w) => {
      const warning = asRecord(w);
      const type = asString(warning?.type) ?? "warning";
      const level = asString(warning?.level) ?? "UNKNOWN";
      return `${type}:${level}`;
    })
    .filter(Boolean);

  return {
    address: address.toLowerCase(),
    label: asString(record.name) ?? asString(record.symbol) ?? address,
    assetAddress: asString(asset?.address)?.toLowerCase() ?? null,
    assetSymbol: asString(asset?.symbol),
    assetDecimals: asNumber(asset?.decimals),
    curator: curatorName ?? curatorAddress,
    curatorVerified: asBool(firstCurator?.verified),
    listed: asBool(record.listed),
    netApyBps,
    tvlUsd: asNumber(state?.totalAssetsUsd),
    liquidityUsd: asNumber(liquidity?.usd),
    ageSeconds,
    warnings,
  };
}

/** Parse a full GraphQL response body. Malformed entries are dropped, never guessed at. */
export function parseMorphoResponse(payload: unknown, now: Date = new Date()): DiscoveredVault[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const vaults = asRecord(data?.vaults);
  return asArray(vaults?.items)
    .map((item) => parseMorphoVault(item, now))
    .filter((v): v is DiscoveredVault => v !== null);
}

/** The GraphQL errors array from a 200 response, as human strings (empty when there is none). */
export function graphqlErrors(payload: unknown): string[] {
  const root = asRecord(payload);
  return asArray(root?.errors)
    .map((e) => asString(asRecord(e)?.message) ?? "unknown GraphQL error")
    .filter(Boolean);
}

// ── Vault V2 (the shape that actually exists on 4663) ────────────────────────────────────────────

export const MORPHO_VAULT_V2S_QUERY = `
query CuratorVaultV2s($chainId: Int!, $first: Int!) {
  vaultV2s(
    first: $first
    orderBy: TotalAssetsUsd
    orderDirection: Desc
    where: { chainId_in: [$chainId] }
  ) {
    items {
      address
      name
      symbol
      listed
      creationTimestamp
      asset { address symbol decimals }
      curator { address }
      totalAssetsUsd
      liquidityUsd
      netApy
      performanceFee
      managementFee
    }
  }
}
`.trim();

/**
 * Parse one `vaultV2s` item. `netApy` arrives as a FRACTION (0.0359 = 3.59%); the store speaks
 * basis points. Fee floats are fractions too and are surfaced as informational warnings — they
 * stack under our wrapper's fee and the disclosure must state them.
 */
export function parseMorphoV2Vault(item: unknown, now: Date): DiscoveredVault | null {
  const record = asRecord(item);
  if (!record) return null;
  const address = asString(record.address);
  if (!isAddress(address)) return null;

  const asset = asRecord(record.asset);
  const curator = asRecord(record.curator);
  const creationTimestamp = asNumber(record.creationTimestamp);
  const ageSeconds =
    creationTimestamp === null
      ? null
      : Math.max(0, Math.floor(now.getTime() / 1000 - creationTimestamp));

  const netApy = asNumber(record.netApy);
  const netApyBps = netApy === null ? null : Math.round(netApy * 10_000);

  const warnings: string[] = [];
  const performanceFee = asNumber(record.performanceFee);
  const managementFee = asNumber(record.managementFee);
  if (performanceFee !== null && performanceFee > 0) {
    warnings.push(`source fee: performance ${Math.round(performanceFee * 10_000) / 100}%`);
  }
  if (managementFee !== null && managementFee > 0) {
    warnings.push(`source fee: management ${Math.round(managementFee * 10_000) / 100}%`);
  }

  return {
    address: address.toLowerCase(),
    label: asString(record.name) ?? asString(record.symbol) ?? address,
    assetAddress: asString(asset?.address)?.toLowerCase() ?? null,
    assetSymbol: asString(asset?.symbol),
    assetDecimals: asNumber(asset?.decimals),
    curator: asString(curator?.address)?.toLowerCase() ?? null,
    curatorVerified: false,
    listed: asBool(record.listed),
    netApyBps,
    tvlUsd: asNumber(record.totalAssetsUsd),
    liquidityUsd: asNumber(record.liquidityUsd),
    ageSeconds,
    warnings,
  };
}

export function parseMorphoV2Response(payload: unknown, now: Date = new Date()): DiscoveredVault[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const vaults = asRecord(data?.vaultV2s);
  return asArray(vaults?.items)
    .map((item) => parseMorphoV2Vault(item, now))
    .filter((v): v is DiscoveredVault => v !== null);
}

/** Fetch + parse the configured chain's Vault V2s (see the header for why this is the V2 query). */
export async function fetchMorphoV2Vaults(
  config: CuratorConfig,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredVault[]> {
  const response = await fetchImpl(config.morphoUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: MORPHO_VAULT_V2S_QUERY,
      variables: { chainId: config.chainId, first: config.maxVaults },
    }),
    signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
  });
  if (!response.ok) {
    throw new Error(`morpho api -> HTTP ${response.status} ${response.statusText}`);
  }
  const payload: unknown = await response.json();
  const errors = graphqlErrors(payload);
  if (errors.length > 0) {
    throw new Error(`morpho api GraphQL error: ${errors.join("; ")}`);
  }
  return parseMorphoV2Response(payload, now);
}

/**
 * Fetch + parse the configured chain's vaults. Throws on transport/HTTP/GraphQL failure so the
 * caller can report an honest failed run (which stores nothing and leaves the last good record).
 */
export async function fetchMorphoVaults(
  config: CuratorConfig,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredVault[]> {
  const response = await fetchImpl(config.morphoUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: MORPHO_VAULTS_QUERY,
      variables: { chainId: config.chainId, first: config.maxVaults },
    }),
    signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
  });
  if (!response.ok) {
    throw new Error(`morpho api -> HTTP ${response.status} ${response.statusText}`);
  }
  const payload: unknown = await response.json();
  const errors = graphqlErrors(payload);
  if (errors.length > 0) {
    throw new Error(`morpho api GraphQL error: ${errors.join("; ")}`);
  }
  return parseMorphoResponse(payload, now);
}
