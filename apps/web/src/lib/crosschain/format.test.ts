import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCountdown,
  formatEta,
  formatHumanAmount,
  formatSlippage,
  formatUsd,
} from "./format.ts";

test("human amounts keep their precision and gain thousands separators", () => {
  assert.equal(formatHumanAmount("5000"), "5,000");
  assert.equal(formatHumanAmount("1234567.8901"), "1,234,567.8901");
  assert.equal(formatHumanAmount("0.06439596"), "0.06439596");
  assert.equal(formatHumanAmount("0"), "0");
});

test("a fraction cap truncates, never rounds a quote upward", () => {
  assert.equal(formatHumanAmount("0.06439596", 6), "0.064395");
  assert.equal(formatHumanAmount("5000.000000", 2), "5,000");
  assert.equal(formatHumanAmount("not-a-number"), "not-a-number");
  assert.equal(formatHumanAmount(""), "—");
});

test("USD estimates are display-only and never invent a value", () => {
  assert.equal(formatUsd("4986.694350"), "$4,986.69");
  assert.equal(formatUsd("5000.000000"), "$5,000.00");
  assert.equal(formatUsd(undefined), "—");
  assert.equal(formatUsd("garbage"), "—");
});

test("ETA copy is human and rounds to whole minutes", () => {
  assert.equal(formatEta(480), "about 8 min");
  assert.equal(formatEta(30), "under a minute");
  assert.equal(formatEta(0), "a short time");
  assert.equal(formatEta(undefined), "a short time");
});

test("slippage bps renders as the percentage the swap card already uses", () => {
  assert.equal(formatSlippage(100), "1%");
  assert.equal(formatSlippage(250), "2.5%");
  assert.equal(formatSlippage(undefined), "—");
});

test("the deadline countdown ticks down and stops at Expired", () => {
  const deadline = "2026-11-01T00:20:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  assert.equal(formatCountdown(deadline, at("2026-11-01T00:19:45.000Z")), "0:15");
  assert.equal(formatCountdown(deadline, at("2026-11-01T00:00:00.000Z")), "20:00");
  assert.equal(formatCountdown(deadline, at("2026-11-01T01:00:00.000Z")), "Expired");
  assert.equal(formatCountdown(undefined, Date.now()), "—");
  assert.equal(formatCountdown("not-a-date", Date.now()), "—");
});
