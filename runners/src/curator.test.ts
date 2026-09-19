import assert from "node:assert/strict";
import { test } from "node:test";

import { discover, runOnce } from "./curator.ts";
import type { PublicClient } from "viem";

import type { CuratorConfig } from "./shared/curator-core.ts";

const NOW = new Date("2026-09-18T12:00:00Z");

function config(over: Partial<CuratorConfig> = {}): CuratorConfig {
  return {
    chainId: 4663,
    apiBaseUrl: "http://agent:31102",
    s2sToken: "s2s-token",
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
    onchainRequired: true,
    apyLookbackDays: 7,
    stableAssets: ["USDC", "USDG", "USDT", "DAI"],
    ...over,
  };
}

function vaultItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: "0x1111111111111111111111111111111111111111",
    name: "Alpha USDC",
    symbol: "AlphaUSDC",
    listed: true,
    creationTimestamp: Math.floor(NOW.getTime() / 1000) - 30 * 86_400,
    asset: {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      decimals: 6,
    },
    liquidity: { underlying: "500000000000", usd: 500_000 },
    state: {
      totalAssetsUsd: 1_000_000,
      netApy: 0.05,
      curator: "0x2222222222222222222222222222222222222222",
      curators: [{ name: "Gauntlet", verified: true }],
    },
    warnings: [],
    ...over,
  };
}

type Captured = { url: string; init: RequestInit | undefined };

/** A fetch double that answers the morpho URL with `morpho` and records agent calls. */
function installFetch(morpho: () => Promise<Response>): { calls: Captured[] } {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("morpho")) return morpho();
    return new Response(JSON.stringify({ ok: true, stored: 1, published: true, approved: 1 }), {
      status: 200,
    });
  }) as typeof fetch;
  // The test runner is sequential per file; restore on process exit as a safety net.
  process.on("exit", () => {
    globalThis.fetch = original;
  });
  return { calls };
}

