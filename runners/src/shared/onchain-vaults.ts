/**
 * P12 — on-chain Vault V2 discovery + eligibility verification.
 *
 * Why this exists: the Morpho GraphQL API is an INDEXER. It lags new deployments, it can go blind
 * for a chain, and it is a third party we cannot audit. The chain is the source of truth. So every
 * curator run also enumerates Vault V2s straight from the factory's `CreateVaultV2` logs (block 0 →
 * head, no API), reads their facts on-chain, and cross-checks every API candidate against them. An
 * API vault that is NOT in the factory's logs gets a DANGER warning and fails screening.
 *
 * What the chain can and cannot answer, stated honestly:
 *   - yes: existence, asset, totalAssets, fees, curator/owner, size, age, gate abdication (FR-020)
 *   - no:  USD liquidity depth, listing status, reward-adjusted net APY. Those stay null and fail
 *          screening (FR-008: a missing figure is UNKNOWN, never zero) unless the API supplies them
 *          or a share-price lookback can derive an APY (needs an archive RPC).
 *
 * Two documented approximations, never silent:
 *   - USD TVL for a known stable asset (`stableAssets`) is valued 1:1; a warning says so.
 *   - On-chain APY is annualized share-price growth over `apyLookbackDays` — a point-in-time sample,
 *     not a rewards-inclusive net APY; a warning says so.
 *
 * Still keyless: reading the chain needs no key and this module produces no transaction.
 */

import { parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";

import type { CuratorConfig, DiscoveredVault } from "./curator-core.ts";
import { isAddress } from "./curator-core.ts";

export const CREATE_VAULT_V2_EVENT = parseAbiItem(
  "event CreateVaultV2(address indexed owner, address indexed asset, bytes32 salt, address indexed newVaultV2)",
);

export const VAULT_V2_FACTORY_ABI = parseAbi([
  "function isVaultV2(address account) view returns (bool)",
]);

export const VAULT_V2_ABI = parseAbi([
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function curator() view returns (address)",
  "function owner() view returns (address)",
  "function performanceFee() view returns (uint256)",
  "function managementFee() view returns (uint256)",
  "function abdicated(bytes4 selector) view returns (bool)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

export const ERC20_METADATA_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** FR-020: these three setters must be abdicated or a gate could block the wrapper's transfers. */
export const GATE_SETTERS = [
  { name: "setReceiveSharesGate", selector: "0x2cb19f98" },
  { name: "setSendSharesGate", selector: "0xc21ad028" },
  { name: "setReceiveAssetsGate", selector: "0x04dbf0ce" },
] as const;

/** One factory creation, with the block timestamp that makes `ageSeconds` honest. */
export type VaultV2Creation = {
  address: string;
  owner: string;
  asset: string;
  salt: string;
  blockNumber: bigint;
  createdAt: number;
};

export type VaultV2Facts = {
  address: string;
  createdAt: number;
  isVaultV2: boolean;
  assetAddress: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  vaultName: string | null;
  vaultSymbol: string | null;
  totalAssets: bigint | null;
  totalSupply: bigint | null;
  /** WAD (1e18 = 100%) as read from the vault; null when unreadable. */
  performanceFee: bigint | null;
  managementFee: bigint | null;
  curator: string | null;
  owner: string | null;
  gatesAbdicated: boolean;
  /** DANGER-prefixed entries fail screening (the `warnings` verdict). Others are informational. */
  warnings: string[];
};

const SHARE_UNIT = 10n ** 18n;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function wadPercent(fee: bigint): number {
  return Math.round((Number(fee) / 1e18) * 10_000) / 100;
}

async function getLogsChunked(
  client: PublicClient,
  address: Address,
  from: bigint,
  to: bigint,
  minChunk: bigint,
): Promise<unknown[]> {
  try {
    const logs = await client.getLogs({
      address,
      event: CREATE_VAULT_V2_EVENT,
      fromBlock: from,
      toBlock: to,
    });
    return logs as unknown[];
  } catch (error) {
    const span = to - from + 1n;
    if (span <= minChunk) throw error;
    const mid = from + span / 2n;
    const left = await getLogsChunked(client, address, from, mid - 1n, minChunk);
    const right = await getLogsChunked(client, address, mid, to, minChunk);
    return [...left, ...right];
  }
}

/**
 * Every Vault V2 the factory has ever created: `CreateVaultV2` logs from `fromBlock` (default: the
 * genesis the RPC can serve, 0) to head. A provider that caps `eth_getLogs` ranges makes this split
 * the range recursively until each chunk is servable — correctness does not depend on one big call.
 */
export async function enumerateVaultV2Creations(
  client: PublicClient,
  factory: string,
  {
    fromBlock = 0n,
    toBlock,
    minChunk = 10_000n,
  }: { fromBlock?: bigint; toBlock?: bigint; minChunk?: bigint } = {},
): Promise<VaultV2Creation[]> {
  if (!isAddress(factory)) throw new Error(`factory is not an address: ${factory}`);
  const head = toBlock ?? (await client.getBlockNumber());
  const logs = await getLogsChunked(client, factory as Address, fromBlock, head, minChunk);

  const byBlock = new Map<bigint, number>();
  const creations: VaultV2Creation[] = [];
  const seen = new Set<string>();

  for (const raw of logs) {
    const log = raw as {
      args?: { owner?: unknown; asset?: unknown; salt?: unknown; newVaultV2?: unknown };
      blockNumber?: bigint | null;
    };
    const vault = typeof log.args?.newVaultV2 === "string" ? log.args.newVaultV2 : null;
    const owner = typeof log.args?.owner === "string" ? log.args.owner : null;
    const asset = typeof log.args?.asset === "string" ? log.args.asset : null;
    const salt = typeof log.args?.salt === "string" ? log.args.salt : null;
    const blockNumber = log.blockNumber ?? null;
    if (!isAddress(vault) || !isAddress(owner) || !isAddress(asset) || !salt || blockNumber === null) {
      continue;
    }
    const key = vault.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let timestamp = byBlock.get(blockNumber);
    if (timestamp === undefined) {
      const block = await client.getBlock({ blockNumber });
      timestamp = Number(block.timestamp);
      byBlock.set(blockNumber, timestamp);
    }
    creations.push({
      address: key,
      owner: owner.toLowerCase(),
      asset: asset.toLowerCase(),
      salt,
      blockNumber,
      createdAt: timestamp,
    });
  }

  creations.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  return creations;
}

async function tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Read everything the chain can answer about one vault, plus the FR-020 danger verdicts. */
export async function readVaultV2Facts(
  client: PublicClient,
  factory: string,
  creation: VaultV2Creation,
): Promise<VaultV2Facts> {
  const vault = creation.address as Address;
  const warnings: string[] = [];

  const isVault = await tryRead(async () =>
    Boolean(
      await client.readContract({
        address: factory as Address,
        abi: VAULT_V2_FACTORY_ABI,
        functionName: "isVaultV2",
        args: [vault],
      }),
    ),
  );
  if (isVault === false) {
    warnings.push("DANGER: the VaultV2Factory does not recognise this address as a Vault V2");
  }

  const [assetAddress, vaultName, vaultSymbol, totalAssets, totalSupply, curator, owner, performanceFee, managementFee] =
    await Promise.all([
      tryRead(async () =>
        String(
          await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "asset",
          }),
        ).toLowerCase(),
      ),
      tryRead(async () =>
        String(
          await client.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: "name" }),
        ),
      ),
      tryRead(async () =>
        String(
          await client.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: "symbol" }),
        ),
      ),
      tryRead(
        async () =>
          (await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "totalAssets",
          })) as bigint,
      ),
      tryRead(
        async () =>
          (await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "totalSupply",
          })) as bigint,
      ),
      tryRead(async () =>
        String(
          await client.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: "curator" }),
        ).toLowerCase(),
      ),
      tryRead(async () =>
        String(
          await client.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: "owner" }),
        ).toLowerCase(),
      ),
      tryRead(
        async () =>
          (await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "performanceFee",
          })) as bigint,
      ),
      tryRead(
        async () =>
          (await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "managementFee",
          })) as bigint,
      ),
    ]);

  const gateResults = await Promise.all(
    GATE_SETTERS.map((gate) =>
      tryRead(async () =>
        Boolean(
          await client.readContract({
            address: vault,
            abi: VAULT_V2_ABI,
            functionName: "abdicated",
            args: [gate.selector],
          }),
        ),
      ),
    ),
  );
  const gatesAbdicated = gateResults.every((ok) => ok === true);
  if (!gatesAbdicated) {
    const failing = GATE_SETTERS.filter((_, i) => gateResults[i] !== true).map((g) => g.name);
    warnings.push(
      `DANGER: gate setter(s) not abdicated (${failing.join(", ")}) — a gate could block the wrapper (FR-020)`,
    );
  }

  const [assetSymbol, assetDecimals] = assetAddress
    ? await Promise.all([
        tryRead(async () =>
          String(
            await client.readContract({
              address: assetAddress as Address,
              abi: ERC20_METADATA_ABI,
              functionName: "symbol",
            }),
          ),
        ),
        tryRead(
          async () =>
            Number(
              await client.readContract({
                address: assetAddress as Address,
                abi: ERC20_METADATA_ABI,
                functionName: "decimals",
              }),
            ),
        ),
      ])
    : [null, null];

  if (performanceFee !== null && performanceFee > 0n) {
    warnings.push(`source fee: performance ${wadPercent(performanceFee)}%`);
  }
  if (managementFee !== null && managementFee > 0n) {
    warnings.push(`source fee: management ${wadPercent(managementFee)}%`);
  }
  if (assetSymbol === null) {
    warnings.push("asset metadata unreadable on-chain");
  }

  return {
    address: vault.toLowerCase(),
    createdAt: creation.createdAt,
    isVaultV2: isVault === true,
    assetAddress,
    assetSymbol,
    assetDecimals,
    vaultName,
    vaultSymbol,
    totalAssets,
    totalSupply,
    performanceFee,
    managementFee,
    curator,
    owner,
    gatesAbdicated,
    warnings,
  };
}

