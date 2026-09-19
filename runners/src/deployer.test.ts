import assert from "node:assert/strict";
import { test } from "node:test";

import type { Address, Hex } from "viem";

import { runOnce, type AdmissionOutcome, type DeployerDeps } from "./deployer.ts";
import {
  ZERO_ADDRESS,
  type AdmissionState,
  type DeployerConfig,
  type WrapperCandidate,
} from "./shared/wrapper.ts";

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

const CHILD = "0x3333333333333333333333333333333333333333" as Address;
const CHILD_2 = "0x3433333333333333333333333333333333333333" as Address;
const PROXY = "0x4444444444444444444444444444444444444444" as Address;
const CAP = "0x5555555555555555555555555555555555555555" as Address;
const RUNNER = "0x7777777777777777777777777777777777777777" as Address;
const ADMIN = "0x8888888888888888888888888888888888888888" as Address;

const TX_WHITELIST = `0x${"ab".repeat(32)}` as Hex;
const TX_DEPLOY = `0x${"cd".repeat(32)}` as Hex;
const READY_AT = 1_700_000_000;

function candidate(over: Partial<WrapperCandidate> = {}): WrapperCandidate {
  return {
    childAddress: CHILD,
    feeBps: 1000,
    perUserCap: "1000000000",
    totalCap: "100000000000",
    vaultCap: "100000000000",
    name: "SparkPoint Wrapped Steakhouse USDG",
    symbol: "spwSTEAKUSDG",
    label: "Steakhouse USDG",
    ...over,
  };
}

function state(over: Partial<AdmissionState> = {}): AdmissionState {
  return { wrapper: ZERO_ADDRESS, whitelistedBy: ZERO_ADDRESS, ready: false, ...over };
}

function harness(candidates: WrapperCandidate[], over: Partial<DeployerDeps> = {}) {
  const outcomes: AdmissionOutcome[] = [];
  const calls = { whitelistVault: 0, createVault: 0, readCapRegistry: 0, getAdmissionState: 0 };
  const deps: DeployerDeps = {
    runnerAddress: RUNNER,
    fetchCandidates: async () => candidates,
    report: async (outcome) => {
      outcomes.push(outcome);
    },
    getAdmissionState: async () => {
      calls.getAdmissionState += 1;
      return state();
    },
    predict: async () => PROXY,
    getCode: async () => "0x",
    whitelistVault: async () => {
      calls.whitelistVault += 1;
      return { txHash: TX_WHITELIST, readyAt: READY_AT };
    },
    createVault: async () => {
      calls.createVault += 1;
      return { txHash: TX_DEPLOY, proxy: PROXY, capRegistry: CAP };
    },
    readCapRegistry: async () => {
      calls.readCapRegistry += 1;
      return CAP;
    },
    ...over,
  };
  return { deps, outcomes, calls };
}

test("no admission yet: whitelists once and reports the cooldown", async () => {
  const { deps, outcomes, calls } = harness([candidate()]);
  assert.equal(await runOnce(CONFIG, deps), 1);
  assert.equal(calls.whitelistVault, 1);
  assert.equal(calls.createVault, 0);
  assert.deepEqual(outcomes, [
    {
      childAddress: CHILD,
      action: "whitelist",
      ok: true,
      txHash: TX_WHITELIST,
      readyAt: READY_AT,
      byAddress: RUNNER,
    },
  ]);
});

test("an AI entry still cooling off is left alone — no tx, no report", async () => {
  const { deps, outcomes, calls } = harness([candidate()], {
    getAdmissionState: async () => state({ whitelistedBy: RUNNER, ready: false }),
  });
  assert.equal(await runOnce(CONFIG, deps), 0);
  assert.equal(calls.whitelistVault, 0);
  assert.equal(calls.createVault, 0);
  assert.deepEqual(outcomes, []);
});

