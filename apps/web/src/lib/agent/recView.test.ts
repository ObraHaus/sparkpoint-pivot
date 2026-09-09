import { test } from "node:test";
import assert from "node:assert/strict";
import { toRecView, parseCitations } from "./recView.ts";

test("toRecView maps live rationale, net APY, signable, and Obsidian citations", () => {
  const v = toRecView(
    {
      recId: "rec_supply_aave",
      rank: 1,
      title: "Move idle USDC into Aave",
      rationale: "Aave's USDC rate clears your mandate at low risk.",
      projectedApyBps: 387,
      policy: { status: "approved" },
      citations: [
        {
          provider: "Aave v3 Yield Basics",
          endpoint: "obsidian://aave-yield",
          field: "USDC supply",
          value: "Supplying USDC earns the variable supply rate.",
          asOf: "2026-07-14T00:00:00Z",
          stale: false,
        },
      ],
    },
    0,
  );
  assert.equal(v.id, "rec_supply_aave");
  assert.equal(v.rankLabel, "Best fit · #1 vs your goal");
  assert.equal(v.thesis, "Aave's USDC rate clears your mandate at low risk.");
  assert.equal(v.apy, 3.87);
  assert.equal(v.signable, true);
  assert.equal(v.best, true);
  assert.equal(v.citations.length, 1);
  assert.equal(v.citations[0].provider, "Aave v3 Yield Basics");
  assert.equal(v.citations[0].url, undefined); // omitted on the wire ⇒ undefined
  assert.equal(v.apyKnown, true);
});

test("toRecView: non-approved policy is inert; missing fields degrade safely", () => {
  const v = toRecView({ rank: 2, policy: { status: "rejected" } }, 1);
  assert.equal(v.signable, false);
  assert.equal(v.rankLabel, "#2 vs your goal");
  assert.equal(v.apy, 0);
  assert.equal(v.thesis, "");
  assert.deepEqual(v.citations, []);
  assert.equal(v.apyKnown, false); // no projectedApyBps on the wire → "no yield (cash)"
});

test("apyKnown is true for a measured 0 APY (testnet), false when the field is absent", () => {
  assert.equal(toRecView({ projectedApyBps: 0 }, 0).apyKnown, true); // ≈0% (testnet), not "no yield"
  assert.equal(toRecView({}, 0).apyKnown, false);
});

test("parseCitations: drops malformed rows, keeps url, defaults optionals", () => {
  const cs = parseCitations([
    null,
    { provider: 123 }, // bad provider type
    { provider: "X" }, // missing value → dropped
    { provider: "Aave", value: "rate 4.3%", url: "https://basescan.org/x" },
  ]);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].provider, "Aave");
  assert.equal(cs[0].value, "rate 4.3%");
  assert.equal(cs[0].url, "https://basescan.org/x");
  assert.equal(cs[0].field, "");
  assert.equal(cs[0].stale, false);
});

test("parseCitations: non-array input yields empty list", () => {
  assert.deepEqual(parseCitations(undefined), []);
  assert.deepEqual(parseCitations("nope"), []);
});

test("parseCitations: only http(s) urls survive — javascript:/data: are dropped (XSS guard)", () => {
  const rows = parseCitations([
    { provider: "A", value: "v", url: "javascript:alert(1)" },
    { provider: "B", value: "v", url: "data:text/html,<script>x</script>" },
    { provider: "C", value: "v", url: "  HTTPS://basescan.org/tx/0x1  " },
    { provider: "D", value: "v", url: "http://example.com" },
    { provider: "E", value: "v", url: "ftp://x" },
  ]);
  assert.equal(rows[0].url, undefined); // javascript: dropped
  assert.equal(rows[1].url, undefined); // data: dropped
  assert.equal(rows[2].url, "  HTTPS://basescan.org/tx/0x1  "); // https (case/space tolerant) kept
  assert.equal(rows[3].url, "http://example.com");
  assert.equal(rows[4].url, undefined); // ftp: dropped
});

// ── 030 · the card stops asserting things it never checked ────────────────────

test("a growth plan is never told a conservative strategy 'fits your plan: lower risk'", () => {
  // The exact contradiction observed on alpha: the wallet's mandate was growth (tier 4) and the
  // page said "Fits your plan: lower risk, steady yield" — a hardcoded string that never read
  // the plan the page claims to rank against.
  const v = toRecView({ rank: 1, riskTier: 1, policy: { status: "approved" } }, 0, 4);
  assert.ok(!/lower risk, steady yield/i.test(v.fit));
  assert.match(v.fit, /more conservative than your plan/i);
  assert.match(v.fit, /1\/5 vs your 4\/5/);
});

test("the fit line follows the plan, and changes when the plan does", () => {
  const conservative = toRecView({ riskTier: 1 }, 0, 1).fit;
  const growth = toRecView({ riskTier: 1 }, 0, 4).fit;
  assert.notEqual(conservative, growth);
  assert.match(conservative, /matches your plan/i);
});

test("a strategy above the plan's risk level says so", () => {
  assert.match(toRecView({ riskTier: 4 }, 0, 1).fit, /above the risk level your plan allows/i);
});

test("below-plan copy observes, it never urges more risk", () => {
  // 029's advice boundary still applies: sitting in something safer than your mandate permits is
  // an observation, not a prompt.
  const fit = toRecView({ riskTier: 1 }, 0, 5).fit.toLowerCase();
  for (const nudge of ["should", "consider", "could earn", "upgrade", "increase your risk"]) {
    assert.ok(!fit.includes(nudge), `${nudge} in: ${fit}`);
  }
});

test("no saved plan still renders without asserting a plan the user didn't set", () => {
  const fit = toRecView({ rank: 1, riskTier: 1 }, 0, undefined).fit;
  assert.ok(!/your plan/i.test(fit));
  assert.ok(fit.length > 0);
});

test("the risk tier is the strategy's own, not a constant", () => {
  assert.equal(toRecView({ riskTier: 4 }, 0).risk, 4);
  assert.equal(toRecView({ riskTier: 3 }, 0).risk, 3);
});

test("a pre-030 agent (no riskTier on the wire) degrades to the old display, not a wrong one", () => {
  assert.equal(toRecView({}, 0).risk, 1);
  for (const bad of [0, 6, -1, NaN, "3" as unknown as number]) {
    assert.equal(toRecView({ riskTier: bad }, 0).risk, 1, String(bad));
  }
});

test("the cost line states the only real difference between the two strategies", () => {
  const vault = toRecView({ feeStance: "managed_fee", managedBy: "sparkpoint" }, 0);
  assert.match(vault.cost, /10% of yield, profit only/i);
  assert.match(vault.cost, /managed for you/i);

  const direct = toRecView({ feeStance: "no_platform_fee", managedBy: "self" }, 1);
  assert.match(direct.cost, /no sparkpoint fee/i);
  assert.match(direct.cost, /you manage/i);

  // An unknown stance says nothing rather than inheriting the vault's fee copy.
  assert.equal(toRecView({}, 0).cost, "");
});

test("the amount is carried so the confirm step needn't ask again", () => {
  assert.equal(toRecView({ proposedAction: { amount: "100000000" } }, 0).amountBaseUnits, "100000000");
  assert.equal(toRecView({}, 0).amountBaseUnits, undefined);
});
