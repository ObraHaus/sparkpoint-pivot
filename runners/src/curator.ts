/**
 * The curator: daily vault discovery for the AI-curated `/vault` board. **This process holds NO
 * key and signs nothing.** Its entire job is: ask the agent whether a run is due → read the Morpho
 * API for Vault V2s → corroborate every candidate against the chain itself (P12, `onchain-vaults.ts`
 * — the factory's creation logs are the source of truth) → screen/score/rank → POST the result to
 * the agent. That is what keeps the agent provably keyless (N2) while discovery still runs on its
 * own schedule.
 *
 *   ⚠️ "Run now" in the admin panel is a REQUEST marker in the agent's database. This runner reads
 *   it on its next poll (CURATOR_POLL_SEC, default 5m) and acts. The agent cannot command this
 *   process, and no route exists that could make it. Do not add one.
 *
 * FAIL-OPEN (FR-011): a failed discovery or publish records the failure (or nothing) and leaves
 * the agent's last good list and pick untouched. A failed run must never empty `/vault`. A failed
 * on-chain crawl alone degrades to API-only discovery and says so — it does not fail the run.
 *
 * The decisions live in `shared/curator-core.ts` (pure, tested); the Morpho adapter lives in
 * `shared/morpho.ts`; the on-chain crawler in `shared/onchain-vaults.ts`; this file is the loop +
 * HTTP edges.
 */

import { createPublicClient, defineChain, http, type PublicClient } from "viem";

import { forever, logger } from "./shared/log.ts";
import { fetchMorphoVaults, fetchMorphoV2Vaults } from "./shared/morpho.ts";
import {
  enumerateVaultV2Creations,
  mergeOnchainDiscovery,
  onchainApyBps,
  readVaultV2Facts,
  type VaultV2Facts,
} from "./shared/onchain-vaults.ts";
import { CHAINS, isKnownChain } from "./shared/chain.ts";
import {
  type CuratorConfig,
  type DiscoveredVault,
  decideRun,
  parseCuratorConfig,
  rejectedVaults,
  screenVaults,
  selectRecommendation,
} from "./shared/curator-core.ts";

const log = logger("curator");

const CRAWL_CONCURRENCY = 6;

type RunState = {
  chainId: number;
  source: string;
  autoPublish: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  runRequestedAt: string | null;
};

type IngestResult = { ok: boolean; stored: number; published: boolean; approved: number };

function agentHeaders(config: CuratorConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.s2sToken}`,
    // The agent's middleware requires the scoping headers on every non-exempt route and rejects the
    // call with ACCOUNT_HEADERS_INVALID (400) otherwise. The runner is a machine with no wallet; it
    // asserts the operator address that configured it. These headers scope reads and grant no
    // authority (§1.2) — the same contract `ops/testnet-bots` reports under.
    "x-owner": config.reportOwner,
    "x-account": config.reportOwner,
    "x-chain-id": String(config.chainId),
  };
}

async function agentJson<T>(config: CuratorConfig, path: string, init?: RequestInit): Promise<T> {
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...agentHeaders(config), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(config.fetchTimeoutSec * 1_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`agent ${path} -> HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function fetchRunState(config: CuratorConfig): Promise<RunState> {
  return agentJson<RunState>(config, "/curator/run-state");
}

/**
 * Ping the optional Uptime-Kuma PUSH monitor with the RUN's outcome.
 *
 * The container heartbeat answers "is this process alive and reaching the agent"; it cannot answer
 * "did discovery actually work" — a Morpho outage leaves the process healthy and the board stale.
 * So a run that published pings UP, and a run whose discovery failed pings DOWN (with the reason),
 * which is what makes a Kuma alert meaningful. Best-effort and never fatal: monitoring must not be
 * able to break the thing it monitors.
 */
export async function pushHeartbeat(
  config: CuratorConfig,
  status: "up" | "down",
  message: string,
): Promise<void> {
  if (!config.kumaPushUrl) return;
  const url = `${config.kumaPushUrl}?status=${status}&msg=${encodeURIComponent(message.slice(0, 180))}`;
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    log.warn(`kuma push failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

export async function publishRun(
  config: CuratorConfig,
  body: Record<string, unknown>,
): Promise<IngestResult> {
  return agentJson<IngestResult>(config, "/curator/ingest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}

function clientFor(config: CuratorConfig, url: string): PublicClient {
  const chain = defineChain({
    id: config.chainId,
    name: isKnownChain(config.chainId) ? CHAINS[config.chainId].name : `Chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  // ⚠️ No transport batching (see shared/chain.ts): a batched read can collapse into one oversized
  // JSON-RPC frame the node rejects, and every read then fails while the process still looks alive.
  return createPublicClient({ chain, transport: http(url) });
}

function crawlClient(config: CuratorConfig): PublicClient {
  if (!config.rpcUrl) throw new Error("crawlClient called without CURATOR_RPC_URL");
  return clientFor(config, config.rpcUrl);
}

function archiveClient(config: CuratorConfig): PublicClient {
  if (!config.archiveRpcUrl) throw new Error("archiveClient called without CURATOR_ARCHIVE_RPC_URL");
  return clientFor(config, config.archiveRpcUrl);
}

/** API lists merged: V2 wins on an address collision (V1 and V2 are different products). */
function mergeApiLists(v2: DiscoveredVault[] | null, v1: DiscoveredVault[] | null): DiscoveredVault[] {
  const byAddress = new Map<string, DiscoveredVault>();
  for (const vault of [...(v2 ?? []), ...(v1 ?? [])]) {
    const key = vault.address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, vault);
  }
  return [...byAddress.values()];
}

