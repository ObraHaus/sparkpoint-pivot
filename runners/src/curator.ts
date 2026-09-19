/**
 * The curator: daily vault discovery for the AI-curated `/vault` board. **This process holds NO
 * key and signs nothing.** Its entire job is: ask the agent whether a run is due → read a public
 * vault API → screen/score/rank → POST the result to the agent. That is what keeps the agent
 * provably keyless (N2) while discovery still runs on its own schedule.
 *
 *   ⚠️ "Run now" in the admin panel is a REQUEST marker in the agent's database. This runner reads
 *   it on its next poll (CURATOR_POLL_SEC, default 5m) and acts. The agent cannot command this
 *   process, and no route exists that could make it. Do not add one.
 *
 * FAIL-OPEN (FR-011): a failed discovery or publish records the failure (or nothing) and leaves
 * the agent's last good list and pick untouched. A failed run must never empty `/vault`.
 *
 * The decisions live in `shared/curator-core.ts` (pure, tested); the Morpho adapter lives in
 * `shared/morpho.ts`; this file is the loop + HTTP edges.
 */

import { forever, logger } from "./shared/log.ts";
import { fetchMorphoVaults } from "./shared/morpho.ts";
import {
  type CuratorConfig,
  decideRun,
  parseCuratorConfig,
  rejectedVaults,
  screenVaults,
  selectRecommendation,
} from "./shared/curator-core.ts";

const log = logger("curator");

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

/** One discovery run: fetch, screen, rank, and report. Never throws for a SOURCE failure. */
export async function runOnce(config: CuratorConfig, asOf: Date): Promise<void> {
  const runKey = `curator-${config.chainId}-${asOf.toISOString()}`;
  const base = { runKey, asOf: asOf.toISOString(), source: "morpho" };

  let discovered;
  try {
    discovered = await fetchMorphoVaults(config, asOf);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`discovery failed: ${detail} — reporting a failed run; the last good record stays`);
    // The agent stores the failure on its state row ONLY: the list and pick are untouched.
    await publishRun(config, {
      ...base,
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

  const screened = screenVaults(discovered, config, asOf);
  const accepted = screened.filter((v) => v.screened);
  const rejected = rejectedVaults(screened);
  const { pick, alternates } = selectRecommendation(screened);

  if (discovered.length === 0) {
    log.info(`no vaults on chain ${config.chainId} yet (source morpho) — honest empty run`);
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
