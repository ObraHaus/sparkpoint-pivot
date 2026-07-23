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
});

test("toRecView: non-approved policy is inert; missing fields degrade safely", () => {
  const v = toRecView({ rank: 2, policy: { status: "rejected" } }, 1);
  assert.equal(v.signable, false);
  assert.equal(v.rankLabel, "#2 vs your goal");
  assert.equal(v.apy, 0);
  assert.equal(v.thesis, "");
  assert.deepEqual(v.citations, []);
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
