import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CuratorConfig,
  type DiscoveredVault,
  decideRun,
  parseCuratorConfig,
  screenVaults,
  selectRecommendation,
} from "./curator-core.ts";

const NOW = new Date("2026-09-18T12:00:00Z");

function config(over: Partial<CuratorConfig> = {}): CuratorConfig {
  return {
    chainId: 4663,
    apiBaseUrl: "http://agent:31102",
    s2sToken: "s2s",
    reportOwner: "0xA71e24359A6cb7A939aae2d62dD12b6256365c30",
    morphoUrl: "https://api.morpho.org/graphql",
    kumaPushUrl: null,
    intervalSec: 86_400,
    pollSec: 300,
    fetchTimeoutSec: 30,
    maxVaults: 100,
    minTvlUsd: 10_000,
    minLiquidityUsd: 1_000,
    minAgeDays: 1,
    maxNetApyBps: 10_000,
    requireListed: true,
    requireVerifiedCurator: false,
    assetAllowlist: ["USDC"],
    rpcUrl: null,
    archiveRpcUrl: null,
    vaultV2Factory: null,
    apyLookbackDays: 7,
    stableAssets: ["USDC", "USDG", "USDT", "DAI"],
    ...over,
  };
}

function vault(over: Partial<DiscoveredVault> = {}): DiscoveredVault {
  return {
    address: "0x1111111111111111111111111111111111111111",
    label: "Alpha USDC",
    assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    assetSymbol: "USDC",
    assetDecimals: 6,
    curator: "Gauntlet",
    curatorVerified: true,
    listed: true,
    netApyBps: 500,
    tvlUsd: 1_000_000,
    liquidityUsd: 500_000,
    ageSeconds: 30 * 86_400,
    warnings: [],
    ...over,
  };
}

// ── config ───────────────────────────────────────────────────────────────────────────────────────

test("config defaults to chain 4663, USDC-only, daily cadence", () => {
  const parsed = parseCuratorConfig({
    CURATOR_API_BASE_URL: "http://agent:31102",
    AGENT_S2S_TOKEN: "s2s",
    CURATOR_REPORT_OWNER: "0xabc",
  } as NodeJS.ProcessEnv);
  assert.equal(parsed.chainId, 4663);
  assert.deepEqual(parsed.assetAllowlist, ["USDC"]);
  assert.equal(parsed.intervalSec, 86_400);
  assert.equal(parsed.requireListed, true);
});

test("config refuses to start without an agent identity instead of running blind", () => {
  assert.throws(() => parseCuratorConfig({} as NodeJS.ProcessEnv), /required/);
});

test("config refuses a typo'd threshold rather than silently defaulting", () => {
  assert.throws(
    () =>
      parseCuratorConfig({
        CURATOR_API_BASE_URL: "http://agent:31102",
        AGENT_S2S_TOKEN: "s2s",
        CURATOR_REPORT_OWNER: "0xabc",
        CURATOR_MIN_TVL_USD: "ten-thousand",
      } as NodeJS.ProcessEnv),
    /CURATOR_MIN_TVL_USD/,
  );
});

// ── cadence ──────────────────────────────────────────────────────────────────────────────────────

test("a chain that has never run is due", () => {
  const decision = decideRun({ now: NOW, lastRunAt: null, runRequestedAt: null, intervalSec: 86_400 });
  assert.equal(decision.due, true);
  assert.match(decision.reason, /never run/);
});

test("an admin Run-now request wins over a recent run", () => {
  const decision = decideRun({
    now: NOW,
    lastRunAt: "2026-09-18T11:59:00Z",
    runRequestedAt: "2026-09-18T11:59:30Z",
    intervalSec: 86_400,
  });
  assert.equal(decision.due, true);
  assert.match(decision.reason, /requested/);
});

test("a run inside the interval is not due; past it is", () => {
  const recent = decideRun({
    now: NOW,
    lastRunAt: "2026-09-18T11:00:00Z",
    runRequestedAt: null,
    intervalSec: 86_400,
  });
  assert.equal(recent.due, false);
  const stale = decideRun({
    now: NOW,
    lastRunAt: "2026-09-17T11:00:00Z",
    runRequestedAt: null,
    intervalSec: 86_400,
  });
  assert.equal(stale.due, true);
});

// ── screening ────────────────────────────────────────────────────────────────────────────────────