// ── on-chain APY (share-price lookback) ──────────────────────────────────────────────────────────

/** Binary-search the first block whose timestamp is >= `timestamp`. Null when the chain can't say. */
export async function findBlockAtOrAfterTimestamp(
  client: PublicClient,
  timestamp: bigint,
): Promise<bigint | null> {
  try {
    const head = await client.getBlockNumber();
    const headBlock = await client.getBlock({ blockNumber: head });
    if (headBlock.timestamp < timestamp) return null;
    let lo = 0n;
    let hi = head;
    while (lo < hi) {
      const mid = lo + (hi - lo) / 2n;
      const block = await client.getBlock({ blockNumber: mid });
      if (block.timestamp < timestamp) lo = mid + 1n;
      else hi = mid;
    }
    return lo;
  } catch {
    return null;
  }
}

/** Assets per 1e18 shares (the vault's own conversion, so decimals offsets are handled). */
export async function sharePrice(
  client: PublicClient,
  vault: string,
  blockNumber?: bigint,
): Promise<number | null> {
  try {
    const value = (await client.readContract({
      address: vault as Address,
      abi: VAULT_V2_ABI,
      functionName: "convertToAssets",
      args: [SHARE_UNIT],
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })) as bigint;
    return Number(value) / 1e18;
  } catch {
    return null;
  }
}

/**
 * Annualized share-price growth over `lookbackDays`, in bps. Null when history is not readable
 * (a non-archive RPC refuses the old state) or the sample is degenerate. Negative values are
 * returned as-is — screening rejects them, which is the honest outcome.
 */
export async function onchainApyBps(
  client: PublicClient,
  vault: string,
  lookbackDays: number,
  now: Date = new Date(),
): Promise<number | null> {
  const head = await sharePrice(client, vault);
  if (head === null || head <= 0) return null;
  const target = BigInt(Math.floor(now.getTime() / 1000) - lookbackDays * 86_400);
  const block = await findBlockAtOrAfterTimestamp(client, target);
  if (block === null) return null;
  const old = await sharePrice(client, vault, block);
  if (old === null || old <= 0) return null;
  const ratio = head / old;
  const apy = Math.pow(ratio, 365 / lookbackDays) - 1;
  if (!Number.isFinite(apy)) return null;
  return Math.round(apy * 10_000);
}

// ── merge API enrichment with on-chain truth ────────────────────────────────────────────────────

function stableUsd(facts: VaultV2Facts, stableAssets: string[]): number | null {
  const symbol = (facts.assetSymbol ?? "").toUpperCase();
  if (!symbol || !stableAssets.includes(symbol)) return null;
  if (facts.totalAssets === null || facts.assetDecimals === null) return null;
  return Number(facts.totalAssets) / 10 ** facts.assetDecimals;
}

/**
 * Merge the API's rich-but-third-party figures with the chain's authoritative-but-sparse facts.
 * On-chain is the KEY SET: every creation gets a row. API-only rows are kept too, but flagged
 * DANGER so screening rejects them — an unverifiable candidate must never reach the board.
 *
 * ⚠️ The API is only trusted where the chain can corroborate it: asset identity, asset symbol and
 * (for configured stables) TVL are compared, and a material disagreement is a DANGER verdict. Net
 * APY and withdrawable liquidity have no on-chain equivalent and stay API-sourced — that is stated
 * in the run's notes, not silently assumed.
 */
