import assert from "node:assert/strict";
import { test } from "node:test";

import { goalProgress, monthsBetween } from "./progress.ts";

const USDC = 1_000_000;
const TODAY = "2026-08-03";

const base = {
  targetBaseUnits: 10_000 * USDC,
  targetDate: "2027-03-01",
  balanceBaseUnits: 1_503 * USDC,
  today: TODAY,
};

test("the line the product could never show before", () => {
  const p = goalProgress(base);
  assert.ok(p);
  assert.equal(p.pct, 15);
  assert.equal(p.met, false);
  assert.equal(p.monthsRemaining, 6);
  assert.equal(p.shortfallBaseUnits, 8_497 * USDC);
});

test("no target means an invitation, not a fabricated figure", () => {
  // Distinct from "0% of $0" — the caller renders "set a target" rather than a made-up number.
  assert.equal(goalProgress({ ...base, targetBaseUnits: null }), null);
  assert.equal(goalProgress({ ...base, targetBaseUnits: 0 }), null);
  assert.equal(goalProgress({ ...base, targetDate: null }), null);
  assert.equal(goalProgress({ ...base, targetDate: "soon" }), null);
});

test("a target already met reads as MET, never as 103%", () => {
  const p = goalProgress({ ...base, balanceBaseUnits: 12_000 * USDC });
  assert.ok(p);
  assert.equal(p.met, true);
  assert.equal(p.pct, 100);
  assert.equal(p.shortfallBaseUnits, 0);
  assert.equal(p.pace, "on_track");
});

test("a date already passed reads as passed, never as negative months", () => {
  const p = goalProgress({ ...base, targetDate: "2026-01-01" });
  assert.ok(p);
  assert.equal(p.monthsRemaining, 0);
  assert.equal(p.overdue, true);
});

test("a met goal whose date has passed is met, not overdue", () => {
  const p = goalProgress({
    ...base,
    targetDate: "2026-01-01",
    balanceBaseUnits: 20_000 * USDC,
  });
  assert.ok(p);
  assert.equal(p.met, true);
  assert.equal(p.overdue, false);
});

test("a pace that reaches the target says on track", () => {
  const p = goalProgress({
    ...base,
    contribution: { amountBaseUnits: 2_000 * USDC, cadence: "monthly" },
  });
  assert.ok(p);
  assert.equal(p.pace, "on_track");
  assert.equal(p.paceShortfallBaseUnits, 0);
});

test("a pace that does NOT reach the target states the shortfall plainly", () => {
  // $1,503 now + $200/month for 6 months = $2,703 against a $10,000 target.
  const p = goalProgress({
    ...base,
    contribution: { amountBaseUnits: 200 * USDC, cadence: "monthly" },
  });
  assert.ok(p);
  assert.equal(p.pace, "short");
  assert.equal(p.paceShortfallBaseUnits, 7_297 * USDC);
});

test("no stated contribution means UNKNOWN pace, not an assumed zero", () => {
  const p = goalProgress(base);
  assert.ok(p);
  assert.equal(p.pace, "unknown");
  assert.equal(p.paceShortfallBaseUnits, 0);
});

test("an unrecognised cadence contributes nothing rather than guessing", () => {
  const p = goalProgress({
    ...base,
    contribution: { amountBaseUnits: 999_999 * USDC, cadence: "hourly" },
  });
  assert.ok(p);
  assert.equal(p.pace, "unknown");
});

test("every cadence is projected at its real frequency", () => {
  const weekly = goalProgress({
    ...base,
    contribution: { amountBaseUnits: 500 * USDC, cadence: "weekly" },
  });
  const quarterly = goalProgress({
    ...base,
    contribution: { amountBaseUnits: 500 * USDC, cadence: "quarterly" },
  });
  assert.equal(weekly?.pace, "on_track");
  assert.equal(quarterly?.pace, "short", "the same amount, far less often, does not get there");
});

test("no balance is 0% of the target, not an error", () => {
  const p = goalProgress({ ...base, balanceBaseUnits: null });
  assert.ok(p);
  assert.equal(p.pct, 0);
  assert.equal(p.shortfallBaseUnits, 10_000 * USDC);
});

test("percentage is always within 0..100", () => {
  for (const balance of [-5, 0, 1, 10_000 * USDC, 99_999_999 * USDC]) {
    const p = goalProgress({ ...base, balanceBaseUnits: balance });
    assert.ok(p && p.pct >= 0 && p.pct <= 100, String(balance));
  }
});

test("month arithmetic is pure and never negative", () => {
  assert.equal(monthsBetween("2026-08-03", "2027-03-01"), 6);
  assert.equal(monthsBetween("2026-08-03", "2026-08-03"), 0);
  assert.equal(monthsBetween("2027-03-01", "2026-08-03"), 0, "past dates floor at zero");
  assert.equal(monthsBetween("nonsense", "2027-03-01"), 0);
});
