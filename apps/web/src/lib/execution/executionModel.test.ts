import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatDelta,
  isExitKind,
  isExpired,
  isRelayRetryable,
  relayWithRetry,
  signGate,
  stepToTx,
} from "./executionModel.ts";
import type { IntentBundle, IntentStep } from "@sparkpoint/shared/schemas";

const STEP = {
  chainId: 84532,
  opType: "eoa_call",
  to: "0x00000000000000000000000000000000000000aa",
  value: "0",
  data: "0x6e553f6500000000000000000000000000000000000000000000000000000000000f4240",
  label: "Deposit USDC",
} as IntentStep;

function mkBundle(over: Record<string, unknown>): IntentBundle {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    userId: "0x1111111111111111111111111111111111111111",
    kind: "vault_deposit",
    steps: [STEP],
    userOp: null,
    simulation: null,
    policyVerdict: { approved: true, policyVersion: "policy@2026.06.0", reasons: [], normalizedAction: null, simulation: null },
    guardrailChecklist: [],
    rationale: "why",
    citations: [],
    recommendationId: null,
    policyVersion: "policy@2026.06.0",
    expiresAt: "2999-01-01T00:00:00Z",
    ...over,
  } as IntentBundle;
}

test("stepToTx signs the server calldata VERBATIM (byte-match, SC-005)", () => {
  const tx = stepToTx(STEP);
  assert.equal(tx.to, STEP.to); // no re-encode
  assert.equal(tx.data, STEP.data); // exact server bytes
  assert.equal(tx.value, 0n);
});

test("isExitKind marks the withdraw/redeem/aave_withdraw path", () => {
  assert.equal(isExitKind("vault_redeem"), true);
  assert.equal(isExitKind("vault_withdraw"), true);
  assert.equal(isExitKind("aave_withdraw"), true);
  assert.equal(isExitKind("vault_deposit"), false);
});

test("isExpired compares against expiresAt", () => {
  const now = Date.parse("2026-07-23T12:00:00Z");
  assert.equal(isExpired("2026-07-23T12:00:03Z", now), false);
  assert.equal(isExpired("2026-07-23T11:59:57Z", now), true);
  assert.equal(isExpired("not-a-date", now), false); // malformed → not expired
});

test("signGate allows an approved, fresh, chain-matched bundle", () => {
  const g = signGate(mkBundle({}), 84532, Date.now());
  assert.equal(g.canSign, true);
  assert.equal(g.reason, undefined);
});

test("signGate refuses a rejected bundle", () => {
  const b = mkBundle({ policyVerdict: { approved: false, policyVersion: "p", reasons: [], normalizedAction: null, simulation: null } });
  assert.equal(signGate(b, 84532, Date.now()).canSign, false);
});

test("signGate refuses an expired bundle", () => {
  const b = mkBundle({ expiresAt: "2000-01-01T00:00:00Z" });
  const g = signGate(b, 84532, Date.now());
  assert.equal(g.canSign, false);
  assert.match(g.reason ?? "", /expired/i);
});

test("signGate refuses a wrong-network bundle", () => {
  const g = signGate(mkBundle({}), 8453, Date.now()); // step is 84532
  assert.equal(g.canSign, false);
  assert.match(g.reason ?? "", /network/i);
});

test("signGate signs an approved EXIT even with a null simulation (N2)", () => {
  const b = mkBundle({ kind: "vault_redeem", simulation: null });
  assert.equal(signGate(b, 84532, Date.now()).canSign, true);
});

test("formatDelta renders exact signed decimals", () => {
  assert.equal(formatDelta("-100000000", 6), "-100");
  assert.equal(formatDelta("98765432", 6), "+98.765432");
  assert.equal(formatDelta("0", 6), "+0");
});

/* ── §3.6 relay retry-on-409 (feature 020 follow-up) ─────────────────────────── */

test("isRelayRetryable: only a 409/503 transient degrade, never a 400 mismatch or 2xx", () => {
  assert.equal(isRelayRetryable(409), true); // DATA_STALE — tx not yet visible to the agent's RPC
  assert.equal(isRelayRetryable(503), true); // UPSTREAM_UNAVAILABLE — transient
  assert.equal(isRelayRetryable(400), false); // byte-mismatch (SC-005) — permanent
  assert.equal(isRelayRetryable(200), false);
  assert.equal(isRelayRetryable(0), false); // network error — best-effort stop
});

test("relayWithRetry: a 2xx first attempt records once, no retry", async () => {
  let calls = 0;
  const status = await relayWithRetry(
    { post: async () => (calls += 1) && 200, sleep: async () => {}, newKey: () => "k" },
    { maxAttempts: 3, backoffMs: 0 },
  );
  assert.equal(status, 200);
  assert.equal(calls, 1);
});

test("relayWithRetry: retries a 409 DATA_STALE then succeeds; ONE stable idempotency key throughout", async () => {
  const keys: string[] = [];
  const seq = [409, 409, 200];
  let i = 0;
  let sleeps = 0;
  const status = await relayWithRetry(
    {
      post: async (k) => {
        keys.push(k);
        return seq[i++];
      },
      sleep: async () => {
        sleeps += 1;
      },
      newKey: () => "stable-key",
    },
    { maxAttempts: 4, backoffMs: 1500 },
  );
  assert.equal(status, 200);
  assert.equal(keys.length, 3); // two retries then success
  assert.equal(sleeps, 2); // one backoff before each retry
  // SAME key on every attempt → the agent dedups a successful record (no double-record).
  assert.deepEqual([...new Set(keys)], ["stable-key"]);
});

test("relayWithRetry: a 400 byte-mismatch is permanent — no retry", async () => {
  let calls = 0;
  const status = await relayWithRetry(
    { post: async () => (calls += 1) && 400, sleep: async () => {}, newKey: () => "k" },
    { maxAttempts: 4, backoffMs: 0 },
  );
  assert.equal(status, 400);
  assert.equal(calls, 1);
});

test("relayWithRetry: gives up after maxAttempts of a persistent 409 (best-effort, never throws)", async () => {
  let calls = 0;
  const status = await relayWithRetry(
    { post: async () => (calls += 1) && 409, sleep: async () => {}, newKey: () => "k" },
    { maxAttempts: 3, backoffMs: 0 },
  );
  assert.equal(status, 409);
  assert.equal(calls, 3);
});

test("relayWithRetry: a network error (0) stops immediately (the receipt is the source of truth)", async () => {
  let calls = 0;
  const status = await relayWithRetry(
    { post: async () => (calls += 1) && 0, sleep: async () => {}, newKey: () => "k" },
    { maxAttempts: 4, backoffMs: 0 },
  );
  assert.equal(status, 0);
  assert.equal(calls, 1);
});
