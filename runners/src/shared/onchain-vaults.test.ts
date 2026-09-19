import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicClient } from "viem";

import type { CuratorConfig, DiscoveredVault } from "./curator-core.ts";
import {
  enumerateVaultV2Creations,
  mergeOnchainDiscovery,
  onchainApyBps,
  readVaultV2Facts,
  type VaultV2Creation,
  type VaultV2Facts,
} from "./onchain-vaults.ts";

const VAULT = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x0FBad98595b0186dA120E41f77C102beb49f803c";
const ASSET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

function creation(over: Partial<VaultV2Creation> = {}): VaultV2Creation {
  return {
    address: VAULT,
    owner: "0x2222222222222222222222222222222222222222",
    asset: ASSET,
    salt: `0x${"ab".repeat(32)}`,
    blockNumber: 100n,
    createdAt: 1_700_000_000,
    ...over,
  };
}

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
    assetAllowlist: ["USDG"],
    rpcUrl: "https://rpc.example",
    archiveRpcUrl: null,
    vaultV2Factory: FACTORY,
    apyLookbackDays: 7,
    stableAssets: ["USDC", "USDG", "USDT", "DAI"],
    ...over,
  };
}

function apiVault(over: Partial<DiscoveredVault> = {}): DiscoveredVault {
  return {
    address: VAULT,
    label: "Steakhouse USDG",
    assetAddress: ASSET,
    assetSymbol: "USDG",
    assetDecimals: 6,
    curator: "0x9023fbd6a08c666491a2d1648737e400cf42d2fb",
    curatorVerified: false,
    listed: true,
    netApyBps: 359,
    tvlUsd: 482_374_848,
    liquidityUsd: 42_265_800,
    ageSeconds: 86_400,
    warnings: [],
    ...over,
  };
}

function facts(over: Partial<VaultV2Facts> = {}): VaultV2Facts {
  return {
    address: VAULT,
    createdAt: 1_700_000_000,
    isVaultV2: true,
    assetAddress: ASSET,
    assetSymbol: "USDG",
    assetDecimals: 6,
    vaultName: "Steakhouse USDG",
    vaultSymbol: "steakUSDG",
    totalAssets: 482_476_127_695_139n,
    totalSupply: 478_929_282_197_474_091_491n,
    performanceFee: 0n,
    managementFee: 0n,
    curator: "0x9023fbd6a08c666491a2d1648737e400cf42d2fb",
    owner: "0xca50d23f1c18c1dfaff5d3cae3aa4b9dc5c8db73",
    gatesAbdicated: true,
    warnings: [],
    ...over,
  };
}

// ── enumeration ──────────────────────────────────────────────────────────────────────────────────

function logFor(address: string, blockNumber: bigint) {
  return {
    args: {
      owner: "0x2222222222222222222222222222222222222222",
      asset: ASSET,
      salt: `0x${"cd".repeat(32)}`,
      newVaultV2: address,
    },
    blockNumber,
  };
}

test("enumerateVaultV2Creations decodes, dedupes, stamps timestamps and sorts", async () => {
  const client = {
    getBlockNumber: async () => 500n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: 1_700_000_000n + blockNumber,
    }),
    getLogs: async () => [
      logFor(VAULT, 300n),
      logFor("0x3333333333333333333333333333333333333333", 100n),
      logFor(VAULT, 300n), // duplicate
      { args: {}, blockNumber: 400n }, // malformed — dropped
    ],
  } as unknown as PublicClient;

  const creations = await enumerateVaultV2Creations(client, FACTORY);
  assert.equal(creations.length, 2);
  assert.equal(creations[0]!.address, "0x3333333333333333333333333333333333333333");
  assert.equal(creations[1]!.address, VAULT);
  assert.equal(creations[0]!.createdAt, 1_700_000_100);
  assert.equal(creations[0]!.blockNumber, 100n);
});

test("enumerateVaultV2Creations splits the range when a provider caps getLogs", async () => {
  let calls = 0;
  const client = {
    getBlockNumber: async () => 3_000n,
    getBlock: async () => ({ timestamp: 1_700_000_000n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls += 1;
      if (toBlock - fromBlock > 1_000n) throw new Error("range too large");
      return fromBlock <= 100n && 100n <= toBlock ? [logFor(VAULT, 100n)] : [];
    },
  } as unknown as PublicClient;

  const creations = await enumerateVaultV2Creations(client, FACTORY, { minChunk: 500n });
  assert.equal(creations.length, 1);
  assert.ok(calls > 1, "expected the range to be re-requested in chunks");
});

// ── facts ────────────────────────────────────────────────────────────────────────────────────────

test("readVaultV2Facts reads the chain and passes FR-020 when gates are abdicated", async () => {
  const client = {
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (address.toLowerCase() === ASSET.toLowerCase()) {
        if (functionName === "symbol") return "USDG";
        if (functionName === "decimals") return 6;
        throw new Error(`unexpected asset read: ${functionName}`);
      }
      switch (functionName) {
        case "isVaultV2":
          return true;
        case "asset":
          return ASSET;
        case "name":
          return "Steakhouse USDG";
        case "symbol":
          return "steakUSDG";
        case "totalAssets":
          return 482_476_127_695_139n;
        case "totalSupply":
          return 478_929_282_197_474_091_491n;
        case "curator":
          return "0x9023FBD6A08C666491A2d1648737E400cF42D2Fb";
        case "owner":
          return "0xCa50D23F1c18C1Dfaff5d3cae3aa4B9dC5C8db73";
        case "performanceFee":
        case "managementFee":
          return 0n;
        case "abdicated":
          return true;
        default:
          throw new Error(`unexpected read: ${functionName}`);
      }
    },
  } as unknown as PublicClient;

  const result = await readVaultV2Facts(client, FACTORY, creation());
  assert.equal(result.isVaultV2, true);
  assert.equal(result.gatesAbdicated, true);
  assert.equal(result.assetSymbol, "USDG");
  assert.equal(result.assetDecimals, 6);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.totalAssets, 482_476_127_695_139n);
});

