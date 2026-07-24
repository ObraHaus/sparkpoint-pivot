import { test } from "node:test";
import assert from "node:assert/strict";

import { pollUntilTerminal, submitWithRetry, type SubmitResponse, type TerminalStatus } from "./sessionExecuteModel.ts";

const POLICY = { maxAttempts: 3, backoffMs: 0 };
const noSleep = async () => {};
const keyer = () => "stable-idempotency-key";

test("a 2xx returns ok + the userOpHash on the first try (no retry)", async () => {
  let calls = 0;
  const res = await submitWithRetry(
    { newKey: keyer, sleep: noSleep, post: async () => ((calls += 1), { status: 202, userOpHash: "0xabc" }) },
    POLICY,
  );
  assert.equal(res.ok, true);
  assert.equal(res.userOpHash, "0xabc");
  assert.equal(calls, 1);
});

test("a 400 (bundler reject / scope mismatch) is TERMINAL — surfaced, never retried", async () => {
  let calls = 0;
  const res = await submitWithRetry(
    {
      newKey: keyer,
      sleep: noSleep,
      post: async () => ((calls += 1), { status: 400, message: "AA23 reverted: session cap exceeded" }),
    },
    POLICY,
  );
  assert.equal(res.ok, false);
  assert.equal(calls, 1); // NOT retried
  assert.match(res.message ?? "", /session cap exceeded/);
});

test("a 503 is retried with ONE stable idempotency key, then succeeds", async () => {
  const keys: string[] = [];
  const seq: SubmitResponse[] = [{ status: 503 }, { status: 202, userOpHash: "0xdead" }];
  let i = 0;
  const res = await submitWithRetry(
    {
      newKey: keyer,
      sleep: noSleep,
      post: async (k) => {
        keys.push(k);
        return seq[i++];
      },
    },
    POLICY,
  );
  assert.equal(res.ok, true);
  assert.equal(res.userOpHash, "0xdead");
  assert.deepEqual(keys, ["stable-idempotency-key", "stable-idempotency-key"]); // reused across the retry
});

test("a persistent 503 exhausts the attempt budget and returns not-ok", async () => {
  let calls = 0;
  const res = await submitWithRetry(
    { newKey: keyer, sleep: noSleep, post: async () => ((calls += 1), { status: 503 }) },
    POLICY,
  );
  assert.equal(res.ok, false);
  assert.equal(calls, POLICY.maxAttempts);
});

test("pollUntilTerminal stops at the first terminal status", async () => {
  const seq: TerminalStatus[] = ["pending", "pending", "confirmed"];
  let i = 0;
  const out = await pollUntilTerminal(
    { sleep: noSleep, fetchStatus: async () => seq[i++] },
    { maxPolls: 5, intervalMs: 0 },
  );
  assert.equal(out, "confirmed");
  assert.equal(i, 3); // stopped as soon as confirmed
});

test("pollUntilTerminal surfaces 'failed' (a reverted userOp)", async () => {
  const out = await pollUntilTerminal(
    { sleep: noSleep, fetchStatus: async () => "failed" },
    { maxPolls: 5, intervalMs: 0 },
  );
  assert.equal(out, "failed");
});

test("pollUntilTerminal returns 'pending' when the budget is exhausted (honest, not fabricated)", async () => {
  let calls = 0;
  const out = await pollUntilTerminal(
    { sleep: noSleep, fetchStatus: async () => ((calls += 1), "pending") },
    { maxPolls: 4, intervalMs: 0 },
  );
  assert.equal(out, "pending");
  assert.equal(calls, 4);
});

test("a throwing fetchStatus is treated as a transient pending (a blip doesn't abort the poll)", async () => {
  let calls = 0;
  const out = await pollUntilTerminal(
    {
      sleep: noSleep,
      fetchStatus: async () => {
        calls += 1;
        if (calls < 2) throw new Error("network blip");
        return "confirmed";
      },
    },
    { maxPolls: 5, intervalMs: 0 },
  );
  assert.equal(out, "confirmed");
  assert.equal(calls, 2);
});