export function mergeOnchainDiscovery(
  apiVaults: DiscoveredVault[],
  creations: VaultV2Creation[],
  factsByAddress: Map<string, VaultV2Facts>,
  apyBpsByAddress: Map<string, number | null>,
  config: CuratorConfig,
  now: Date = new Date(),
): DiscoveredVault[] {
  const apiByAddress = new Map(apiVaults.map((v) => [v.address.toLowerCase(), v]));
  const merged: DiscoveredVault[] = [];
  const onchainAddresses = new Set(creations.map((c) => c.address.toLowerCase()));

  for (const creation of creations) {
    const api = apiByAddress.get(creation.address);
    const facts = factsByAddress.get(creation.address) ?? null;
    const ageSeconds = Math.max(0, Math.floor(now.getTime() / 1000 - creation.createdAt));

    if (!facts) {
      merged.push({
        address: creation.address,
        label: `Vault V2 ${short(creation.address)}`,
        assetAddress: creation.asset,
        assetSymbol: null,
        assetDecimals: null,
        curator: null,
        curatorVerified: false,
        listed: false,
        netApyBps: null,
        tvlUsd: null,
        liquidityUsd: null,
        ageSeconds,
        warnings: ["DANGER: on-chain reads failed for an enumerated Vault V2"],
      });
      continue;
    }

    if (api) {
      const warnings = [...api.warnings, ...facts.warnings, ...crossCheck(api, facts, config)];
      merged.push({ ...api, address: creation.address, ageSeconds, warnings });
      continue;
    }

    const tvlUsd = stableUsd(facts, config.stableAssets);
    const warnings = [...facts.warnings];
    if (tvlUsd === null) {
      warnings.push("on-chain-only: no USD figure (asset is not a configured stable)");
    } else {
      warnings.push(
        "on-chain-only: TVL valued 1:1 as a stable; liquidity and listing are unavailable",
      );
    }
    const apyBps = apyBpsByAddress.get(creation.address) ?? null;
    if (apyBps !== null) {
      warnings.push(`on-chain-only: APY is ${config.apyLookbackDays}d share-price growth`);
    }
    merged.push({
      address: creation.address,
      label: facts.vaultName ?? facts.vaultSymbol ?? `Vault V2 ${short(creation.address)}`,
      assetAddress: facts.assetAddress,
      assetSymbol: facts.assetSymbol,
      assetDecimals: facts.assetDecimals,
      curator: facts.curator,
      curatorVerified: false,
      listed: false,
      netApyBps: apyBps,
      tvlUsd,
      liquidityUsd: null,
      ageSeconds,
      warnings,
    });
  }

  for (const api of apiVaults) {
    if (onchainAddresses.has(api.address.toLowerCase())) continue;
    merged.push({
      ...api,
      warnings: [
        ...api.warnings,
        "DANGER: the VaultV2Factory creation logs do not include this vault — unverifiable",
      ],
    });
  }

  merged.sort((a, b) => {
    const tvlA = a.tvlUsd ?? -1;
    const tvlB = b.tvlUsd ?? -1;
    if (tvlB !== tvlA) return tvlB - tvlA;
    return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1;
  });
  return merged.slice(0, config.maxVaults);
}

/** Relative TVL disagreement that stops being explainable by indexer lag (deposits/withdrawals). */
export const TVL_CROSSCHECK_TOLERANCE = 0.5;

/**
 * Compare the API row against chain truth for a vault both sources know. The asset is what the
 * allowlist screen keys on, so an asset mismatch is always DANGER; a stable-valued TVL that
 * disagrees by more than `TVL_CROSSCHECK_TOLERANCE` means one of the two is wrong about the size
 * of the position and is DANGER too. Net APY/liquidity are not comparable (no on-chain source).
 */
export function crossCheck(
  api: DiscoveredVault,
  facts: VaultV2Facts,
  config: CuratorConfig,
): string[] {
  const warnings: string[] = [];

  const apiAsset = api.assetAddress?.toLowerCase() ?? null;
  const chainAsset = facts.assetAddress?.toLowerCase() ?? null;
  if (apiAsset && chainAsset && apiAsset !== chainAsset) {
    warnings.push(
      `DANGER: API asset ${api.assetAddress} disagrees with the vault's on-chain asset ${facts.assetAddress}`,
    );
  }
  const apiSymbol = (api.assetSymbol ?? "").toUpperCase();
  const chainSymbol = (facts.assetSymbol ?? "").toUpperCase();
  if (apiSymbol && chainSymbol && apiSymbol !== chainSymbol) {
    warnings.push(
      `DANGER: API asset symbol ${api.assetSymbol} disagrees with on-chain ${facts.assetSymbol}`,
    );
  }

  const onchainUsd = stableUsd(facts, config.stableAssets);
  if (api.tvlUsd !== null && onchainUsd !== null && onchainUsd > 0) {
    const drift = Math.abs(api.tvlUsd - onchainUsd) / onchainUsd;
    if (drift > TVL_CROSSCHECK_TOLERANCE) {
      warnings.push(
        `DANGER: API TVL $${Math.round(api.tvlUsd).toLocaleString("en-US")} disagrees with ` +
          `on-chain $${Math.round(onchainUsd).toLocaleString("en-US")} by ` +
          `${Math.round(drift * 100)}%`,
      );
    }
  }
  return warnings;
}