test("a healthy USDC vault passes every screen", () => {
  const [screened] = screenVaults([vault()], config(), NOW);
  assert.ok(screened);
  assert.equal(screened.screened, true);
  assert.ok(screened.score > 0);
  assert.equal(screened.screening.every((v) => v.ok), true);
});

test("asset allowlist rejects a non-USDC vault", () => {
  const [screened] = screenVaults([vault({ assetSymbol: "WETH" })], config(), NOW);
  assert.ok(screened);
  assert.equal(screened.screened, false);
  assert.ok(screened.screening.some((v) => v.code === "asset" && !v.ok));
});

test("the anomaly guard rejects an absurd APY and a negative one", () => {
  const absurd = screenVaults([vault({ netApyBps: 30_000 })], config(), NOW)[0];
  assert.equal(absurd?.screened, false);
  assert.ok(absurd?.screening.some((v) => v.code === "anomaly-apy" && !v.ok));

  const negative = screenVaults([vault({ netApyBps: -50 })], config(), NOW)[0];
  assert.equal(negative?.screened, false);
});

test("unknown figures FAIL screening — null is not zero", () => {
  for (const missing of [
    { netApyBps: null },
    { tvlUsd: null },
    { liquidityUsd: null },
    { ageSeconds: null },
  ]) {
    const [screened] = screenVaults([vault(missing)], config(), NOW);
    assert.equal(screened?.screened, false, `expected ${Object.keys(missing)[0]} to fail`);
  }
});

test("thresholds are enforced: TVL, liquidity, age, listed", () => {
  assert.equal(screenVaults([vault({ tvlUsd: 9_999 })], config(), NOW)[0]?.screened, false);
  assert.equal(screenVaults([vault({ liquidityUsd: 999 })], config(), NOW)[0]?.screened, false);
  assert.equal(
    screenVaults([vault({ ageSeconds: 86_400 - 1 })], config(), NOW)[0]?.screened,
    false,
  );
  assert.equal(screenVaults([vault({ listed: false })], config(), NOW)[0]?.screened, false);
});

test("curator verification is optional by default and required when configured", () => {
  const unverified = vault({ curator: "anon", curatorVerified: false });
  assert.equal(screenVaults([unverified], config(), NOW)[0]?.screened, true);
  assert.equal(
    screenVaults([unverified], config({ requireVerifiedCurator: true }), NOW)[0]?.screened,
    false,
  );
});

test("a source danger warning rejects the vault", () => {
  const [screened] = screenVaults([vault({ warnings: ["badDebt:RED"] })], config(), NOW);
  assert.equal(screened?.screened, false);
});

// ── scoring + best pick ──────────────────────────────────────────────────────────────────────────

test("scoring rewards APY, depth and a verified curator", () => {
  const base = screenVaults([vault()], config(), NOW)[0];
  const richer = screenVaults(
    [vault({ netApyBps: 1_200, tvlUsd: 9_000_000, liquidityUsd: 8_000_000 })],
    config(),
    NOW,
  )[0];
  assert.ok(base && richer);
  assert.ok(richer.score > base.score);
});

test("best-pick selection is deterministic and total-ordered", () => {
  const a = vault({ address: "0xaaa0000000000000000000000000000000000001", netApyBps: 600 });
  const b = vault({ address: "0xbbb0000000000000000000000000000000000002", netApyBps: 600 });
  const c = vault({ address: "0xccc0000000000000000000000000000000000003", netApyBps: 100 });
  // Same APY, same TVL: the address tie-break decides, and it decides the same way every time.
  const first = selectRecommendation(screenVaults([b, a, c], config(), NOW));
  const second = selectRecommendation(screenVaults([c, a, b], config(), NOW));
  assert.deepEqual(first, second);
  assert.equal(first.pick?.address, a.address.toLowerCase());
  assert.equal(first.alternates.length, 2);
  assert.equal(first.alternates[0]?.address, b.address.toLowerCase());
});

test("only screened vaults can be picked, and none passing means no pick", () => {
  const good = vault({ address: "0xaaa0000000000000000000000000000000000001" });
  const bad = vault({ address: "0xbbb0000000000000000000000000000000000002", tvlUsd: 1 });
  const rec = selectRecommendation(screenVaults([good, bad], config(), NOW));
  assert.equal(rec.pick?.address, good.address.toLowerCase());
  assert.equal(rec.alternates.length, 0);

  const none = selectRecommendation(screenVaults([bad], config(), NOW));
  assert.equal(none.pick, null);
  assert.deepEqual(none.alternates, []);
});
