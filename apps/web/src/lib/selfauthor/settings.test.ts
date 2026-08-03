/**
 * 034 — the console's half of the allowlist rules.
 *
 * These mirror `selfauthor/allowlist.py`. They exist because the server's answer arrives after a
 * round trip and the field has already lost focus by then — but the two must AGREE, so every rule
 * here is the same rule, and a divergence should fail on one side or the other.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  addDomain,
  checkDomain,
  checkWindowHours,
  describeHeld,
  describeOutcome,
  describeState,
  describeWindow,
  removeDomain,
  toggleSource,
} from "./settings.ts";

// ── the allowlist ────────────────────────────────────────────────────────────

test("a bare host is accepted and normalised", () => {
  assert.deepEqual(checkDomain("  DOCS.Aave.com "), { ok: true, value: "docs.aave.com", problem: "" });
});

test("a full URL is refused, and the message says what to do", () => {
  // Silently coercing it would leave the admin believing a PATH restriction is in force. It is not:
  // the allowlist is per-host, and the whole host is allowed.
  const result = checkDomain("https://docs.aave.com/v3");
  assert.equal(result.ok, false);
  assert.match(result.problem, /https:\/\//);
});

test("wildcards, ports, paths and spaces are each refused with their own reason", () => {
  for (const [raw, pattern] of [
    ["*.aave.com", /Wildcards/],
    ["docs.aave.com:443", /port/],
    ["docs.aave.com/v3", /path/],
    ["docs aave com", /spaces/],
    ["localhost", /host name/],
    [".aave.com", /dot/],
    ["", /host name/],
  ] as const) {
    const result = checkDomain(raw);
    assert.equal(result.ok, false, raw);
    assert.match(result.problem, pattern, raw);
  }
});

test("adding keeps the list sorted and refuses a duplicate by name", () => {
  const first = addDomain([], "docs.aave.com");
  assert.deepEqual(first.list, ["docs.aave.com"]);

  const second = addDomain(first.list, "defillama.com");
  assert.deepEqual(second.list, ["defillama.com", "docs.aave.com"]);

  const dupe = addDomain(second.list, "DOCS.AAVE.COM");
  assert.deepEqual(dupe.list, second.list);
  assert.match(dupe.problem, /already/);
});

test("a rejected entry leaves the list untouched", () => {
  const { list, problem } = addDomain(["docs.aave.com"], "https://evil.example/x");
  assert.deepEqual(list, ["docs.aave.com"]);
  assert.ok(problem);
});

test("removing takes out exactly one host", () => {
  assert.deepEqual(removeDomain(["a.com", "b.com"], "a.com"), ["b.com"]);
});

// ── data sources ─────────────────────────────────────────────────────────────

test("toggling a source adds and removes it", () => {
  assert.deepEqual(toggleSource([], "chain"), ["chain"]);
  assert.deepEqual(toggleSource(["chain"], "chain"), []);
});

test("an unknown source cannot be toggled in", () => {
  assert.deepEqual(toggleSource([], "wikipedia"), []);
});

// ── the draft window ─────────────────────────────────────────────────────────

test("zero hours is valid — it means publish immediately", () => {
  assert.deepEqual(checkWindowHours("0"), { ok: true, value: 0, problem: "" });
  assert.equal(describeWindow(0), "publishes immediately");
});

test("a non-number and an over-long window are both refused", () => {
  assert.equal(checkWindowHours("soon").ok, false);
  assert.equal(checkWindowHours("-1").ok, false);
  assert.equal(checkWindowHours("9000").ok, false);
});

test("a window reads as a person would say it", () => {
  assert.equal(describeWindow(1), "1 hour in draft");
  assert.equal(describeWindow(24), "24 hours in draft");
  assert.equal(describeWindow(336), "2 weeks in draft");
});

// ── the state sentence ───────────────────────────────────────────────────────

const ON = {
  enabled: true,
  publishMode: "automatic",
  draftWindowHours: 336,
  allowedDataSources: ["chain", "defillama"],
  allowedProseDomains: ["docs.aave.com"],
};

test("switched off says so, and says what did NOT happen to published work", () => {
  const text = describeState({ ...ON, enabled: false });
  assert.match(text, /Switched off/);
  assert.match(text, /nothing already published has changed/);
});

test("enabled with no sources is called out as the trap it is", () => {
  // Enabled-but-reading-nothing and switched-off look identical if each setting renders alone.
  const text = describeState({ ...ON, allowedDataSources: [] });
  assert.match(text, /no source is allowed/);
  assert.match(text, /will write nothing/);
});

test("an empty prose list is stated as a deliberate setting, not an omission", () => {
  assert.match(describeState({ ...ON, allowedProseDomains: [] }), /no external pages/);
});

test("a zero window does not read as a stutter", () => {
  // The live screen said "Publishing automatically, publishes immediately" — `describeWindow`
  // returns a verb phrase for 0, which reads badly straight after "Publishing".
  const text = describeState({ ...ON, draftWindowHours: 0 });
  assert.match(text, /as soon as a run writes them/);
  assert.doesNotMatch(text, /automatically, publishes/);
});

test("a non-zero window reads as a duration", () => {
  assert.match(describeState({ ...ON, draftWindowHours: 336 }), /after 2 weeks in draft/);
});

test("manual publishing says who does the publishing", () => {
  assert.match(describeState({ ...ON, publishMode: "manual" }), /You publish each document yourself/);
});

// ── run outcomes ─────────────────────────────────────────────────────────────

test("silence is shown as a normal outcome, never as a failure", () => {
  // Most days nothing material changes. A UI that painted this red would train an admin to ignore
  // the status line — and then miss the day it says something real.
  assert.equal(describeOutcome("no_change").tone, "quiet");
  assert.equal(describeOutcome("no_evidence").tone, "quiet");
  assert.equal(describeOutcome("skipped_locked").tone, "quiet");
});

test("a blocked publish reads as what it is: a save, not a crash", () => {
  const blocked = describeOutcome("blocked_selfcheck");
  assert.equal(blocked.tone, "bad");
  assert.match(blocked.text, /would have made an answer worse/);
});

test("an unfinished run does not read as an error", () => {
  assert.equal(describeOutcome(null).text, "Running…");
});

// ── held findings ────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-08-15T00:00:00Z");

test("held findings are described by count AND age", () => {
  // A growing pile is what turns editorial control into silence. A number that goes up is visible
  // in a way that a list alone is not.
  assert.equal(describeHeld(0, null, NOW), "Nothing held.");
  assert.match(describeHeld(1, "2026-08-03T00:00:00Z", NOW), /1 finding held, oldest 12 days ago/);
  assert.match(describeHeld(4, "2026-08-14T12:00:00Z", NOW), /4 findings held, the oldest from today/);
});

test("a missing timestamp still reports the count", () => {
  assert.equal(describeHeld(2, null, NOW), "2 findings held.");
});