export type DiscoveryResult = {
  vaults: DiscoveredVault[];
  source: string;
  notes: string[];
};

/**
 * Discovery = API (rich figures) + chain (truth). The chain layer enumerates every Vault V2 the
 * factory ever created and reads its facts; API candidates absent from the logs get a DANGER
 * warning and fail screening. A crawl failure degrades to API-only and says so (FR-011).
 */
export async function discover(
  config: CuratorConfig,
  now: Date,
  client?: PublicClient,
): Promise<DiscoveryResult> {
  const [v2, v1] = await Promise.allSettled([
    fetchMorphoV2Vaults(config, now),
    fetchMorphoVaults(config, now),
  ]);
  const v2Vaults = v2.status === "fulfilled" ? v2.value : null;
  const v1Vaults = v1.status === "fulfilled" ? v1.value : null;
  if (v2Vaults === null && v1Vaults === null) {
    const detail = [v2, v1]
      .map((r) => (r.status === "rejected" ? String(r.reason) : ""))
      .filter(Boolean)
      .join("; ");
    throw new Error(`morpho api unavailable: ${detail.slice(0, 400)}`);
  }
  const apiVaults = mergeApiLists(v2Vaults, v1Vaults);
  const notes = [
    v2.status === "rejected" ? `vaultV2s query failed: ${String(v2.reason).slice(0, 200)}` : "",
    v1.status === "rejected" ? `vaults query failed: ${String(v1.reason).slice(0, 200)}` : "",
  ].filter(Boolean);

  if (!config.rpcUrl || !config.vaultV2Factory) {
    return { vaults: apiVaults, source: "morpho-api", notes };
  }

  const factory = config.vaultV2Factory;
  try {
    const crawl = client ?? crawlClient(config);
    const creations = await enumerateVaultV2Creations(crawl, factory);
    const apiKnown = new Set(apiVaults.map((v) => v.address.toLowerCase()));
    // Every API candidate must be verified, whatever the cap — merge() keys off the creations it
    // is given, and a dropped one would be flagged "not in the logs" for the wrong reason. Only
    // the surplus of API-unknown creations is capped.
    const known = creations.filter((c) => apiKnown.has(c.address));
    const extra = creations
      .filter((c) => !apiKnown.has(c.address))
      .slice(0, Math.max(0, config.maxVaults - known.length));
    const selected = [...known, ...extra];

    const facts = new Map<string, VaultV2Facts>();
    const apyBps = new Map<string, number | null>();
    // The lookback needs historical state, which the public chain RPC cannot serve; use the
    // optional archive RPC and degrade to "no on-chain APY" when it is not configured.
    const archive = config.archiveRpcUrl ? client ?? archiveClient(config) : null;
    const apiByAddress = new Map(apiVaults.map((v) => [v.address.toLowerCase(), v]));
    await mapWithConcurrency(selected, CRAWL_CONCURRENCY, async (creation) => {
      facts.set(creation.address, await readVaultV2Facts(crawl, factory, creation));
      // Independent on-chain APY wherever the API has no figure (known or not).
      if (archive && apiByAddress.get(creation.address)?.netApyBps == null) {
        apyBps.set(
          creation.address,
          await onchainApyBps(archive, creation.address, config.apyLookbackDays, now),
        );
      }
    });

    const vaults = mergeOnchainDiscovery(apiVaults, selected, facts, apyBps, config, now);
    const dangerCount = vaults.filter((v) => v.warnings.some((w) => w.startsWith("DANGER"))).length;
    notes.push(
      `on-chain: ${creations.length} creations, ${selected.length} verified` +
        (dangerCount > 0 ? `, ${dangerCount} with danger warnings` : ""),
    );
    return { vaults, source: "morpho-api+onchain", notes };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (config.onchainRequired) {
      // The crawl is configured and REQUIRED: publishing now would skip FR-020 gate verification
      // for every candidate. Fail the run instead — the agent keeps the last good list and pick.
      throw new Error(`on-chain crawl failed (CURATOR_ONCHAIN_REQUIRED=true): ${detail.slice(0, 300)}`);
    }
    log.warn(`on-chain crawl failed: ${detail.slice(0, 200)} — continuing API-only (fail-open)`);
    notes.push(`on-chain crawl failed: ${detail.slice(0, 200)}`);
    return { vaults: apiVaults, source: "morpho-api", notes };
  }
}

