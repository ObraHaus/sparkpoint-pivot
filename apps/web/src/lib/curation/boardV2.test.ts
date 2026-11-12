import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COLLECTING_HISTORY,
  LIVE_BATCH_SIZE,
  cardSparkline,
  earnApyBps,
  filterBoard,
  flatSparklinePath,
  hasMore,
  heroPick,
  inFlightCounts,
  isLive,
  liveVaults,
  nextBatch,
  sparklinePath,
  sparklineRange,
} from "./boardV2.ts";
import type { CurationBoard, CurationVault } from "./model.ts";

const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";
const NOW = 1_700_000_000_000;

function vault(address: string, over: Partial<CurationVault> = {}): CurationVault {
  return {
    chainId: 4663,
    address,
    source: "morpho",
    label: `Vault ${address.slice(-3)}`,
    asset: { address: null, symbol: "USDG", decimals: 6 },
    curator: null,
    curatorVerified: false,
    listed: true,
    status: "approved",
    provenance: "ai",
    score: 70,
    scoreInputs: {},
    screening: [],
    netApyBps: 420,
    tvlUsd: 1_000,
    liquidityUsd: 900,
    ageSeconds: 86_400,
    wrapped: true,
    wrapperAddress: "0x9999999999999999999999999999999999999999",
    depositMode: "wrapper",
    adminNote: null,
    pinned: false,
    pinnedAt: null,
    decidedBy: null,
    decidedAt: null,
    firstSeenAt: "2026-09-01T00:00:00+00:00",
    lastScanAt: "2026-09-18T00:00:00+00:00",
    updatedAt: "2026-09-18T00:00:00+00:00",
    ...over,
  };
}

function board(over: Partial<CurationBoard> = {}): CurationBoard {
  return {
    chainId: 4663,
    source: "morpho",
    lastRunAt: null,
    lastRunOk: null,
    autoPublish: false,
    pick: null,
    alternates: [],
    vaults: [],
    note: null,
    ...over,
  };
}

test("isLive/liveVaults keep only wrapped, address-bearing vaults", () => {
  const live = vault(A1);
  const unwrapped = vault(A2, { wrapped: false, wrapperAddress: null, depositMode: "direct" });
  const claimed = vault(A3, { wrapperAddress: null });
  assert.equal(isLive(live), true);
  assert.equal(isLive(unwrapped), false);
  assert.equal(isLive(claimed), false);
  assert.deepEqual(liveVaults(board({ vaults: [live, unwrapped, claimed] })).map((v) => v.address), [
    A1,
  ]);
});

test("heroPick prefers the server pick, then the best live vault, else null", () => {
  const pick = vault(A1, { score: 50 });
  const best = vault(A2, { score: 99 });
  assert.equal(heroPick(board({ pick, vaults: [pick, best] }))?.address, A1);

  // The server pick is somehow not live (defensive) → the top live vault leads.
  const unwrappedPick = vault(A1, { wrapped: false, wrapperAddress: null, score: 100 });
  assert.equal(heroPick(board({ pick: unwrappedPick, vaults: [unwrappedPick, best] }))?.address, A2);

  // Nothing live → no hero (the empty state renders instead).
  assert.equal(heroPick(board({ pick: unwrappedPick, vaults: [unwrappedPick] })), null);
});

test("heroPick breaks score ties by TVL then address", () => {
  const a = vault(A2, { score: 80, tvlUsd: 100 });
  const b = vault(A1, { score: 80, tvlUsd: 500 });
  assert.equal(heroPick(board({ vaults: [a, b] }))?.address, A1);
});

test("filterBoard applies the new/ai chips", () => {
  const fresh = vault(A1, { firstSeenAt: new Date(NOW - 24 * 3600 * 1000).toISOString() });
  const old = vault(A2, { firstSeenAt: "2020-01-01T00:00:00+00:00", provenance: "admin" });
  const vaults = [fresh, old];
  assert.equal(filterBoard(vaults, { newOnly: false, aiOnly: false }, NOW).length, 2);
  assert.deepEqual(filterBoard(vaults, { newOnly: true, aiOnly: false }, NOW).map((v) => v.address), [
    A1,
  ]);
  assert.deepEqual(filterBoard(vaults, { newOnly: false, aiOnly: true }, NOW).map((v) => v.address), [
    A1,
  ]);
});

test("nextBatch/hasMore clamp at the end", () => {
  assert.equal(LIVE_BATCH_SIZE, 6);
  assert.equal(nextBatch(0, 20), 6);
  assert.equal(nextBatch(18, 20), 20);
  assert.equal(nextBatch(20, 20), 20);
  assert.equal(hasMore(18, 20), true);
  assert.equal(hasMore(20, 20), false);
});

