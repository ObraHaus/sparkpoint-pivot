/**
 * 037 — the chips after an answer.
 *
 * They never changed. After the first reply the thread still offered "What's in my wallet?" to
 * somebody who had just been told what was in their wallet — worse than offering nothing, because
 * it says the assistant was not listening.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ERROR_FOLLOW_UPS, MAX_FOLLOW_UPS, STARTER_CHIPS, followUps } from "./followups.ts";

const turn = (over: Partial<Parameters<typeof followUps>[0]> = {}) => ({
  userMessage: "",
  blockTypes: ["text"],
  ...over,
});

test("never suggests the question that was just asked", () => {
  // The whole point. Offering it back is the thing that reads as deaf.
  const out = followUps(turn({ userMessage: "What's in my wallet?", blockTypes: ["portfolio_snapshot"] }));
  assert.ok(!out.includes("What's in my wallet?"), out.join(" | "));
});

test("catches the same question asked in different words", () => {
  // "Explain the performance fee" and "what is a performance fee" are one question.
  const out = followUps(
    turn({ userMessage: "Explain the performance fee please", tipTopics: ["what_is_a_performance_fee"] }),
  );
  assert.ok(!out.some((c) => /performance fee/i.test(c) && /what|explain/i.test(c)), out.join(" | "));
});

test("goes one level deeper on the concept just explained", () => {
  const out = followUps(turn({ userMessage: "what is apy", tipTopics: ["what_is_apy"] }));
  assert.ok(out.includes("Why is the alpha rate so low?"), out.join(" | "));
});

test("uses what the agent was seen doing", () => {
  const out = followUps(
    turn({ userMessage: "how am I doing", blockTypes: ["text"], stepLabels: ["Reading your portfolio"] }),
  );
  assert.ok(out.includes("Where's my risk concentrated?"), out.join(" | "));
});

test("a recommendation invites the questions worth asking about one", () => {
  const out = followUps(turn({ userMessage: "put my usdc to work", blockTypes: ["recommendation"] }));
  assert.ok(out.includes("What's the risk?"), out.join(" | "));
});

test("the exit is always one tap away, and never the headline", () => {
  // The product's central promise. It should never be buried — and never pushed either.
  const out = followUps(turn({ userMessage: "hello" }));
  assert.ok(out.includes("How do I withdraw everything?"), out.join(" | "));
  assert.notEqual(out[0], "How do I withdraw everything?", "it sits last, not first");
});

test("asking about withdrawing does not suggest asking about withdrawing", () => {
  const out = followUps(turn({ userMessage: "How do I withdraw everything?", tipTopics: ["how_to_withdraw"] }));
  assert.ok(!out.includes("How do I withdraw everything?"), out.join(" | "));
});

test("never more than a handful, and never a duplicate", () => {
  const out = followUps(
    turn({
      userMessage: "tell me everything",
      blockTypes: ["recommendation", "portfolio_snapshot", "outcome", "action"],
      tipTopics: ["what_is_apy", "vault_safety"],
      stepLabels: ["Reading your portfolio", "Checking strategies against your guardrails"],
    }),
  );
  assert.ok(out.length <= MAX_FOLLOW_UPS, `${out.length} chips`);
  assert.equal(new Set(out).size, out.length, "no duplicates");
});

test("the most specific signal wins the top slot", () => {
  // A tip topic is more specific than "a recommendation happened", which is more specific than
  // "some text arrived". The first chip should be about what was actually discussed.
  const out = followUps(
    turn({ userMessage: "is it safe", blockTypes: ["recommendation"], tipTopics: ["vault_safety"] }),
  );
  assert.equal(out[0], "What happens if you disappear?", out.join(" | "));
});

test("an unknown topic still produces real questions, never filler", () => {
  const out = followUps(turn({ userMessage: "something unusual", tipTopics: ["not_a_known_topic"] }));
  assert.ok(out.length > 0);
  assert.ok(out.every((c) => c.trim().length > 8), out.join(" | "));
});

test("a failed turn is not offered conversation follow-ups", () => {
  // "What's the risk?" under a failure reads as though nothing went wrong.
  assert.ok(ERROR_FOLLOW_UPS.length > 0);
  assert.ok(!ERROR_FOLLOW_UPS.some((c) => /risk|vault vs/i.test(c)), ERROR_FOLLOW_UPS.join(" | "));
});

test("the empty-thread chips still say what this thing is for", () => {
  assert.ok(STARTER_CHIPS.includes("What's in my wallet?"));
  assert.ok(STARTER_CHIPS.length >= 6, "a new user needs a spread, not three");
});
