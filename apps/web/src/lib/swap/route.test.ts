import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeDirect, encodeTwoHop, planCandidates, pickBest } from "./route.pure.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0xcccccccccccccccccccccccccccccccccccccccc" as const;

// ── path encoding ──────────────────────────────────────────────────────────
test("encodeDirect packs token|fee(3 bytes)|token — 43 bytes, lowercased", () => {
  const p = encodeDirect(A, 3000, B);
  assert.equal(p.length, 2 + 86); // 0x + 40 + 6 + 40
  assert.equal(p, ("0x" + A.slice(2) + "000bb8" + B.slice(2)).toLowerCase());
});

test("encodeDirect encodes each fee tier as a 3-byte big-endian uint24", () => {
  assert.ok(encodeDirect(A, 500, B).includes("0001f4"));
  assert.ok(encodeDirect(A, 3000, B).includes("000bb8"));
  assert.ok(encodeDirect(A, 10000, B).includes("002710"));
});

test("encodeTwoHop packs token|fee|hop|fee|token — 66 bytes", () => {
  const p = encodeTwoHop(A, 500, WETH, 3000, B);
  assert.equal(p.length, 2 + 132); // 0x + 40 + 6 + 40 + 6 + 40
  assert.equal(p, ("0x" + A.slice(2) + "0001f4" + WETH.slice(2) + "000bb8" + B.slice(2)).toLowerCase());
});

// ── route planning ─────────────────────────────────────────────────────────
test("planCandidates: arbitrary pair → 3 direct + 4 via-WETH + 4 via-USDC", () => {
  const c = planCandidates({ tokenIn: A, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true });
  assert.equal(c.filter((x) => x.kind === "single").length, 3);
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "WETH").length, 4);
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "USDC").length, 4);
});

test("planCandidates: a caller can widen the direct fee tiers (Robinhood mainnet's 1bp pool)", () => {
  const c = planCandidates({ tokenIn: A, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true, feeTiers: [100, 500, 3000, 10000] });
  assert.equal(c.filter((x) => x.kind === "single").length, 4);
  assert.ok(c.some((x) => x.kind === "single" && x.fee === 100));
});

test("planCandidates: prunes the via-WETH hop when a side already IS WETH", () => {
  const c = planCandidates({ tokenIn: WETH, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true });
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "WETH").length, 0);
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "USDC").length, 4);
});

test("planCandidates: skips the USDC hop where USDC isn't a real routing asset", () => {
  const c = planCandidates({ tokenIn: A, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: false });
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "USDC").length, 0);
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "WETH").length, 4);
});

// W.7 fee-router: it executes a single exactInputSingle hop, so multi-hop candidates must not be
// quoted (a path route cannot be expressed through it).
test("planCandidates: singleHopOnly keeps direct pools only", () => {
  const c = planCandidates({ tokenIn: A, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true, singleHopOnly: true });
  assert.equal(c.length, 3);
  assert.ok(c.every((x) => x.kind === "single"));
});

test("planCandidates: singleHopOnly still widens to the caller's fee tiers (Robinhood 1bp)", () => {
  const c = planCandidates({ tokenIn: A, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true, feeTiers: [100, 500, 3000, 10000], singleHopOnly: true });
  assert.equal(c.length, 4);
  assert.ok(c.some((x) => x.kind === "single" && x.fee === 100));
});

test("planCandidates: prunes the via-USDC hop when a side already IS USDC", () => {
  const c = planCandidates({ tokenIn: USDC, tokenOut: B, weth: WETH, usdc: USDC, usdcIsRoutingAsset: true });
  assert.equal(c.filter((x) => x.kind === "multi" && x.via === "USDC").length, 0);
});

test("pickBest chooses the greatest output; empty → undefined; ties keep the first", () => {
  assert.equal(pickBest([]), undefined);
  const best = pickBest([
    { amountOut: 10n, tag: "a" },
    { amountOut: 30n, tag: "b" },
    { amountOut: 30n, tag: "c" }, // tie with b — b (first) wins
    { amountOut: 5n, tag: "d" },
  ]);
  assert.equal(best?.tag, "b");
});
