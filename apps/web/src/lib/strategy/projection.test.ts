import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatUsdc,
  isTestnetRate,
  projectAnnual,
  projectionSummary,
} from "./projection.ts";

/** The test wallet's real vault balance on alpha, in USDC base units. */
const BALANCE = 1_503_260_000;
/** The live net rate on alpha: 0.44% gross, 0.40% net of the 10% performance fee. */
const NET_BPS = 40;

test("the figure the strategies screen never showed", () => {
  const p = projectAnnual(BALANCE, NET_BPS);
  assert.ok(p);
  assert.equal(p.balance, "1,503.26");
  assert.equal(p.earnings, "6.01");
  assert.equal(p.idleEarnings, "0.00");
});

test("the summary states the alternative in the same breath", () => {
  const line = projectionSummary(projectAnnual(BALANCE, NET_BPS));
  assert.ok(line);
  assert.match(line, /\$6\.01\/yr/);
  assert.match(line, /leaving it idle: \$0\.00/);
});

test("no balance is NOT zero earnings", () => {
  // "$0.00/yr" to someone holding nothing reads as a claim about the strategy, not the wallet.
  for (const v of [0, null, undefined, -1]) {
    assert.equal(projectAnnual(v, NET_BPS), null, String(v));
  }
  assert.equal(projectionSummary(null), null);
});

test("no rate means no projection — never a silent 0%", () => {
  for (const v of [null, undefined, NaN, Infinity]) {
    assert.equal(projectAnnual(BALANCE, v as number), null, String(v));
  }
});

test("a genuinely near-zero rate still projects — that fact is the point on testnet", () => {
  const p = projectAnnual(BALANCE, 1); // 0.01%
  assert.ok(p, "a real ~0% rate is a true fact, not missing data");
  assert.equal(p.earnings, "0.15");
});

test("arithmetic is exact — never a float cent of drift", () => {
  // 1 USDC at 10000 bps (100%) is exactly 1 USDC.
  assert.equal(projectAnnual(1_000_000, 10_000)?.earnings, "1.00");
  // A large balance must not lose precision — and truncation must never round UP, because an
  // overstated projection is the one direction that misleads. $999,999.999999 at 0.40% is
  // $3,999.999999/yr, which is $3,999.99 truncated, not $4,000.00.
  assert.equal(projectAnnual(999_999_999_999, 40)?.earnings, "3,999.99");
});

test("a negative rate is floored at zero rather than showing negative earnings", () => {
  assert.equal(projectAnnual(BALANCE, -50)?.earnings, "0.00");
});

test("formatting is thousands-separated and always two decimals", () => {
  assert.equal(formatUsdc(0), "0.00");
  assert.equal(formatUsdc(1_000_000), "1.00");
  assert.equal(formatUsdc(1_234_567_890_123), "1,234,567.89");
  assert.equal(formatUsdc(1), "0.00", "sub-cent dust truncates, never rounds up");
});

test("test networks are identified so their rates can be labelled", () => {
  assert.equal(isTestnetRate(84532), true);
  assert.equal(isTestnetRate(46630), true);
  assert.equal(isTestnetRate(8453), false, "Base mainnet rates are real");
  assert.equal(isTestnetRate(undefined), false);
});
