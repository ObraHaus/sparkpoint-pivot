import assert from "node:assert/strict";
import { test } from "node:test";

import { planTranscript, shouldShowThinking, stepsSummary, type TranscriptItem } from "./steps.ts";

const step = (label: string, status: "running" | "done" | "error"): TranscriptItem => ({
  type: "tool_step",
  label,
  status,
});
const text = (): TranscriptItem => ({ type: "text" });

/** Exactly what the agent streams for an ordinary recommendation turn. */
const REAL_TURN: TranscriptItem[] = [
  step("Understanding your request", "running"),
  step("Understanding your request", "done"),
  step("Reading your portfolio", "running"),
  step("Reading your portfolio", "done"),
  step("Checking strategies against your guardrails", "running"),
  step("Checking strategies against your guardrails", "done"),
  text(),
];

test("a stage never renders twice", () => {
  const plan = planTranscript(REAL_TURN, { streaming: true });
  const steps = plan.filter((p) => p.kind === "steps");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].indices.length, 3, "three stages, not six rows");
});

test("the surviving row is the one carrying the FINAL status", () => {
  const plan = planTranscript(REAL_TURN, { streaming: true });
  const [group] = plan.filter((p) => p.kind === "steps");
  for (const i of group.indices) {
    assert.equal(REAL_TURN[i].status, "done");
  }
});

test("a live turn keeps its trace visible — that IS the feedback", () => {
  const live: TranscriptItem[] = [
    step("Understanding your request", "done"),
    step("Reading your portfolio", "running"),
  ];
  const [group] = planTranscript(live, { streaming: true }).filter((p) => p.kind === "steps");
  assert.equal(group.collapsed, false);
});

test("a finished turn collapses its trace so the answer leads", () => {
  const plan = planTranscript(REAL_TURN, { streaming: false });
  const [group] = plan.filter((p) => p.kind === "steps");
  assert.equal(group.collapsed, true);
  assert.equal(group.summary, "Worked through 3 steps");
  // And the answer is still there, after the group.
  assert.deepEqual(plan[plan.length - 1], { kind: "card", index: 6 });
});

test("a failed stage stays visible after the turn ends", () => {
  const failed: TranscriptItem[] = [
    step("Understanding your request", "done"),
    step("Checking strategies against your guardrails", "error"),
    text(),
  ];
  const [group] = planTranscript(failed, { streaming: false }).filter((p) => p.kind === "steps");
  assert.equal(group.collapsed, false, "never hide the step that broke");
});

test("order is preserved when a turn thinks, answers, then thinks again", () => {
  const interleaved: TranscriptItem[] = [
    step("Understanding your request", "running"),
    step("Understanding your request", "done"),
    text(),
    step("Reading your portfolio", "running"),
    step("Reading your portfolio", "done"),
    text(),
  ];
  const plan = planTranscript(interleaved, { streaming: false });
  assert.deepEqual(
    plan.map((p) => p.kind),
    ["steps", "card", "steps", "card"],
  );
});

test("the same label in two SEPARATE runs is not deduplicated across them", () => {
  const twice: TranscriptItem[] = [
    step("Reading your portfolio", "done"),
    text(),
    step("Reading your portfolio", "done"),
  ];
  const groups = planTranscript(twice, { streaming: false }).filter((p) => p.kind === "steps");
  assert.equal(groups.length, 2, "two genuine reads, one before and one after the answer");
});

test("a turn with no steps plans nothing but its cards", () => {
  const plan = planTranscript([text(), text()], { streaming: false });
  assert.deepEqual(plan, [
    { kind: "card", index: 0 },
    { kind: "card", index: 1 },
  ]);
});

test("an empty turn plans nothing at all", () => {
  assert.deepEqual(planTranscript([], { streaming: false }), []);
});

test("the summary line is singular for one step", () => {
  assert.equal(stepsSummary(1), "Worked through 1 step");
  assert.equal(stepsSummary(3), "Worked through 3 steps");
});

// ── 036: the live stage belongs to the waiting row, not the trace ────────────

test("036 — the RUNNING stage is not also drawn in the trace while streaming", () => {
  // It was rendered twice: once here and once in the waiting row directly beneath, so the screen
  // read "Checking the knowledge base…" / "Checking the knowledge base… 11s" — a stutter, not
  // progress.
  const plan = planTranscript(
    [
      { type: "tool_step", label: "Understanding your request", status: "done" },
      { type: "tool_step", label: "Checking the knowledge base", status: "running" },
    ],
    { streaming: true },
  );
  const steps = plan.find((p) => p.kind === "steps") as { indices: readonly number[] };
  assert.deepEqual([...steps.indices], [0], "only the finished stage stays in the trace");
});

test("036 — once the turn ends, a stage left running IS shown", () => {
  // A stage still marked running when the stream stops never completed. Hiding it would erase the
  // only evidence of where the turn actually stopped.
  const plan = planTranscript(
    [{ type: "tool_step", label: "Checking the knowledge base", status: "running" }],
    { streaming: false },
  );
  const steps = plan.find((p) => p.kind === "steps") as { indices: readonly number[] };
  assert.deepEqual([...steps.indices], [0]);
});

test("036 — a finished turn's trace is unchanged", () => {
  const plan = planTranscript(
    [
      { type: "tool_step", label: "Understanding your request", status: "done" },
      { type: "tool_step", label: "Explaining that", status: "done" },
    ],
    { streaming: false },
  );
  const steps = plan.find((p) => p.kind === "steps") as { indices: readonly number[]; collapsed: boolean };
  assert.deepEqual([...steps.indices], [0, 1]);
  assert.equal(steps.collapsed, true);
});

/* 059 regression — the waiting row must not flash back under a finished answer. */

test("059 — the waiting row shows while streaming with no prose yet", () => {
  assert.equal(
    shouldShowThinking([step("Understanding your request", "running")], {
      streaming: true,
      hasDelta: false,
    }),
    true,
  );
});

test("059 — no waiting row once provisional prose is painting", () => {
  assert.equal(shouldShowThinking([text()], { streaming: true, hasDelta: true }), false);
});

test("059 — no waiting row under the authoritative final text block", () => {
  // The failure this pins: the final block clears `deltaText` but `streaming` is still true until
  // the generator ends, so the old `streaming && !deltaText` flashed the indicator under the answer.
  assert.equal(shouldShowThinking([text()], { streaming: true, hasDelta: false }), false);
});

test("059 — no waiting row under a final tip block", () => {
  assert.equal(
    shouldShowThinking([{ type: "tip" }], { streaming: true, hasDelta: false }),
    false,
  );
});

test("059 — no waiting row once the turn has stopped", () => {
  assert.equal(shouldShowThinking([], { streaming: false, hasDelta: false }), false);
});
