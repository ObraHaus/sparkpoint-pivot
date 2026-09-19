import assert from "node:assert/strict";
import { test } from "node:test";

import type { CuratorConfig } from "./curator-core.ts";
import {
  fetchMorphoVaults,
  graphqlErrors,
  parseMorphoResponse,
  parseMorphoVault,
} from "./morpho.ts";

const NOW = new Date("2026-09-18T12:00:00Z");

/** A real-shape response captured from the live API (Base 8453), trimmed to the queried fields. */
const FIXTURE = {
  data: {
    vaults: {
      items: [
        {
          address: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
          name: "Gauntlet USDC Prime",
          symbol: "gtUSDCp",
          listed: true,
          creationTimestamp: 1717444929,
          asset: {
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            symbol: "USDC",
            decimals: 6,
          },
          liquidity: { underlying: "167618675939889", usd: 167540550.17206636 },
          state: {
            totalAssetsUsd: 420747952.3775426,
            netApy: 0.04407924978742812,
            curator: "0x9E33faAE38ff641094fa68c65c2cE600b3410585",
            curators: [
              { name: "Gauntlet", verified: true },
              { name: "Other", verified: false },
            ],
          },
          warnings: [],
        },
        {
          address: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
          name: "Spark USDC Vault",
          symbol: "sparkUSDC",
          listed: true,
          creationTimestamp: 1735575215,
          asset: {
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            symbol: "USDC",
            decimals: 6,
          },
          liquidity: { underlying: "156427391543608", usd: 156354481.94684434 },
          state: {
            totalAssetsUsd: 279485784.3923468,
            netApy: 0.039523712749156274,
            curator: "0x0f963A8A8c01042B69054e787E5763ABbB0646A3",
            curators: [{ name: "SparkDAO", verified: true }],
          },
          warnings: [{ type: "badDebt", level: "YELLOW" }],
        },
      ],
    },
  },
};

function config(over: Partial<CuratorConfig> = {}): CuratorConfig {
  return {
    chainId: 4663,
    apiBaseUrl: "http://agent:31102",
    s2sToken: "s2s",
    reportOwner: "0xabc",
    morphoUrl: "https://blue-api.morpho.org/graphql",
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
    ...over,
  };
}

test("the real API shape parses, with the fraction netApy converted to bps", () => {
  const vaults = parseMorphoResponse(FIXTURE, NOW);
  assert.equal(vaults.length, 2);
  const gauntlet = vaults[0];
  assert.ok(gauntlet);
  assert.equal(gauntlet.address, "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61");
  assert.equal(gauntlet.label, "Gauntlet USDC Prime");
  assert.equal(gauntlet.assetSymbol, "USDC");
  assert.equal(gauntlet.assetDecimals, 6);
  assert.equal(gauntlet.curator, "Gauntlet");
  assert.equal(gauntlet.curatorVerified, true);
  assert.equal(gauntlet.netApyBps, 441);
  assert.equal(gauntlet.tvlUsd, 420747952.3775426);
  assert.equal(gauntlet.liquidityUsd, 167540550.17206636);
  assert.equal(gauntlet.ageSeconds, NOW.getTime() / 1000 - 1717444929);
  assert.equal(gauntlet.warnings.length, 0);
});

test("curator falls back to the raw address and warnings are preserved", () => {
  const vaults = parseMorphoResponse(FIXTURE, NOW);
  const spark = vaults[1];
  assert.ok(spark);
  assert.equal(spark.curator, "SparkDAO");
  assert.deepEqual(spark.warnings, ["badDebt:YELLOW"]);
});

test("chain 4663's real empty response is an empty list, not an error", () => {
  assert.deepEqual(parseMorphoResponse({ data: { vaults: { items: [] } } }, NOW), []);
  assert.deepEqual(parseMorphoResponse({ data: { vaults: null } }, NOW), []);
});

test("malformed entries are dropped, never guessed at", () => {
  assert.equal(parseMorphoVault(null, NOW), null);
  assert.equal(parseMorphoVault({ name: "no address" }, NOW), null);
  assert.equal(parseMorphoVault({ address: "0x123" }, NOW), null);
  const partial = parseMorphoVault({ address: "0x1111111111111111111111111111111111111111" }, NOW);
  assert.ok(partial);
  assert.equal(partial.label, "0x1111111111111111111111111111111111111111");
  assert.equal(partial.netApyBps, null);
  assert.equal(partial.tvlUsd, null);
  assert.equal(partial.ageSeconds, null);
});

test("graphql errors are surfaced rather than parsed as empty", () => {
  assert.deepEqual(graphqlErrors({ errors: [{ message: "boom" }] }), ["boom"]);
  assert.deepEqual(graphqlErrors(FIXTURE), []);
});

test("fetchMorphoVaults posts the chain-scoped query and parses the response", async () => {
  let seenUrl = "";
  let seenBody: { query?: string; variables?: { chainId?: number; first?: number } } = {};
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init?.body)) as typeof seenBody;
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  }) as typeof fetch;

  const vaults = await fetchMorphoVaults(config(), NOW, fakeFetch);
  assert.equal(seenUrl, "https://blue-api.morpho.org/graphql");
  assert.equal(seenBody.variables?.chainId, 4663);
  assert.equal(seenBody.variables?.first, 100);
  assert.match(seenBody.query ?? "", /chainId_in: \[\$chainId\]/);
  assert.equal(vaults.length, 2);
});

test("fetchMorphoVaults throws on HTTP failure and on GraphQL errors", async () => {
  const http500 = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(() => fetchMorphoVaults(config(), NOW, http500), /HTTP 500/);

  const gqlError = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "Field xyz" }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => fetchMorphoVaults(config(), NOW, gqlError), /GraphQL error/);

  const network = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  await assert.rejects(() => fetchMorphoVaults(config(), NOW, network), /ECONNREFUSED/);
});