test("a ready AI entry deploys once and reports the wrapper + cap registry", async () => {
  const { deps, outcomes, calls } = harness([candidate()], {
    getAdmissionState: async () => state({ whitelistedBy: RUNNER, ready: true }),
  });
  assert.equal(await runOnce(CONFIG, deps), 1);
  assert.equal(calls.whitelistVault, 0);
  assert.equal(calls.createVault, 1);
  assert.deepEqual(outcomes, [
    {
      childAddress: CHILD,
      action: "deploy",
      ok: true,
      txHash: TX_DEPLOY,
      proxyAddress: PROXY,
      capRegistry: CAP,
    },
  ]);
});

test("an ADMIN entry is skipped — the AI never deploys what the admin added", async () => {
  const { deps, outcomes, calls } = harness([candidate()], {
    getAdmissionState: async () => state({ whitelistedBy: ADMIN, ready: true }),
  });
  assert.equal(await runOnce(CONFIG, deps), 0);
  assert.equal(calls.whitelistVault, 0);
  assert.equal(calls.createVault, 0);
  assert.deepEqual(outcomes, []);
});

test("an already-wrapped child is skipped", async () => {
  const { deps, outcomes, calls } = harness([candidate()], {
    getAdmissionState: async () => state({ wrapper: PROXY }),
  });
  assert.equal(await runOnce(CONFIG, deps), 0);
  assert.equal(calls.whitelistVault, 0);
  assert.equal(calls.createVault, 0);
  assert.deepEqual(outcomes, []);
});

test("a malformed candidate is rejected locally and never reaches the chain", async () => {
  const { deps, outcomes, calls } = harness([candidate({ feeBps: 9999 })]);
  await runOnce(CONFIG, deps);
  assert.equal(calls.getAdmissionState, 0);
  assert.equal(calls.whitelistVault, 0);
  assert.equal(calls.createVault, 0);
  assert.equal(outcomes[0]?.action, "none");
  assert.equal(outcomes[0]?.ok, false);
  assert.match(outcomes[0]?.error ?? "", /rejected/);
});

test("a lost report is recovered: existing code at the predicted address means no second tx", async () => {
  const { deps, outcomes, calls } = harness([candidate()], {
    getAdmissionState: async () => state({ whitelistedBy: RUNNER, ready: true }),
    getCode: async () => "0x6080" as Hex,
  });
  assert.equal(await runOnce(CONFIG, deps), 1);
  assert.equal(calls.createVault, 0);
  assert.equal(calls.readCapRegistry, 1);
  assert.deepEqual(outcomes, [
    {
      childAddress: CHILD,
      action: "deploy",
      ok: true,
      proxyAddress: PROXY,
      capRegistry: CAP,
    },
  ]);
});

test("a reverted whitelist is reported as a failure with the reason", async () => {
  const { deps, outcomes } = harness([candidate()], {
    whitelistVault: async () => {
      throw new Error("execution reverted: AlreadyWhitelisted");
    },
  });
  await runOnce(CONFIG, deps);
  assert.equal(outcomes[0]?.action, "whitelist");
  assert.equal(outcomes[0]?.ok, false);
  assert.match(outcomes[0]?.error ?? "", /AlreadyWhitelisted/);
});

test("one bad candidate does not stop the next one", async () => {
  const second = candidate({ childAddress: CHILD_2 });
  let n = 0;
  const { deps, outcomes } = harness([candidate(), second], {
    whitelistVault: async () => {
      n += 1;
      if (n === 1) throw new Error("first fails");
      return { txHash: TX_WHITELIST, readyAt: READY_AT };
    },
  });
  const acted = await runOnce(CONFIG, deps);
  assert.equal(acted, 1);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.ok, false);
  assert.equal(outcomes[1]?.ok, true);
});

test("an empty candidate list is a quiet no-op", async () => {
  const { deps, outcomes } = harness([]);
  assert.equal(await runOnce(CONFIG, deps), 0);
  assert.deepEqual(outcomes, []);
});

test("a candidate-fetch failure propagates (the tick is degraded, the heartbeat must not advance)", async () => {
  const { deps } = harness([], {
    fetchCandidates: async () => {
      throw new Error("agent down");
    },
  });
  await assert.rejects(() => runOnce(CONFIG, deps), /agent down/);
});
