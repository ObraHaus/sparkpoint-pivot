import assert from "node:assert/strict";
import { test } from "node:test";

import type { Address, Hex } from "viem";

import { runOnce, type DeployerDeps, type JobOutcome } from "./deployer.ts";
import type { DeployerConfig, WrapperJob } from "./shared/wrapper.ts";

const CONFIG: DeployerConfig = {
  chainId: 4663,
  rpcUrl: "https://rpc.example",
  factoryAddress: "0x1111111111111111111111111111111111111111",
  apiBaseUrl: "http://agent:31102",
  s2sToken: "s2s",
  reportOwner: "0x2222222222222222222222222222222222222222",
  pollSec: 120,
  maxFeeBps: 2000,
  fetchTimeoutSec: 30,
};

const PROXY = "0x4444444444444444444444444444444444444444" as Address;
const CAP = "0x5555555555555555555555555555555555555555" as Address;

function job(over: Partial<WrapperJob> = {}): WrapperJob {
  return {
    id: "01234567-89ab-4cde-8fab-0123456789ab",
    chainId: 4663,
    childAddress: "0x3333333333333333333333333333333333333333",
    feeBps: 1000,
    perUserCap: "1000000000",
    totalCap: "100000000000",
    vaultCap: "100000000000",
    name: "SparkPoint Universal USDC",
    symbol: "spuUSDC",
    label: "Curated wrapper",
    ...over,
  };
}

function harness(jobs: WrapperJob[], over: Partial<DeployerDeps> = {}) {
  const outcomes: JobOutcome[] = [];
  const calls = { createVault: 0, isAllowlisted: 0, readCapRegistry: 0 };
  const deps: DeployerDeps = {
    fetchJobs: async () => jobs,
    report: async (outcome) => {
      outcomes.push(outcome);
    },
    isAllowlisted: async () => {
      calls.isAllowlisted += 1;
      return true;
    },
    predict: async () => PROXY,
    getCode: async () => "0x",
    createVault: async () => {
      calls.createVault += 1;
      return { txHash: `0x${"ab".repeat(32)}` as Hex, proxy: PROXY, capRegistry: CAP };
    },
    readCapRegistry: async () => {
      calls.readCapRegistry += 1;
      return CAP;
    },
    ...over,
  };
  return { deps, outcomes, calls };
}

test("a happy path deploys once and reports the tx + addresses", async () => {
  const { deps, outcomes, calls } = harness([job()]);
  const deployed = await runOnce(CONFIG, deps);
  assert.equal(deployed, 1);
  assert.equal(calls.createVault, 1);
  assert.deepEqual(outcomes, [
    {
      id: job().id,
      ok: true,
      txHash: `0x${"ab".repeat(32)}`,
      proxyAddress: PROXY,
      capRegistry: CAP,
    },
  ]);
});

test("a child that is not on the on-chain allowlist is reported WITHOUT spending gas", async () => {
  const { deps, outcomes, calls } = harness([job()], { isAllowlisted: async () => false });
  const deployed = await runOnce(CONFIG, deps);
  assert.equal(deployed, 0);
  assert.equal(calls.createVault, 0);
  assert.equal(outcomes[0]?.ok, false);
  assert.match(outcomes[0]?.error ?? "", /allowlist/);
});

test("a malformed job is rejected locally and never reaches the chain", async () => {
  const { deps, outcomes, calls } = harness([job({ feeBps: 9999 })]);
  await runOnce(CONFIG, deps);
  assert.equal(calls.isAllowlisted, 0);
  assert.equal(calls.createVault, 0);
  assert.equal(outcomes[0]?.ok, false);
  assert.match(outcomes[0]?.error ?? "", /rejected/);
});

test("a lost report is recovered: existing code at the predicted address means no second tx", async () => {
  const { deps, outcomes, calls } = harness([job()], { getCode: async () => "0x6080" as Hex });
  const deployed = await runOnce(CONFIG, deps);
  assert.equal(deployed, 1);
  assert.equal(calls.createVault, 0);
  assert.equal(calls.readCapRegistry, 1);
  assert.equal(outcomes[0]?.ok, true);
  assert.equal(outcomes[0]?.proxyAddress, PROXY);
  assert.equal(outcomes[0]?.capRegistry, CAP);
});

test("a reverted createVault is reported as a failure with the reason", async () => {
  const { deps, outcomes } = harness([job()], {
    createVault: async () => {
      throw new Error("execution reverted: NotAllowlisted");
    },
  });
  await runOnce(CONFIG, deps);
  assert.equal(outcomes[0]?.ok, false);
  assert.match(outcomes[0]?.error ?? "", /NotAllowlisted/);
});

test("one bad job does not stop the next one", async () => {
  const first = job();
  const second = job({ id: "11234567-89ab-4cde-8fab-0123456789ab" });
  let n = 0;
  const { deps, outcomes } = harness([first, second], {
    createVault: async () => {
      n += 1;
      if (n === 1) throw new Error("first fails");
      return { txHash: `0x${"cd".repeat(32)}` as Hex, proxy: PROXY, capRegistry: CAP };
    },
  });
  const deployed = await runOnce(CONFIG, deps);
  assert.equal(deployed, 1);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.ok, false);
  assert.equal(outcomes[1]?.ok, true);
});

test("an empty queue is a quiet no-op", async () => {
  const { deps, outcomes } = harness([]);
  assert.equal(await runOnce(CONFIG, deps), 0);
  assert.deepEqual(outcomes, []);
});

test("a queue-fetch failure propagates (the tick is degraded, so the heartbeat must not advance)", async () => {
  const { deps } = harness([], {
    fetchJobs: async () => {
      throw new Error("agent down");
    },
  });
  await assert.rejects(() => runOnce(CONFIG, deps), /agent down/);
});