test("readVaultV2Facts raises DANGER when a gate setter is not abdicated", async () => {
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "abdicated") return args?.[0] !== "0xc21ad028";
      if (functionName === "isVaultV2") return true;
      if (functionName === "asset") return ASSET;
      if (functionName === "name" || functionName === "symbol") return "x";
      if (functionName === "decimals") return 6;
      if (functionName === "totalAssets" || functionName === "totalSupply") return 1n;
      if (functionName === "curator" || functionName === "owner") return VAULT;
      return 0n;
    },
  } as unknown as PublicClient;

  const result = await readVaultV2Facts(client, FACTORY, creation());
  assert.equal(result.gatesAbdicated, false);
  assert.match(result.warnings.join(" "), /DANGER: gate setter\(s\) not abdicated \(setSendSharesGate\)/);
});

// ── on-chain APY ─────────────────────────────────────────────────────────────────────────────────

test("onchainApyBps annualizes share-price growth over the lookback", async () => {
  const oldPrice = 10n ** 18n; // 1.000000
  const headPrice = (10n ** 18n * 105n) / 100n; // 1.050000
  const client = {
    getBlockNumber: async () => 1_000n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      // Block 0 is "365 days ago"; block 1000 is now.
      timestamp: BigInt(1_000_000 - Number(blockNumber)),
    }),
    readContract: async ({ blockNumber }: { blockNumber?: bigint }) =>
      blockNumber === undefined ? headPrice : oldPrice,
  } as unknown as PublicClient;

  // now = 1_000_000 → 365 days earlier = timestamp 1_000_000 - 31_536_000 < 0 blocks... use 1 day.
  const bps = await onchainApyBps(client, VAULT, 365, new Date(1_000_000 * 1000));
  assert.equal(bps, 500); // ratio 1.05 over 365d → +5.00%
});

test("onchainApyBps returns null when the old state is not readable", async () => {
  const client = {
    getBlockNumber: async () => 1_000n,
    getBlock: async () => ({ timestamp: 1_000_000n }),
    readContract: async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber !== undefined) throw new Error("historical state is not available");
      return 10n ** 18n;
    },
  } as unknown as PublicClient;

  const bps = await onchainApyBps(client, VAULT, 7, new Date(1_000_000 * 1000 + 86_400_000));
  assert.equal(bps, null);
});

// ── merge ────────────────────────────────────────────────────────────────────────────────────────

test("mergeOnchainDiscovery prefers API figures and appends on-chain verdicts", () => {
  const merged = mergeOnchainDiscovery(
    [apiVault()],
    [creation()],
    new Map([[VAULT, facts()]]),
    new Map(),
    config(),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.tvlUsd, 482_374_848);
  assert.equal(merged[0]!.netApyBps, 359);
  assert.equal(merged[0]!.listed, true);
  assert.equal(merged[0]!.warnings.length, 0);
});

test("mergeOnchainDiscovery flags an API vault missing from the factory logs as DANGER", () => {
  const missing = "0x4444444444444444444444444444444444444444";
  const merged = mergeOnchainDiscovery(
    [apiVault({ address: missing })],
    [creation()],
    new Map([[VAULT, facts()]]),
    new Map(),
    config(),
  );
  const flagged = merged.find((v) => v.address === missing);
  assert.ok(flagged);
  assert.match(flagged!.warnings.join(" "), /DANGER: the VaultV2Factory creation logs do not include/);
});

test("mergeOnchainDiscovery builds an honest on-chain-only candidate from stable TVL", () => {
  const only = creation();
  const merged = mergeOnchainDiscovery(
    [],
    [only],
    new Map([[VAULT, facts()]]),
    new Map([[VAULT, 271]]),
    config(),
  );
  assert.equal(merged.length, 1);
  const vault = merged[0]!;
  assert.equal(vault.address, VAULT);
  assert.equal(vault.listed, false);
  assert.equal(vault.liquidityUsd, null);
  assert.equal(vault.netApyBps, 271);
  assert.equal(Math.round(vault.tvlUsd ?? 0), 482_476_128); // 482,476.127695 USDG ≈ 1:1
  assert.match(vault.warnings.join(" "), /on-chain-only/);
});
