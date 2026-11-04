import test from "node:test";
import assert from "node:assert/strict";

import {
  isTerminalStatus,
  normalizeStatus,
  pollDelayMs,
  shouldPoll,
  statusView,
} from "./status.ts";

test("every contract status has a plain-language view", () => {
  assert.equal(statusView("PENDING_DEPOSIT").step, 0);
  assert.equal(statusView("KNOWN_DEPOSIT_TX").step, 1);
  assert.equal(statusView("PROCESSING").step, 2);
  assert.equal(statusView("SUCCESS").step, 3);
  assert.equal(statusView("SUCCESS").tone, "success");
  assert.equal(statusView("INCOMPLETE_DEPOSIT").tone, "attention");
  assert.equal(statusView("REFUNDED").tone, "attention");
  assert.equal(statusView("FAILED").tone, "attention");
  assert.equal(statusView("EXPIRED").tone, "attention");
  assert.equal(statusView("EXPIRED").terminal, true);
});

test("statuses are case-insensitive and unknown values degrade honestly", () => {
  assert.equal(normalizeStatus("processing"), "PROCESSING");
  assert.equal(normalizeStatus("  success  "), "SUCCESS");
  assert.equal(normalizeStatus("WAT"), null);
  const unknown = statusView("WAT");
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(unknown.terminal, false);
  assert.match(unknown.description, /waiting for an update/i);
});

test("polling stops only on the terminal outcomes named in the contract", () => {
  assert.equal(isTerminalStatus("SUCCESS"), true);
  assert.equal(isTerminalStatus("REFUNDED"), true);
  assert.equal(isTerminalStatus("FAILED"), true);
  assert.equal(isTerminalStatus("EXPIRED"), true);
  assert.equal(isTerminalStatus("INCOMPLETE_DEPOSIT"), false);
  assert.equal(isTerminalStatus("PROCESSING"), false);
  assert.equal(shouldPoll("SUCCESS"), false);
  assert.equal(shouldPoll("PENDING_DEPOSIT"), true);
});

test("polling backs off after ten and twenty minutes", () => {
  assert.equal(pollDelayMs(0), 5_000);
  assert.equal(pollDelayMs(9 * 60_000), 5_000);
  assert.equal(pollDelayMs(10 * 60_000), 15_000);
  assert.equal(pollDelayMs(19 * 60_000), 15_000);
  assert.equal(pollDelayMs(20 * 60_000), 30_000);
  assert.equal(pollDelayMs(-1), 5_000);
});
