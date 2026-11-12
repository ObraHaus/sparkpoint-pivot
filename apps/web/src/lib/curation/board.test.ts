import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASK_SPARKY_QUESTION,
  boardEmptyCopy,
  boardIsEmpty,
  boardProvenance,
  chatAskHref,
  filterVaults,
  provenanceChip,
  vaultDeepLink,
} from "./board.ts";
import type { CurationBoard, CurationVault } from "./model.ts";

const NOW = Date.parse("2026-09-18T12:00:00Z");

function vault(over: Partial<CurationVault> = {}): CurationVault {
  return {
    chainId: 4663,
    address: "0x1111111111111111111111111111111111111111",
    source: "morpho",
    label: "Gauntlet USDC Prime",
    asset: { address: null, symbol: "USDC", decimals: 6 },
    curator: "Gauntlet",
    curatorVerified: true,
    listed: true,
    status: "approved",
    provenance: "ai",
    score: 69,
    scoreInputs: {},
    screening: [],
    netApyBps: 441,
    tvlUsd: 420_000_000,
    liquidityUsd: 167_000_000,
    ageSeconds: 30 * 86_400,
    wrapped: false,
    wrapperAddress: null,
    depositMode: "direct",
    adminNote: null,
    pinned: false,
    pinnedAt: null,
    decidedBy: null,
    decidedAt: null,
    firstSeenAt: "2026-09-15T00:00:00Z",
    lastScanAt: "2026-09-18T00:00:00Z",
    updatedAt: "2026-09-18T00:00:00Z",
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

test("provenance chips distinguish an admin pin from an AI row", () => {
  assert.equal(provenanceChip(vault()).label, "AI pick");
  assert.equal(provenanceChip(vault({ provenance: "admin" })).label, "Admin");
  assert.equal(provenanceChip(vault({ pinned: true })).label, "Admin pick");
});

test("the provenance line reports the update and admits when there was none", () => {
  assert.equal(boardProvenance(board()), "No updates yet");
  assert.match(
    boardProvenance(board({ lastRunAt: "2026-09-18T00:00:00Z", lastRunOk: true })),
    /Last updated/,
  );
  assert.equal(
    boardProvenance(board({ lastRunAt: null, lastRunOk: false })),
    "Last update failed",
  );
});

test("filters match label, symbol and address without re-ranking", () => {
  const a = vault({ address: "0xaaa", label: "Gauntlet USDC Prime" });
  const b = vault({ address: "0xbbb", label: "Spark USDC", asset: { address: null, symbol: "USDG", decimals: 6 } });
  assert.deepEqual(filterVaults([a, b], {}, NOW), [a, b]);
  assert.deepEqual(filterVaults([a, b], { query: "usdg" }, NOW), [b]);
  assert.deepEqual(filterVaults([a, b], { query: "0xaaa" }, NOW), [a]);
  const old = vault({ address: "0xccc", firstSeenAt: "2026-01-01T00:00:00Z" });
  assert.deepEqual(filterVaults([a, old], { newOnly: true }, NOW), [a]);
});

test("empty copy separates never-run, failed and genuinely-empty", () => {
  assert.match(boardEmptyCopy(board()).title, /hasn't run/);
  assert.match(boardEmptyCopy(board({ lastRunOk: false })).title, /failed/i);
  assert.match(
    boardEmptyCopy(board({ lastRunAt: "2026-09-18T00:00:00Z", lastRunOk: true })).title,
    /No curated vaults/,
  );
});

test("boardIsEmpty is about content, not freshness", () => {
  assert.equal(boardIsEmpty(board()), true);
  assert.equal(boardIsEmpty(board({ pick: vault() })), false);
  assert.equal(boardIsEmpty(board({ vaults: [vault()] })), false);
});

test("the chat entry point prefills the exact question and deep-links rows", () => {
  assert.equal(chatAskHref(), `/chat?ask=${encodeURIComponent(ASK_SPARKY_QUESTION)}`);
  assert.match(chatAskHref("where should I deposit?"), /where%20should%20I%20deposit%3F/);
  assert.equal(vaultDeepLink("0xabc"), "/vault?vault=0xabc");
});