function ingestBody(calls: Captured[]): Record<string, unknown> {
  const call = calls.find((c) => c.url.endsWith("/curator/ingest"));
  assert.ok(call, "expected an ingest call");
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

test("a successful run publishes the pick and the screened vaults", async () => {
  const { calls } = installFetch(async () =>
    new Response(JSON.stringify({ data: { vaults: { items: [vaultItem()] } } }), { status: 200 }),
  );

  await runOnce(config(), NOW);

  const body = ingestBody(calls);
  assert.equal(body.ok, true);
  assert.equal((body.vaults as unknown[]).length, 1);
  assert.equal((body.pick as { address: string }).address, "0x1111111111111111111111111111111111111111");
  assert.match((body.pick as { reason: string }).reason, /Highest screen score/);
  assert.deepEqual(body.rejected, []);
  assert.equal(body.runKey, "curator-4663-2026-09-18T12:00:00.000Z");

  const ingest = calls.find((c) => c.url.endsWith("/curator/ingest"));
  const headers = ingest?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer s2s-token");
  assert.equal(headers["x-chain-id"], "4663");
  assert.equal(headers["x-owner"], config().reportOwner);
});

test("a Morpho failure reports ok=false and publishes nothing", async () => {
  const { calls } = installFetch(async () => {
    throw new Error("morpho unreachable");
  });

  await runOnce(config(), NOW);

  const body = ingestBody(calls);
  assert.equal(body.ok, false);
  assert.match(String(body.error), /morpho unreachable/);
  assert.deepEqual(body.vaults, []);
  assert.equal(body.pick, null);
});

test("a failed run pushes DOWN to the Kuma monitor; a healthy one pushes UP", async () => {
  const failing = installFetch(async () => {
    throw new Error("morpho down");
  });
  await runOnce(config({ kumaPushUrl: "http://kuma/api/push/token" }), NOW);
  const down = failing.calls.find((c) => c.url.includes("/api/push/"));
  assert.ok(down, "expected a push heartbeat");
  assert.match(down.url, /status=down/);
  assert.match(decodeURIComponent(down.url), /morpho down/);

  const healthy = installFetch(
    async () =>
      new Response(JSON.stringify({ data: { vaults: { items: [vaultItem()] } } }), { status: 200 }),
  );
  await runOnce(config({ kumaPushUrl: "http://kuma/api/push/token" }), NOW);
  const up = healthy.calls.find((c) => c.url.includes("/api/push/"));
  assert.ok(up);
  assert.match(up.url, /status=up/);
});

test("no Kuma URL means no heartbeat traffic at all", async () => {
  const { calls } = installFetch(async () =>
    new Response(JSON.stringify({ data: { vaults: { items: [] } } }), { status: 200 }),
  );
  await runOnce(config(), NOW);
  assert.equal(calls.some((c) => c.url.includes("/api/push/")), false);
});

test("an empty chain produces an honest empty run, not a failure", async () => {
  const { calls } = installFetch(async () =>
    new Response(JSON.stringify({ data: { vaults: { items: [] } } }), { status: 200 }),
  );

  await runOnce(config(), NOW);

  const body = ingestBody(calls);
  assert.equal(body.ok, true);
  assert.deepEqual(body.vaults, []);
  assert.equal(body.pick, null);
});

test("screened-out vaults are reported as rejected, never as candidates", async () => {
  const { calls } = installFetch(async () =>
    new Response(
      JSON.stringify({
        data: {
          vaults: {
            items: [
              // Right asset, too small to screen in.
              vaultItem({ address: "0x3333333333333333333333333333333333333333", state: { totalAssetsUsd: 10, netApy: 0.05, curator: "x", curators: [] } }),
              // Wrong asset entirely.
              vaultItem({
                address: "0x4444444444444444444444444444444444444444",
                asset: { address: "0xweth", symbol: "WETH", decimals: 18 },
              }),
            ],
          },
        },
      }),
      { status: 200 },
    ),
  );

  await runOnce(config(), NOW);

  const body = ingestBody(calls);
  assert.equal(body.ok, true);
  assert.deepEqual(body.vaults, []);
  assert.equal(body.pick, null);
  const rejected = body.rejected as { address: string; reasons: string[] }[];
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((r) => r.reasons.length > 0));
});

test("a required crawl failure fails the run instead of publishing unverified candidates", async () => {
  installFetch(async () =>
    new Response(JSON.stringify({ data: { vaults: { items: [vaultItem()] } } }), { status: 200 }),
  );
  const deadClient = {
    getBlockNumber: async () => 1n,
    getBlock: async () => ({ timestamp: 0n }),
    getLogs: async () => {
      throw new Error("rpc down");
    },
    readContract: async () => 0n,
  } as unknown as PublicClient;

  const cfg = config({
    rpcUrl: "https://rpc.example",
    vaultV2Factory: "0x0FBad98595b0186dA120E41f77C102beb49f803c",
    onchainRequired: true,
  });
  await assert.rejects(() => discover(cfg, NOW, deadClient), /on-chain crawl failed/);
});

test("an optional crawl failure degrades to API-only and says so", async () => {
  installFetch(async () =>
    new Response(JSON.stringify({ data: { vaults: { items: [vaultItem()] } } }), { status: 200 }),
  );
  const deadClient = {
    getBlockNumber: async () => 1n,
    getBlock: async () => ({ timestamp: 0n }),
    getLogs: async () => {
      throw new Error("rpc down");
    },
    readContract: async () => 0n,
  } as unknown as PublicClient;

  const cfg = config({
    rpcUrl: "https://rpc.example",
    vaultV2Factory: "0x0FBad98595b0186dA120E41f77C102beb49f803c",
    onchainRequired: false,
  });
  const result = await discover(cfg, NOW, deadClient);
  assert.equal(result.source, "morpho-api");
  assert.equal(result.vaults.length, 1);
  assert.match(result.notes.join(" "), /on-chain crawl failed/);
});
