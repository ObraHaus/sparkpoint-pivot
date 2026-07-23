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