/** One discovery run: fetch, screen, rank, and report. Never throws for a SOURCE failure. */
export async function runOnce(config: CuratorConfig, asOf: Date): Promise<void> {
  const runKey = `curator-${config.chainId}-${asOf.toISOString()}`;

  let discovered: DiscoveredVault[];
  let source = "morpho-api";
  let notes: string[] = [];
  try {
    const result = await discover(config, asOf);
    discovered = result.vaults;
    source = result.source;
    notes = result.notes;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`discovery failed: ${detail} — reporting a failed run; the last good record stays`);
    // The agent stores the failure on its state row ONLY: the list and pick are untouched.
    await publishRun(config, {
      runKey,
      asOf: asOf.toISOString(),
      source: "morpho-api",
      ok: false,
      error: detail.slice(0, 500),
      vaults: [],
      rejected: [],
      pick: null,
      alternates: [],
    });
    await pushHeartbeat(config, "down", `discovery failed: ${detail}`);
    return;
  }

  for (const note of notes) log.warn(note);
  const base = { runKey, asOf: asOf.toISOString(), source };

  const screened = screenVaults(discovered, config, asOf);
  const accepted = screened.filter((v) => v.screened);
  const rejected = rejectedVaults(screened);
  const { pick, alternates } = selectRecommendation(screened);

  if (discovered.length === 0) {
    log.info(`no vaults on chain ${config.chainId} yet (source ${source}) — honest empty run`);
  } else {
    const reasonCounts = new Map<string, number>();
    for (const r of rejected) {
      for (const reason of r.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const summary = [...reasonCounts.entries()].map(([code, n]) => `${code}:${n}`).join(" ");
    log.info(
      `screened ${discovered.length} discovered -> ${accepted.length} accepted, ` +
        `${rejected.length} out (${summary || "none"})`,
    );
    if (accepted.length === 0) {
      log.warn("every discovered vault failed screening — proposing nothing is the honest result");
    }
  }

  const result = await publishRun(config, {
    ...base,
    ok: true,
    vaults: accepted.map((v) => ({
      address: v.address,
      label: v.label,
      screened: v.screened,
      score: v.score,
      scoreInputs: v.scoreInputs,
      screening: v.screening,
      assetAddress: v.assetAddress,
      assetSymbol: v.assetSymbol,
      assetDecimals: v.assetDecimals,
      curator: v.curator,
      curatorVerified: v.curatorVerified,
      listed: v.listed,
      netApyBps: v.netApyBps,
      tvlUsd: v.tvlUsd,
      liquidityUsd: v.liquidityUsd,
      ageSeconds: v.ageSeconds,
    })),
    rejected: rejected.slice(0, 50),
    pick,
    alternates,
  });

  log.info(
    `run reported: pick ${pick?.address ?? "(none)"}, published=${result.published}, ` +
      `approved=${result.approved}`,
  );
  await pushHeartbeat(
    config,
    "up",
    `${discovered.length} discovered, ${accepted.length} screened, published=${result.published}`,
  );
}

async function main(): Promise<void> {
  const config = parseCuratorConfig(process.env);
  log.info(
    `curating chain ${config.chainId} via ${config.morphoUrl} every ${config.intervalSec}s ` +
      `(poll ${config.pollSec}s, assets ${config.assetAllowlist.join(",")}; keyless)`,
  );
  log.info(
    config.rpcUrl && config.vaultV2Factory
      ? `on-chain crawl ON: factory ${config.vaultV2Factory} via ${config.rpcUrl}` +
          (config.archiveRpcUrl ? " (+ archive lookback)" : " (no archive — APY lookback off)")
      : "on-chain crawl OFF (CURATOR_RPC_URL unset) — API-only discovery",
  );

  await forever(
    log,
    "tick",
    () => config.pollSec * 1_000,
    async () => {
      const state = await fetchRunState(config);
      const decision = decideRun({
        now: new Date(),
        lastRunAt: state.lastRunAt,
        runRequestedAt: state.runRequestedAt,
        intervalSec: config.intervalSec,
      });
      if (!decision.due) {
        log.info(`not due (${decision.reason}); checking again in ${config.pollSec}s`);
        return;
      }
      log.info(`running discovery (${decision.reason}); autoPublish=${state.autoPublish}`);
      await runOnce(config, new Date());
    },
    "curator",
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
