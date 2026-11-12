import { test } from "node:test";
import assert from "node:assert/strict";

import {
  apyLine,
  isSwapTerminal,
  money,
  relativeTime,
  routeLabel,
  sectionEmptyCopy,
  sectionLabel,
  shortenAddress,
  statusLabel,
  swapStatusLabel,
} from "./format.ts";

test("money formats a decimal string and never invents a figure", () => {
  assert.equal(money("2300"), "$2,300.00");
  assert.equal(money("24431.46"), "$24,431.46");
  assert.equal(money("0"), "$0.00");
  assert.equal(money(null), "—");
  assert.equal(money(undefined), "—");
  assert.equal(money(""), "—");
  assert.equal(money("not-a-number"), "—");
});

test("status labels distinguish a read from a missing link", () => {
  assert.equal(statusLabel("ok"), "Live");
  assert.equal(statusLabel("unavailable"), "Unavailable");
  assert.equal(statusLabel("not_linked"), "Not linked yet");
});

test("section labels cover every section key", () => {
  assert.equal(sectionLabel("balances"), "Wallet balances");
  assert.equal(sectionLabel("morpho"), "Morpho");
  assert.equal(sectionLabel("kamino"), "Kamino");
  assert.equal(sectionLabel("rhea"), "Rhea");
  assert.equal(sectionLabel("swaps"), "Cross-chain swaps");
});

test("route labels prefer the wire route, then the labelled endpoints", () => {
  assert.equal(
    routeLabel({ route: "Base USDC -> Solana USDC", symbol: "USDC" }),
    "Base USDC -> Solana USDC",
  );
  assert.equal(
    routeLabel({
      originLabel: "Base USDC",
      destinationLabel: "NEAR USDC",
      symbol: "USDC",
    }),
    "Base USDC -> NEAR USDC",
  );
  assert.equal(
    routeLabel({ originKey: "base:USDC", destinationKey: "sol:USDC", symbol: "USDC" }),
    "base:USDC -> sol:USDC",
  );
  assert.equal(routeLabel({ symbol: "USDC" }), "USDC");
  assert.equal(routeLabel({ symbol: "" }), "—");
});

test("relative time is deterministic and honest about age", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  assert.equal(relativeTime("2026-11-01T11:59:50Z", now), "just now");
  assert.equal(relativeTime("2026-11-01T11:55:00Z", now), "5 min ago");
  assert.equal(relativeTime("2026-11-01T09:00:00Z", now), "3 hr ago");
  assert.equal(relativeTime("2026-10-30T12:00:00Z", now), "2 days ago");
  assert.equal(relativeTime("2026-10-01T12:00:00Z", now), "2026-10-01");
  assert.equal(relativeTime("2026-11-01T12:05:00Z", now), "just now");
  assert.equal(relativeTime("nope", now), "—");
  assert.equal(relativeTime(undefined, now), "—");
});

test("address shortening keeps short values and elides long ones", () => {
  assert.equal(
    shortenAddress("0xabababababababababababababababababababab"),
    "0xabab…abab",
  );
  assert.equal(shortenAddress("abc.near"), "abc.near");
  assert.equal(shortenAddress(null), "—");
});

test("swap status labels map the wire statuses without inventing success", () => {
  assert.equal(swapStatusLabel("SUCCESS"), "Completed");
  assert.equal(swapStatusLabel("PENDING"), "Pending");
  assert.equal(swapStatusLabel("REFUNDED"), "Refunded");
  assert.equal(swapStatusLabel("weird_status"), "weird_status");
  assert.equal(swapStatusLabel(undefined), "Unknown");
  assert.equal(isSwapTerminal("SUCCESS"), true);
  assert.equal(isSwapTerminal("PENDING"), false);
});

test("empty copy and APY lines are plain and non-fabricating", () => {
  assert.match(sectionEmptyCopy("swaps"), /don't have any cross-chain swaps yet/);
  assert.match(sectionEmptyCopy("kamino"), /linked Solana address/);
  assert.equal(apyLine("4.41"), "4.41% net APY");
  assert.equal(apyLine("14.05", "supply"), "14.05% supply APY");
  assert.equal(
    apyLine("10.2023855120367229327150527", "supply"),
    "10.20% supply APY",
  );
  assert.equal(apyLine(null), "APY unavailable");
});
