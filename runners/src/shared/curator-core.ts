/**
 * Curator core: config, screening, scoring, best-pick selection — all PURE.
 *
 * The I/O lives in `curator.ts` (HTTP + loop) and `morpho.ts` (the GraphQL adapter); everything
 * decision-shaped lives here so it is unit-testable without a chain, a clock, or a network. The
 * spec's rules this file encodes:
 *
 *   FR-002 — every candidate is screened (asset allowlist, TVL, withdrawable liquidity, age,
 *            listed, curator identity where the source has it, anomaly guard). Only screened
 *            vaults may enter the curated list, and every decision stores WHY (score inputs +
 *            verdicts verbatim).
 *   FR-003 — one best pick + two alternates, deterministically chosen (score, then TVL, then
 *            address — no ties left to iteration order).
 *   FR-008 — a missing figure is UNKNOWN and fails screening; it is never treated as 0.
 *
 * NON-CUSTODY (N1/N2): this module holds no key and produces no transaction. Its entire output is
 * a JSON report to the agent.
 */

export type CuratorConfig = {
  chainId: number;
  apiBaseUrl: string;
  s2sToken: string;
  reportOwner: string;
  morphoUrl: string;
  /**
   * Uptime-Kuma PUSH monitor URL (optional). The runner pings it UP after a run that published
   * successfully and DOWN when discovery failed, so the monitor reflects RUN health — which the
   * agent's own `/readyz` cannot see. Unset ⇒ no heartbeat, and nothing else changes.
   */
  kumaPushUrl: string | null;
  intervalSec: number;
  pollSec: number;
  fetchTimeoutSec: number;
  maxVaults: number;
  minTvlUsd: number;
  minLiquidityUsd: number;
  minAgeDays: number;
  maxNetApyBps: number;
  requireListed: boolean;
  requireVerifiedCurator: boolean;
  /** Uppercase asset symbols the chain will curate (USDC first by convention). */
  assetAllowlist: string[];
};

export type DiscoveredVault = {
  address: string;
  label: string;
  assetAddress: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  curator: string | null;
  curatorVerified: boolean;
  listed: boolean;
  /** Net APY as basis points (500 = 5.00%), or null when the source has no figure. */
  netApyBps: number | null;
  tvlUsd: number | null;
  liquidityUsd: number | null;
  ageSeconds: number | null;
  warnings: string[];
};

export type ScreeningVerdict = {
  code: string;
  ok: boolean;
  detail: string;
};

export type ScreenedVault = DiscoveredVault & {
  screened: boolean;
  score: number;
  /** The verbatim inputs the score was computed from (plus the scan timestamp). */
  scoreInputs: Record<string, number | boolean | string | null>;
  screening: ScreeningVerdict[];
};

export type RejectedVault = {
  address: string;
  reasons: string[];
};

export type Recommendation = {
  pick: { address: string; reason: string; score: number } | null;
  alternates: { address: string; reason: string; score: number }[];
};

// ── config ───────────────────────────────────────────────────────────────────────────────────────

class ConfigError extends Error {}

function envInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    // Fail loudly: silently substituting a default for a typo'd threshold is how a screen quietly
    // stops screening. The runner refuses to start rather than curating on the wrong rules.
    throw new ConfigError(`${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function envBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new ConfigError(`${name}=${raw} is not a boolean`);
}

export function parseCuratorConfig(env: NodeJS.ProcessEnv): CuratorConfig {
  const assetAllowlist = (env.CURATOR_ASSET_ALLOWLIST ?? "USDC")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (assetAllowlist.length === 0) {
    throw new ConfigError("CURATOR_ASSET_ALLOWLIST is empty — nothing could ever be curated");
  }
  const config: CuratorConfig = {
    chainId: envInt(env, "CURATOR_CHAIN_ID", 4663, { min: 1 }),
    apiBaseUrl: env.CURATOR_API_BASE_URL ?? env.AGENT_INTERNAL_URL ?? "",
    s2sToken: env.AGENT_S2S_TOKEN ?? "",
    reportOwner: env.CURATOR_REPORT_OWNER ?? env.BOT_REPORT_OWNER ?? "",
    morphoUrl: env.CURATOR_MORPHO_URL ?? "https://blue-api.morpho.org/graphql",
    kumaPushUrl: env.CURATOR_KUMA_PUSH_URL?.trim() || null,
    intervalSec: envInt(env, "CURATOR_INTERVAL_SEC", 86_400, { min: 60 }),
    pollSec: envInt(env, "CURATOR_POLL_SEC", 300, { min: 30 }),
    fetchTimeoutSec: envInt(env, "CURATOR_FETCH_TIMEOUT_SEC", 30, { min: 1 }),
    maxVaults: envInt(env, "CURATOR_MAX_VAULTS", 100, { min: 1, max: 500 }),
    minTvlUsd: envInt(env, "CURATOR_MIN_TVL_USD", 10_000, { min: 0 }),
    minLiquidityUsd: envInt(env, "CURATOR_MIN_LIQUIDITY_USD", 1_000, { min: 0 }),
    minAgeDays: envInt(env, "CURATOR_MIN_AGE_DAYS", 1, { min: 0 }),
    maxNetApyBps: envInt(env, "CURATOR_MAX_NET_APY_BPS", 10_000, { min: 1 }),
    requireListed: envBool(env, "CURATOR_REQUIRE_LISTED", true),
    requireVerifiedCurator: envBool(env, "CURATOR_REQUIRE_VERIFIED_CURATOR", false),
    assetAllowlist,
  };
  if (!config.apiBaseUrl || !config.s2sToken || !config.reportOwner) {
    throw new ConfigError(
      "CURATOR_API_BASE_URL (or AGENT_INTERNAL_URL), AGENT_S2S_TOKEN and CURATOR_REPORT_OWNER " +
        "are required — the runner reports to the agent and holds no other identity",
    );
  }
  return config;
}

// ── cadence ──────────────────────────────────────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

export type RunDecision = { due: boolean; reason: string };

/**
 * Whether a discovery run is due. Pure over (now, last success, request marker).
 *
 * A run requested by an admin always wins. Otherwise the cadence is the runner's own: it decides
 * when to ask the agent for state, and this decides whether to act on it. "Never run" is due.
 */
export function decideRun(args: {
  now: Date;
  lastRunAt: string | null;
  runRequestedAt: string | null;
  intervalSec: number;
}): RunDecision {
  if (args.runRequestedAt) return { due: true, reason: "admin requested a run" };
  if (!args.lastRunAt) return { due: true, reason: "never run" };
  const last = Date.parse(args.lastRunAt);
  if (Number.isNaN(last)) return { due: true, reason: "unparseable lastRunAt" };
  const elapsedSec = (args.now.getTime() - last) / 1000;
  if (elapsedSec >= args.intervalSec) {
    return { due: true, reason: `${Math.floor(elapsedSec)}s since the last run` };
  }
  return {
    due: false,
    reason: `last run ${Math.floor(elapsedSec)}s ago (< ${args.intervalSec}s)`,
  };
}

// ── screening ────────────────────────────────────────────────────────────────────────────────────

function verdict(code: string, ok: boolean, detail: string): ScreeningVerdict {
  return { code, ok, detail };
}

/**
 * Screen one vault. Returns the verdicts + the screener's pass/fail.
 *
 * Unknown figures FAIL (FR-008): a vault whose TVL/liquidity/age cannot be read is not a vault we
 * can claim to have screened. A zero is a value; null is not a zero.
 */
export function screenVault(
  vault: DiscoveredVault,
  config: CuratorConfig,
  now: Date = new Date(),
): ScreenedVault {
  const verdicts: ScreeningVerdict[] = [];

  verdicts.push(
    verdict(
      "address",
      isAddress(vault.address),
      isAddress(vault.address) ? "" : "not a 20-byte 0x address",
    ),
  );

  const symbol = (vault.assetSymbol ?? "").toUpperCase();
  const assetOk = symbol !== "" && config.assetAllowlist.includes(symbol);
  verdicts.push(
    verdict(
      "asset",
      assetOk,
      assetOk
        ? `${symbol} is allowlisted`
        : `asset ${vault.assetSymbol ?? "(unknown)"} is not in ${config.assetAllowlist.join(",")}`,
    ),
  );

  if (config.requireListed) {
    verdicts.push(
      verdict("listed", vault.listed, vault.listed ? "" : "source does not list this vault"),
    );
  }

  // The anomaly guard. A 300% "net APY" is a data error or a honeypot, not a yield; a negative
  // one is a product we should not recommend. Both are rejected loudly with the observed figure.
  const apyKnown = vault.netApyBps !== null && Number.isFinite(vault.netApyBps);
  const apyOk = apyKnown && vault.netApyBps! >= 0 && vault.netApyBps! <= config.maxNetApyBps;
  verdicts.push(
    verdict(
      "anomaly-apy",
      apyOk,
      apyKnown
        ? `${vault.netApyBps} bps (allowed 0..${config.maxNetApyBps})`
        : "net APY unavailable",
    ),
  );

  const tvlOk =
    vault.tvlUsd !== null && Number.isFinite(vault.tvlUsd) && vault.tvlUsd >= config.minTvlUsd;
  verdicts.push(
    verdict(
      "tvl",
      tvlOk,
      vault.tvlUsd === null
        ? "TVL unavailable"
        : `$${Math.round(vault.tvlUsd).toLocaleString("en-US")} (min $${config.minTvlUsd.toLocaleString("en-US")})`,
    ),
  );

  const liquidityOk =
    vault.liquidityUsd !== null &&
    Number.isFinite(vault.liquidityUsd) &&
    vault.liquidityUsd >= config.minLiquidityUsd;
  verdicts.push(
    verdict(
      "liquidity",
      liquidityOk,
      vault.liquidityUsd === null
        ? "withdrawable liquidity unavailable"
        : `$${Math.round(vault.liquidityUsd).toLocaleString("en-US")} ` +
            `(min $${config.minLiquidityUsd.toLocaleString("en-US")})`,
    ),
  );

  const minAgeSec = config.minAgeDays * 86_400;
  const ageOk =
    vault.ageSeconds !== null && Number.isFinite(vault.ageSeconds) && vault.ageSeconds >= minAgeSec;
  verdicts.push(
    verdict(
      "age",
      ageOk,
      vault.ageSeconds === null
        ? "age unavailable"
        : `${Math.floor(vault.ageSeconds / 86_400)}d (min ${config.minAgeDays}d)`,
    ),
  );

  if (config.requireVerifiedCurator) {
    const curatorOk = vault.curatorVerified && vault.curator !== null;
    verdicts.push(
      verdict(
        "curator",
        curatorOk,
        curatorOk ? `${vault.curator}` : "no verified curator in the source",
      ),
    );
  }

  const dangerWarnings = vault.warnings.filter((w) => /RED|DANGER|CRITICAL/i.test(w));
  verdicts.push(
    verdict(
      "warnings",
      dangerWarnings.length === 0,
      dangerWarnings.length === 0 ? "" : `source warnings: ${dangerWarnings.join(", ")}`,
    ),
  );

  const screened = verdicts.every((v) => v.ok);
  const scoreInputs = {
    netApyBps: vault.netApyBps,
    tvlUsd: vault.tvlUsd,
    liquidityUsd: vault.liquidityUsd,
    ageSeconds: vault.ageSeconds,
    curatorVerified: vault.curatorVerified,
    listed: vault.listed,
    warningCount: vault.warnings.length,
    asOf: now.toISOString(),
  };
  return {
    ...vault,
    screened,
    score: screened ? scoreVault(vault) : 0,
    scoreInputs,
    screening: verdicts,
  };
}

export function screenVaults(
  vaults: DiscoveredVault[],
  config: CuratorConfig,
  now: Date = new Date(),
): ScreenedVault[] {
  return vaults.map((v) => screenVault(v, config, now));
}

/**
 * Score a screened vault 0..100. Deterministic and documented, because every number here is the
 * "why" of a recommendation and must be reproducible from the stored inputs:
 *
 *   APY          0..40   capped at 20% (2000 bps) so an outlier cannot dominate
 *   TVL depth    0..25   up to $10M, linear
 *   liquidity    0..10   withdrawable is not the same as TVL, so it gets its own weight
 *   curator     15/8/0   verified / present / absent
 *   listed       0..5
 *   age          0..5    up to one year
 */
export function scoreVault(vault: DiscoveredVault): number {
  const apy = Math.max(0, Math.min(vault.netApyBps ?? 0, 2_000)) / 2_000;
  const tvl = Math.max(0, Math.min(vault.tvlUsd ?? 0, 10_000_000)) / 10_000_000;
  const liquidity = Math.max(0, Math.min(vault.liquidityUsd ?? 0, 10_000_000)) / 10_000_000;
  const curator = vault.curatorVerified && vault.curator ? 15 : vault.curator ? 8 : 0;
  const listed = vault.listed ? 5 : 0;
  const age = Math.max(0, Math.min(vault.ageSeconds ?? 0, 365 * 86_400)) / (365 * 86_400);
  return Math.round(40 * apy + 25 * tvl + 10 * liquidity + curator + listed + 5 * age);
}

// ── best pick ────────────────────────────────────────────────────────────────────────────────────

function usd(value: number | null): string {
  if (value === null) return "TVL unavailable";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

export function buildReason(vault: ScreenedVault): string {
  const apy = vault.netApyBps === null ? "net APY unavailable" : `${(vault.netApyBps / 100).toFixed(2)}% net APY`;
  const curator = vault.curator
    ? vault.curatorVerified
      ? `${vault.curator} (verified)`
      : vault.curator
    : "unattributed curator";
  return `Highest screen score (${vault.score}/100): ${apy}, ${usd(vault.tvlUsd)} TVL, ${curator}.`;
}

/**
 * Deterministic best pick + 2 alternates. Sorted by score desc, then TVL desc, then address asc —
 * the final key makes the order total, so two runs over the same inputs cannot disagree.
 * Returns a null pick when nothing passed screening (the honest empty result).
 */
export function selectRecommendation(vaults: ScreenedVault[]): Recommendation {
  const passed = vaults.filter((v) => v.screened).slice();
  passed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tvlA = a.tvlUsd ?? 0;
    const tvlB = b.tvlUsd ?? 0;
    if (tvlB !== tvlA) return tvlB - tvlA;
    return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1;
  });
  const [first, ...rest] = passed;
  if (first === undefined) return { pick: null, alternates: [] };
  return {
    pick: { address: first.address, reason: buildReason(first), score: first.score },
    alternates: rest.slice(0, 2).map((v) => ({
      address: v.address,
      reason: `Alternate: ${buildReason(v)}`,
      score: v.score,
    })),
  };
}

export function rejectedVaults(vaults: ScreenedVault[]): RejectedVault[] {
  return vaults
    .filter((v) => !v.screened)
    .map((v) => ({
      address: v.address,
      reasons: v.screening.filter((s) => !s.ok).map((s) => s.code),
    }));
}
