/**
 * 036 — the waiting state, tested where it can be tested.
 *
 * The old indicator was a dot and the word "Working…", which answers none of the three questions a
 * person has while waiting: is it alive, what is it doing, and how long has this been going.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_LABEL,
  LONG_WAIT_MS,
  currentStep,
  formatElapsed,
  reassurance,
  thinkingLabel,
} from "./thinking.ts";

// ── the clock ────────────────────────────────────────────────────────────────

test("under a minute reads as plain seconds", () => {
  // "0m 08s" is not how anyone reads a stopwatch at eight seconds.
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(8_000), "8s");
  assert.equal(formatElapsed(59_400), "59s");
});

test("past a minute the seconds are padded so the number stops jumping width", () => {
  // An unpadded "1m 4s" → "1m 10s" changes width every ten seconds, which is what makes a ticking
  // timer feel twitchy rather than steady.
  assert.equal(formatElapsed(60_000), "1m 00s");
  assert.equal(formatElapsed(64_000), "1m 04s");
  assert.equal(formatElapsed(1528_000), "25m 28s");
});

test("a negative or nonsense elapsed does not render as a negative clock", () => {
  // Clocks drift and a re-render can arrive with a start time in the future.
  assert.equal(formatElapsed(-5_000), "0s");
});

// ── which step ───────────────────────────────────────────────────────────────

const running = (label: string) => ({ type: "tool_step", label, status: "running" });
const done = (label: string) => ({ type: "tool_step", label, status: "done" });

test("the running step is what gets named", () => {
  assert.equal(currentStep([done("Understanding your request"), running("Reading your portfolio")]),
    "Reading your portfolio");
});

test("a FINISHED step is not named, because the ellipsis would be a lie", () => {
  // The agent emits running then done for each stage. Between stages the honest answer is
  // "thinking" — "Reading your portfolio…" claims a present tense that has already passed.
  assert.equal(currentStep([running("Reading your portfolio"), done("Reading your portfolio")]), null);
});

test("non-step cards are ignored", () => {
  const cards = [running("Understanding your request"), { type: "text" }, { type: "citation" }];
  assert.equal(currentStep(cards), "Understanding your request");
});

test("nothing streamed yet has no step", () => {
  assert.equal(currentStep([]), null);
  assert.equal(currentStep([{ type: "text" }]), null);
});

test("a step block without a label cannot name anything", () => {
  assert.equal(currentStep([{ type: "tool_step", status: "running" }]), null);
});

test("the label always carries the ellipsis that means 'still'", () => {
  assert.equal(thinkingLabel("Reading your portfolio"), "Reading your portfolio…");
  assert.equal(thinkingLabel(null), `${DEFAULT_LABEL}…`);
});

// ── the long wait ────────────────────────────────────────────────────────────

test("a short wait needs no excuse", () => {
  // Under ten seconds a turn feels responsive; saying "still going" would invent a problem.
  assert.equal(reassurance(0), null);
  assert.equal(reassurance(LONG_WAIT_MS - 1), null);
});

test("a long wait says so, and a very long wait says more", () => {
  // Silence past ten seconds starts to read as a stall. Naming the wait is what separates "slow"
  // from "stuck".
  assert.ok(reassurance(LONG_WAIT_MS)?.includes("Still going"));
  assert.ok(reassurance(45_000)?.includes("nothing is lost"));
});
