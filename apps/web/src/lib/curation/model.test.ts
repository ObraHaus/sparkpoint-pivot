import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditLine,
  candidateQueue,
  curationStatusTone,
  curatorRunLabel,
  curatorRunState,
  fmtAge,
  fmtApyBps,
  fmtUsdCompact,
  newThisWeek,
  screeningFailures,
  shortAddr,
  type CurationVault,
} from "./model.ts";

const NOW = Date.parse("2026-09-18T12:00:00Z");

function vault(over: Partial<CurationVault> = {}): CurationVault {
  return {
    chainId: 4663,
    address: "0x1111111111111111111111111111111111111111",
    source: "morpho",
    label: "Alpha USDC",
    asset: { address: null, symbol: "USDC", decimals: 6 },
    curator: "Gauntlet",
    curatorVerified: true,
    listed: true,
    status: "candidate",
    provenance: "ai",
    score: 70,
    scoreInputs: {},
    screening: [{ code: "tvl", ok: true, detail: "" }],
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

test("unknown figures render as an em dash, never a zero", () => {
  assert.equal(fmtApyBps(null), "—");
  assert.equal(fmtUsdCompact(null), "—");
  assert.equal(fmtAge(null), "—");
  assert.equal(fmtApyBps(441), "4.41%");
  assert.equal(fmtUsdCompact(420_745_952), "$420.7M");
  assert.equal(fmtUsdCompact(12_500), "$13k");
  assert.equal(fmtAge(30 * 86_400), "30d");
});

test("addresses shorten without losing which one it is", () => {
  assert.equal(shortAddr("0x1111111111111111111111111111111111111111"), "0x1111…1111");
});

test("candidate queue ranks by score then TVL, deterministically", () => {
  const a = vault({ address: "0xaaa", score: 70, tvlUsd: 100 });
  const b = vault({ address: "0xbbb", score: 90, tvlUsd: 1 });
  const c = vault({ address: "0xccc", score: 70, tvlUsd: 200 });
  const approved = vault({ address: "0xddd", status: "approved" });
  assert.deepEqual(
    candidateQueue([a, approved, b, c]).map((v) => v.address),
    ["0xbbb", "0xccc", "0xaaa"],
  );
});

test("new this week uses firstSeenAt and excludes older vaults", () => {
  const fresh = vault({ address: "0xaaa", firstSeenAt: "2026-09-15T00:00:00Z" });
  const old = vault({ address: "0xbbb", firstSeenAt: "2026-08-01T00:00:00Z" });
  assert.deepEqual(newThisWeek([fresh, old], NOW).map((v) => v.address), ["0xaaa"]);
});

test("screening failures are what the reviewer sees", () => {
  const v = vault({
    screening: [
      { code: "asset", ok: true, detail: "USDC" },
      { code: "tvl", ok: false, detail: "TVL unavailable" },
      { code: "age", ok: false, detail: "2h (min 1d)" },
    ],
  });
  assert.deepEqual(screeningFailures(v).map((s) => s.code), ["tvl", "age"]);
});

test("run state distinguishes never-run, failed, requested and ok", () => {
  assert.equal(curatorRunState({ lastRunAt: null, lastRunOk: null }), "never-run");
  assert.equal(
    curatorRunState({ lastRunAt: "2026-09-18T00:00:00Z", lastRunOk: false }),
    "failed",
  );
  assert.equal(
    curatorRunState({
      lastRunAt: "2026-09-18T00:00:00Z",
      lastRunOk: true,
      runRequestedAt: "2026-09-18T11:00:00Z",
    }),
    "requested",
  );
  assert.equal(curatorRunState({ lastRunAt: "2026-09-18T00:00:00Z", lastRunOk: true }), "ok");
  assert.match(curatorRunLabel({ lastRunAt: null, lastRunOk: null }), /hasn't run/);
});

test("status tone is semantic: denied is not the same colour as hidden", () => {
  assert.equal(curationStatusTone("denied"), "bad");
  assert.equal(curationStatusTone("approved"), "ok");
  assert.notEqual(curationStatusTone("hidden"), curationStatusTone("candidate"));
});

test("audit lines name the action, the vault and who did it", () => {
  const line = auditLine({
    action: "approve",
    chainId: 4663,
    address: "0x1111111111111111111111111111111111111111",
    actor: "0xA71e24359A6cb7A939aae2d62dD12b6256365c30",
    detail: {},
    at: "2026-09-18T00:00:00Z",
  });
  assert.match(line, /Approved 0x1111…1111/);
  assert.match(line, /0xA71e…5c30/);
});
