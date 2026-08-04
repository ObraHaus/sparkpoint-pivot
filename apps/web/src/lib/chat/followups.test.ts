/**
 * 037 — the chips after an answer.
 *
 * They never changed. After the first reply the thread still offered "What's in my wallet?" to
 * somebody who had just been told what was in their wallet — worse than offering nothing, because
 * it says the assistant was not listening.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ERROR_FOLLOW_UPS,
  MAX_FOLLOW_UPS,
  STARTER_CHIPS,
  followUps,
  followUpsForThread,
} from "./followups.ts";

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

test("the exit takes the last slot when there is room, and is never the headline", () => {
  const out = followUps(turn({ userMessage: "hello" }));
  assert.equal(out[out.length - 1], "How do I withdraw everything?", out.join(" | "));
  assert.notEqual(out[0], "How do I withdraw everything?", "it sits last, not first");
});

test("the exit never displaces a suggestion that is about the conversation", () => {
  // It is already one tap away from every screen — the left nav carries "Withdraw / Exit"
  // permanently and the banner carries "Exit anytime". Reachability is not what these chips are
  // for, so burning a contextual slot on it every turn would cost relevance and buy nothing.
  const out = followUps(turn({ userMessage: "explain fees", tipTopics: ["performance_fee"] }));
  assert.equal(out.length, MAX_FOLLOW_UPS);
  assert.ok(!out.includes("How do I withdraw everything?"), out.join(" | "));
  assert.ok(out.every((c) => /fee|pay|water|vault paying/i.test(c)), out.join(" | "));
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

// ── the topic strings the agent ACTUALLY sends ───────────────────────────────

test("the real wire topics are matched, not the agent's internal constant names", () => {
  // Observed live, one turn each. The first version keyed off the Python constant names
  // (`what_is_a_performance_fee`, `vault_safety`) and matched almost nothing: every fee question
  // fell through to the generic list while every unit test passed. Only a live turn showed it.
  const cases: [string, RegExp][] = [
    ["performance_fee", /pay nothing|high-water|compare/i],
    ["what_is_apy", /vault paying|alpha rate|guaranteed/i],
    ["aave_vault_safety", /disappear|move my funds|proof/i],
  ];
  for (const [topic, expected] of cases) {
    const out = followUps({ userMessage: "tell me", blockTypes: ["tip"], tipTopics: [topic] });
    assert.ok(out.some((c) => expected.test(c)), `${topic} -> ${out.join(" | ")}`);
  }
});

test("a renamed or unseen topic degrades to real questions, not to nothing", () => {
  // The substring rule is what makes a rename survivable; the fallback is still useful.
  const out = followUps({ userMessage: "x", blockTypes: ["tip"], tipTopics: ["some_new_fee_topic_v2"] });
  assert.ok(out.some((c) => /pay nothing|high-water|compare/i.test(c)), out.join(" | "));

  const unknown = followUps({ userMessage: "x", blockTypes: ["tip"], tipTopics: ["zzz_unmapped"] });
  assert.ok(unknown.length > 0, "still offers something");
});

// ── 039: a reopened conversation is not a new one ────────────────────────────

test("039 — reopening a thread keeps suggestions about where it got to", () => {
  // The bug: a conversation only got contextual chips while it was being typed into. Reopen it
  // from the sidebar and the starters came back — "What's in my wallet?" under a thread that had
  // spent ten turns on fees, as though none of it had happened.
  const out = followUpsForThread([
    { role: "user", text: "hello" },
    { role: "assistant", blockTypes: ["text"] },
    { role: "user", text: "Explain the performance fee" },
    { role: "assistant", blockTypes: ["tip"], tipTopics: ["performance_fee"] },
  ]);
  assert.ok(out.some((c) => /pay nothing|high-water|compare/i.test(c)), out.join(" | "));
});

test("039 — it reads the LAST exchange, not the first", () => {
  const out = followUpsForThread([
    { role: "user", text: "Explain the performance fee" },
    { role: "assistant", blockTypes: ["tip"], tipTopics: ["performance_fee"] },
    { role: "user", text: "how am I doing" },
    { role: "assistant", blockTypes: ["text"], stepLabels: ["Reading your portfolio"] },
  ]);
  assert.ok(out.includes("Where's my risk concentrated?"), out.join(" | "));
  assert.ok(!out.some((c) => /high-water/i.test(c)), "not the older topic: " + out.join(" | "));
});

test("039 — still never offers back the question that prompted the last answer", () => {
  // Most jarring on a reopened thread, because the answer is right there on screen.
  const out = followUpsForThread([
    { role: "user", text: "What's in my wallet?" },
    { role: "assistant", blockTypes: ["portfolio_snapshot"] },
  ]);
  assert.ok(!out.some((c) => /in my wallet/i.test(c)), out.join(" | "));
});

test("039 — an empty thread genuinely IS new, so it says so", () => {
  // The caller shows the starters on an empty result — an empty conversation is a new one.
  assert.deepEqual(followUpsForThread([]), []);
  assert.deepEqual(followUpsForThread([{ role: "user", text: "hi" }]), []);
});

test("039 — a pre-025 turn with no blocks still gets usable suggestions", () => {
  // Older rows replay as a text summary with no structured blocks. There is no topic to go deeper
  // on, but the thread is still not new — generic beats starters.
  const out = followUpsForThread([
    { role: "user", text: "tell me about fees" },
    { role: "assistant" },
  ]);
  assert.ok(out.length > 0, "offers something");
});
