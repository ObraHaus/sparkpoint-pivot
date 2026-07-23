import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveCapRaw, liveCapRawFor } from "./liveCaps.ts";

// raw USDC base units (6dp): mirror per-user = 5,000 USDC; a live override = 8,000 USDC.
const MIRROR_PERUSER = 5_000_000_000n;

test("liveCapRawFor maps each meter key to its CapRegistry getter slot", () => {
  const live = { perUserCap: 1n, totalCap: 2n, vaultCap: 3n };
  assert.equal(liveCapRawFor("perUserTvl", live), 1n);
  assert.equal(liveCapRawFor("totalProtocol", live), 2n);
  assert.equal(liveCapRawFor("vaultDeposit", live), 3n);
});

test("effectiveCapRaw prefers the live CapRegistry value when present", () => {
  const live = { perUserCap: 8_000_000_000n };
  assert.equal(effectiveCapRaw("perUserTvl", live, MIRROR_PERUSER), 8_000_000_000n);
});

test("effectiveCapRaw falls back to the mirror when that cap is unresolved", () => {
  assert.equal(effectiveCapRaw("perUserTvl", {}, MIRROR_PERUSER), MIRROR_PERUSER);
  // an unrelated live cap present does not satisfy a different key
  assert.equal(effectiveCapRaw("perUserTvl", { totalCap: 9n }, MIRROR_PERUSER), MIRROR_PERUSER);
});

test("effectiveCapRaw treats each key independently", () => {
  const live = { perUserCap: 8_000_000_000n }; // total/vault absent
  assert.equal(effectiveCapRaw("totalProtocol", live, 1_000_000_000_000n), 1_000_000_000_000n);
  assert.equal(effectiveCapRaw("vaultDeposit", live, 1_000_000_000_000n), 1_000_000_000_000n);
});
