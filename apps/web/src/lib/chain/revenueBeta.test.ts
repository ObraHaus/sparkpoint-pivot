import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AS_IS_DISCLOSURE,
  ENGINE_UPGRADE_NOTE,
  holdingsByBroker,
  NATIVE_ASSET,
  nonzeroHoldings,
  REVENUE_ROUTE,
  VAULT_CUSTODY_NOTE,
} from "./revenueBeta.ts";

// ── the route ────────────────────────────────────────────────────────────────────────────────

test("the route is six numbered steps, in order, each pointing at a deployment address", () => {
  assert.equal(REVENUE_ROUTE.length, 6);
  assert.deepEqual(
    REVENUE_ROUTE.map((s) => s.n),
    [1, 2, 3, 4, 5, 6],
  );
  for (const step of REVENUE_ROUTE) {
    assert.ok(step.title.length > 0, `step ${step.n} has a title`);
    assert.ok(step.detail.length > 0, `step ${step.n} has a detail`);
  }
  assert.deepEqual(
    REVENUE_ROUTE.map((s) => s.address),
    ["curve", "feeEscrow", "splitter", "engine", "vault", "vault"],
  );
});

test("the route names the functions that perform each step, so it is checkable on-chain", () => {
  const text = REVENUE_ROUTE.map((s) => s.detail).join(" ");
  for (const fn of ["sweepCurve()", "settle()", "deliver()", "withdraw()"]) {
    assert.ok(text.includes(fn), `route names ${fn}`);
  }
});

test("⚠️ the route never claims a conversion or a payout asset", () => {
  // AS-IS is the architecture: fees arrive as ETH and are delivered as ETH. A "swapped to USDC"
  // step would describe a system that does not exist — the one copy change that would mislead.
  const text = REVENUE_ROUTE.map((s) => `${s.title} ${s.detail}`).join(" ");
  assert.doesNotMatch(text, /convert|swap(ped)? (in)?to|into USDC|payout asset/i);
  assert.match(text, /ETH/);
});

// ── the disclosures ──────────────────────────────────────────────────────────────────────────

test("the AS-IS disclosure says ETH in, ETH out — and that nothing is projected", () => {
  assert.match(AS_IS_DISCLOSURE, /ETH in, ETH out/);
  assert.match(AS_IS_DISCLOSURE, /no swap/);
  assert.match(AS_IS_DISCLOSURE, /nothing is projected/);
});

test("the vault custody note states the absence of every escape hatch", () => {
  for (const word of ["no owner", "no upgrade path", "no fee parameter", "no rescue function"]) {
    assert.ok(VAULT_CUSTODY_NOTE.includes(word), `custody note says "${word}"`);
  }
});

test("⚠️ the engine note discloses the upgradeability the vault does NOT have", () => {
  assert.match(ENGINE_UPGRADE_NOTE, /UUPS proxy/);
  assert.match(ENGINE_UPGRADE_NOTE, /owner can upgrade/);
  assert.match(ENGINE_UPGRADE_NOTE, /vault .*immutable/i);
});

// ── holdings ─────────────────────────────────────────────────────────────────────────────────

test("zero rows are dropped — the vault's asset bitmap never clears on withdrawal", () => {
  const rows = [
    { tokenId: 1n, asset: NATIVE_ASSET, amount: 5n },
    { tokenId: 1n, asset: "0xAAA", amount: 0n },
    { tokenId: 2n, asset: NATIVE_ASSET, amount: 0n },
  ];
  const kept = nonzeroHoldings(rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].tokenId, 1n);
  assert.equal(kept[0].amount, 5n);
});

test("holdings group by broker and preserve order", () => {
  const rows = [
    { tokenId: 7n, asset: NATIVE_ASSET, amount: 1n },
    { tokenId: 3n, asset: "0xBBB", amount: 2n },
    { tokenId: 7n, asset: "0xBBB", amount: 3n },
  ];
  const grouped = holdingsByBroker(rows);
  assert.deepEqual(
    [...grouped.keys()],
    [7n, 3n],
  );
  assert.equal(grouped.get(7n)?.length, 2);
  assert.equal(grouped.get(3n)?.length, 1);
  assert.equal(grouped.get(3n)?.[0].amount, 2n);
});

test("the zero address is the native-ETH convention, spelled out once", () => {
  assert.equal(NATIVE_ASSET, "0x0000000000000000000000000000000000000000");
});