test("sparklinePath needs two points and scales to the box", () => {
  assert.equal(sparklinePath(undefined, 100, 32), null);
  assert.equal(sparklinePath([{ netApyBps: 400 }], 100, 32), null);
  const path = sparklinePath(
    [{ netApyBps: 400 }, { netApyBps: 420 }, { netApyBps: 410 }],
    100,
    32,
  );
  assert.ok(path);
  assert.match(path ?? "", /^M0\.00,/);
  assert.ok((path ?? "").includes("L50.00,"));
  assert.ok((path ?? "").includes("L100.00,"));
  // A flat series sits mid-box (span fallback), never NaN.
  const flat = sparklinePath([{ netApyBps: 400 }, { netApyBps: 400 }], 100, 32);
  assert.ok(flat && !flat.includes("NaN"));
});

test("sparklineRange is honest and null without a chart", () => {
  assert.equal(sparklineRange([{ netApyBps: 400 }]), null);
  assert.equal(
    sparklineRange([{ netApyBps: 321 }, { netApyBps: 361 }]),
    "3.21% – 3.61%",
  );
});

test("inFlightCounts splits cooling from ready and totals the panel", () => {
  const counts = inFlightCounts({
    entries: [
      { status: "pending", ready: false },
      { status: "pending", ready: true },
      { status: "failed", ready: false },
      { status: "deployed", ready: true },
    ],
    candidates: [{}, {}],
    curation: [{ status: "candidate" }, { status: "approved" }, { status: "candidate" }],
  });
  assert.deepEqual(counts, {
    approvedUnwrapped: 2,
    whitelisted: 2,
    cooling: 1,
    failed: 1,
    candidates: 2,
    total: 7,
  });
});

test("a zero-result filter still leaves the unfiltered list for the chip row", () => {
  // Regression for the "New this week" dead end: filterBoard correctly returns [] when nothing
  // is fresh, but CuratedBoard must gate the header/chips on `live`, not on the filtered list —
  // otherwise the controls that reset the filter unmount with the cards.
  const old = vault(A1, { firstSeenAt: "2020-01-01T00:00:00+00:00" });
  const alsoOld = vault(A2, { firstSeenAt: "2020-01-02T00:00:00+00:00" });
  const live = liveVaults(board({ vaults: [old, alsoOld] }));
  assert.equal(live.length, 2);
  const filtered = filterBoard(live, { newOnly: true, aiOnly: false }, NOW);
  assert.deepEqual(filtered, []);
  // The count the fixed header shows is "0 of 2", not a vanished row.
  assert.equal(`${filtered.length} of ${live.length}`, "0 of 2");
});


test("every card gets a sparkline: real history wins, otherwise a flat current-APY line", () => {
  // History: the 30d range + stored-scans label, exactly like the Galaxy card today.
  const withHistory = cardSparkline(
    [
      { netApyBps: 300 },
      { netApyBps: 420 },
      { netApyBps: 360 },
    ],
    360,
  );
  assert.equal(withHistory.hasHistory, true);
  assert.equal(withHistory.range, "3.00% – 4.20%");
  assert.equal(withHistory.rangeLabel, "Last 30 days: 3.00% – 4.20%");
  assert.equal(withHistory.flatBps, null);
  assert.equal(withHistory.points?.length, 3);

  // No history: a flat line from the CURRENT APY, labelled honestly. No points are invented.
  const noHistory = cardSparkline(undefined, 598);
  assert.equal(noHistory.hasHistory, false);
  assert.equal(noHistory.points, undefined);
  assert.equal(noHistory.flatBps, 598);
  assert.equal(noHistory.range, null);
  assert.equal(noHistory.rangeLabel, COLLECTING_HISTORY);
  assert.equal(noHistory.rangeLabel, "collecting history");

  // One observation is NOT a chart — stay on the honest placeholder.
  const onePoint = cardSparkline([{ netApyBps: 400 }], 400);
  assert.equal(onePoint.hasHistory, false);
  assert.equal(onePoint.flatBps, 400);
  assert.equal(onePoint.rangeLabel, "collecting history");

  // An unknown APY still says collecting history; it just cannot draw a line.
  const unknown = cardSparkline(undefined, null);
  assert.equal(unknown.flatBps, null);
  assert.equal(unknown.rangeLabel, "collecting history");
});

test("flatSparklinePath draws one horizontal rule and never a trend", () => {
  assert.equal(flatSparklinePath(null, 120, 34), null);
  assert.equal(flatSparklinePath(Number.NaN, 120, 34), null);
  assert.equal(flatSparklinePath(420, 120, 34), "M0.00,17.00 L120.00,17.00");
});

test("earnApyBps converts the registry's decimal fraction without rounding a real figure away", () => {
  assert.equal(earnApyBps("0.05983023393148187"), 598);
  assert.equal(earnApyBps("0"), 0);
  assert.equal(earnApyBps(null), null);
  assert.equal(earnApyBps(""), null);
  assert.equal(earnApyBps("not-a-number"), null);
});
