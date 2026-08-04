/**
 * 040 — the grouping rules, tested as data.
 *
 * Every case below is one line here and a scheduling problem in a browser: you cannot wait for
 * midnight, or for daylight saving, to check a sidebar.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  bucketFor,
  daysAgo,
  groupConversations,
  olderLabel,
  rowTimestamp,
  type HistoryRow,
} from "./historyGroups.ts";

/** A local-time date, so the tests exercise the same boundary the reader does. */
const at = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm);
const row = (id: string, when: Date, title = "t"): HistoryRow => ({
  id,
  title,
  updatedAt: when.toISOString(),
});

const NOW = at(2026, 8, 4, 10, 30); // Tue 4 Aug 2026, 10:30 local

// ── the boundary ─────────────────────────────────────────────────────────────

test("the day boundary is local midnight, not 24 hours ago", () => {
  // 23:59 yesterday is Yesterday when read at 00:01 today — eleven minutes apart, different days.
  const justBefore = at(2026, 8, 3, 23, 59);
  const justAfter = at(2026, 8, 4, 0, 1);
  assert.equal(bucketFor(justBefore, justAfter).label, "Yesterday");
  // …and 20 hours earlier on the SAME day is still Today, though it is more than "a day ago" is not.
  assert.equal(bucketFor(at(2026, 8, 4, 0, 5), at(2026, 8, 4, 23, 55)).label, "Today");
});

test("daysAgo counts calendar days, not elapsed milliseconds", () => {
  assert.equal(daysAgo(at(2026, 8, 4, 0, 1), NOW), 0);
  assert.equal(daysAgo(at(2026, 8, 3, 23, 59), NOW), 1);
  assert.equal(daysAgo(at(2026, 7, 28), NOW), 7);
});

test("a date in the future does not fall out of the list", () => {
  // Clock skew is real. It should read as Today, never as a negative bucket that renders nothing.
  assert.equal(bucketFor(at(2026, 8, 5), NOW).label, "Today");
});

// ── the buckets ──────────────────────────────────────────────────────────────

test("the four recent buckets cover the boundaries exactly", () => {
  const cases: [Date, string][] = [
    [at(2026, 8, 4), "Today"],
    [at(2026, 8, 3), "Yesterday"],
    [at(2026, 8, 2), "Previous 7 days"],
    [at(2026, 7, 28), "Previous 7 days"], // 7 days
    [at(2026, 7, 27), "Previous 30 days"], // 8 days
    [at(2026, 7, 5), "Previous 30 days"], // 30 days
  ];
  for (const [when, label] of cases) {
    assert.equal(bucketFor(when, NOW).label, label, when.toDateString());
  }
});

test("beyond 30 days it is the month name, without the year, in the current year", () => {
  assert.equal(bucketFor(at(2026, 6, 15), NOW).label, "June");
  assert.equal(bucketFor(at(2026, 1, 2), NOW).label, "January");
});

test("a month in a PREVIOUS year carries its year, because January means two things otherwise", () => {
  assert.equal(bucketFor(at(2025, 1, 15), NOW).label, "January 2025");
  assert.equal(bucketFor(at(2024, 12, 31), NOW).label, "December 2024");
});

// ── ordering and shape ───────────────────────────────────────────────────────

test("groups run newest period first", () => {
  const groups = groupConversations(
    [
      row("old", at(2025, 3, 3)),
      row("june", at(2026, 6, 6)),
      row("today", NOW),
      row("month", at(2026, 7, 10)),
      row("yesterday", at(2026, 8, 3)),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Today", "Yesterday", "Previous 30 days", "June", "March 2025"],
  );
});

test("an empty period never renders a heading", () => {
  const groups = groupConversations([row("a", NOW)], NOW);
  assert.deepEqual(groups.map((g) => g.label), ["Today"]);
});

test("every group carries its count", () => {
  const groups = groupConversations([row("a", NOW), row("b", NOW), row("c", at(2026, 8, 3))], NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [["Today", 2], ["Yesterday", 1]]);
});

test("order within a group is preserved, so the API's sort still holds", () => {
  const groups = groupConversations([row("first", NOW), row("second", NOW)], NOW);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["first", "second"]);
});

test("group keys are stable and unique — they are React keys, the labels are not", () => {
  const groups = groupConversations([row("a", at(2026, 1, 5)), row("b", at(2025, 1, 5))], NOW);
  const keys = groups.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length);
  // Same month, different years, same LABEL word — the keys must still differ.
  assert.notEqual(keys[0], keys[1]);
});

test("last activity wins over creation, so a resumed thread moves", () => {
  const resumed = { id: "r", title: "t", createdAt: at(2026, 6, 1).toISOString(), updatedAt: NOW.toISOString() };
  assert.equal(groupConversations([resumed], NOW)[0].label, "Today");
});

test("a row with no usable date is kept, not silently dropped", () => {
  // A conversation you cannot date is still one you might want to open. Hiding it would be a worse
  // bug than putting it last, and a much quieter one.
  const groups = groupConversations([{ id: "x", title: "t" }, row("a", NOW)], NOW);
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Earlier"]);
  assert.equal(groups[1].rows[0].id, "x");
});

test("a malformed date is treated as undated rather than throwing", () => {
  const groups = groupConversations([{ id: "x", title: "t", updatedAt: "not a date" }], NOW);
  assert.equal(groups[0].label, "Earlier");
});

test("an empty history produces no groups at all", () => {
  assert.deepEqual(groupConversations([], NOW), []);
});

// ── telling rows apart ───────────────────────────────────────────────────────

test("today's rows show a clock time — that is what distinguishes five identical questions", () => {
  const stamp = rowTimestamp(row("a", at(2026, 8, 4, 14, 5)), NOW);
  assert.match(stamp, /\d/);
  assert.ok(!/Aug/.test(stamp), stamp);
});

test("older rows show a date, because by then the hour is not what you remember", () => {
  assert.match(rowTimestamp(row("a", at(2026, 7, 2)), NOW), /Jul/);
});

test("an undated row shows nothing rather than 'Invalid Date'", () => {
  assert.equal(rowTimestamp({ id: "x", title: "t" }, NOW), "");
});

// ── the show-older control ───────────────────────────────────────────────────

test("the control names the exact number remaining", () => {
  // "Show more" leaves you not knowing whether you are near the end, which is the question the
  // missing rows created in the first place.
  assert.equal(olderLabel(50, 110), "Show 60 older conversations");
  assert.equal(olderLabel(109, 110), "Show 1 older conversation");
});

test("the control DISAPPEARS when everything is loaded — its absence is the statement", () => {
  assert.equal(olderLabel(110, 110), null);
  assert.equal(olderLabel(50, 50), null);
  assert.equal(olderLabel(50, 0), null, "a nonsense total must not render a negative count");
});
