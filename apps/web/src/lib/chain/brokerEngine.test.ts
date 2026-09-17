import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveClockIn,
  deriveFuse,
  derivePromote,
  FUSE_MAX_PARTS,
  FUSE_MIN_PARTS,
  fuseBurnFor,
  nextRanks,
  promoteBurnDue,
  rankLabel,
  RANK_ANALYST,
  RANK_ASSOCIATE,
  RANK_PARTNER,
  RANK_UNRANKED,
} from "./brokerEngine.ts";

// The deployed 4663 engine's live schedule (read on-chain 2026-09-16): single-digit values, quoted
// verbatim. `fuseThree` is an ADDITIONAL term — the 3-part fuse costs two + three.
const ENGINE = "0x08a578D2Fa194E24786f5644AFabC578f2daDB43";
const TOKEN = "0x790316a2a1B403b55c6E8a6857Dd768078503553";
const BURNS = { clockIn: 1n, analyst: 1n, associate: 2n, partner: 3n, fuseTwo: 2n, fuseThree: 3n };
const SYMBOL = "SPARKYTEST";

/** Everything read, everything ready — the base a test overrides one field of. */
const READY = {
  engine: ENGINE,
  token: TOKEN,
  owns: true,
  balance: 100n,
  allowance: 100n,
  symbol: SYMBOL,
  walletReady: true,
} as const;

// ── ranks ────────────────────────────────────────────────────────────────────────────────────

test("rank names are the product's, not the engine's Solidity vocabulary", () => {
  assert.equal(rankLabel(RANK_ANALYST), "Analyst");
  assert.equal(rankLabel(RANK_ASSOCIATE), "Associate");
  assert.equal(rankLabel(RANK_PARTNER), "Partner");
  assert.equal(rankLabel(RANK_UNRANKED), "Unranked");
  assert.equal(rankLabel(undefined), "…");
});

test("promotion targets are exactly the ranks above the current one", () => {
  assert.deepEqual(nextRanks(0), [RANK_ASSOCIATE, RANK_PARTNER]);
  assert.deepEqual(nextRanks(1), [RANK_ASSOCIATE, RANK_PARTNER]);
  assert.deepEqual(nextRanks(2), [RANK_PARTNER]);
  assert.deepEqual(nextRanks(3), []);
  assert.deepEqual(nextRanks(undefined), [RANK_ASSOCIATE, RANK_PARTNER]);
});

// ── burn arithmetic ──────────────────────────────────────────────────────────────────────────

test("⚠️ a three-part fuse costs fuseTwo PLUS fuseThree — not fuseThree", () => {
  // The contract's `fuse` charges `n == 2 ? fuseBurnTwo : fuseBurnTwo + fuseBurnThree`. Quoting the
  // single term would understate the burn by a third — the one direction a burn quote must never be
  // wrong in.
  assert.equal(fuseBurnFor(FUSE_MIN_PARTS, BURNS), 2n);
  assert.equal(fuseBurnFor(FUSE_MAX_PARTS, BURNS), 5n);
  assert.equal(fuseBurnFor(3, { fuseTwo: 200_000n * 10n ** 18n, fuseThree: 400_000n * 10n ** 18n }), 600_000n * 10n ** 18n);
});

test("an unread or invalid fuse size is undefined, never a number", () => {
  assert.equal(fuseBurnFor(2, { fuseTwo: undefined, fuseThree: 3n }), undefined);
  assert.equal(fuseBurnFor(2, { fuseTwo: 2n, fuseThree: undefined }), undefined);
  assert.equal(fuseBurnFor(1, BURNS), undefined);
  assert.equal(fuseBurnFor(4, BURNS), undefined);
});

test("a promotion charges only what the rank has not burned yet", () => {
  assert.equal(promoteBurnDue(3n, 2n), 1n);
  assert.equal(promoteBurnDue(3n, 3n), 0n);
  assert.equal(promoteBurnDue(3n, 4n), 0n, "paid more than the target charge owes nothing");
  assert.equal(promoteBurnDue(2n, 0n), 2n);
});

// ── clock in ─────────────────────────────────────────────────────────────────────────────────

test("clocking in a broker you do not hold is blocked", () => {
  const v = deriveClockIn({ ...READY, ...BURNS, burn: BURNS.clockIn, owns: false, alreadyActive: false });
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /don’t hold this broker/);
});

test("⚠️ an already-active broker is blocked BEFORE the burn leg — the burn is not idempotent", () => {
  // Every clockIn call burns `clockInBurn` again, so an active broker must be reported as such even
  // when the wallet holds and has approved plenty.
  const v = deriveClockIn({ ...READY, burn: BURNS.clockIn, alreadyActive: true });
  assert.equal(v.canSubmit, false);
  assert.equal(v.needsApproval, false, "no approval is offered for a call that cannot run");
  assert.match(v.blockedReason ?? "", /already clocked in/);
});

test("an unread burn blocks with the reading reason, never a default price", () => {
  const v = deriveClockIn({ ...READY, burn: undefined, alreadyActive: false });
  assert.equal(v.loaded, false);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Reading the cost/);
});

test("⚠️ a short allowance blocks the verb — this UI approves in a separate transaction", () => {
  const v = deriveClockIn({ ...READY, burn: BURNS.clockIn, alreadyActive: false, allowance: 0n });
  assert.equal(v.needsApproval, true);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Approve the burn/);
});

test("a short balance names the token and does not offer an approval", () => {
  const v = deriveClockIn({ ...READY, burn: 5n, alreadyActive: false, balance: 2n, allowance: 0n });
  assert.equal(v.short, 3n);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /don’t have enough SPARKYTEST/);
});

test("a missing symbol still explains the shortfall without inventing one", () => {
  const v = deriveClockIn({ ...READY, symbol: undefined, burn: 5n, alreadyActive: false, balance: 2n });
  assert.match(v.blockedReason ?? "", /utility tokens/);
});

test("⚠️ a missing balance outranks a missing allowance — approving cannot fix it", () => {
  // ERC-20 `approve` does not check the balance, so an Approve button would succeed and change
  // nothing. When both are short, the balance is the answer the holder needs.
  const v = deriveClockIn({ ...READY, burn: 5n, alreadyActive: false, balance: 1n, allowance: 0n });
  assert.equal(v.needsApproval, true, "the approval is still reported, just not as the reason");
  assert.match(v.blockedReason ?? "", /don’t have enough SPARKYTEST/);
});

test("clocking in with everything read and approved is allowed", () => {
  const v = deriveClockIn({ ...READY, burn: BURNS.clockIn, alreadyActive: false });
  assert.equal(v.canSubmit, true);
  assert.equal(v.blockedReason, undefined);
  assert.equal(v.loaded, true);
});

test("a wallet on the wrong network is the last blocker, not the first", () => {
  const v = deriveClockIn({ ...READY, burn: BURNS.clockIn, alreadyActive: false, walletReady: false });
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Connect your wallet/);
});

test("missing engine or token configuration is reported, not treated as a price of zero", () => {
  const noEngine = deriveClockIn({ ...READY, engine: undefined, burn: BURNS.clockIn, alreadyActive: false });
  assert.equal(noEngine.configured, false);
  assert.match(noEngine.blockedReason ?? "", /engine isn’t available/);

  const noToken = deriveClockIn({ ...READY, token: undefined, burn: BURNS.clockIn, alreadyActive: false });
  assert.equal(noToken.configured, false);
  assert.match(noToken.blockedReason ?? "", /token isn’t wired/);
});

// ── promote ──────────────────────────────────────────────────────────────────────────────────

test("⚠️ an IDLE broker can be promoted — there is no isActive gate", () => {
  // The contract only re-derives weight when a broker is active; a holder may raise a rank before
  // clocking in, and both orders cost the same.
  const v = derivePromote({ ...READY, rank: 0, target: RANK_ASSOCIATE, due: 2n });
  assert.equal(v.canSubmit, true);
});

test("a promotion must be upward, and only to Associate or Partner", () => {
  const same = derivePromote({ ...READY, rank: 2, target: 2, due: 0n });
  assert.equal(same.canSubmit, false);
  assert.match(same.blockedReason ?? "", /already held/);

  const down = derivePromote({ ...READY, rank: 3, target: 2, due: 0n });
  assert.equal(down.canSubmit, false);

  const bad = derivePromote({ ...READY, rank: 0, target: 4, due: 2n });
  assert.equal(bad.canSubmit, false);
  assert.match(bad.blockedReason ?? "", /Associate or Partner/);
});

test("a promotion already burned for is free of approvals", () => {
  // Partner price 3, tierBurned 2 → due 1; the wallet's allowance already covers it.
  const v = derivePromote({ ...READY, rank: 2, target: RANK_PARTNER, due: 1n, allowance: 3n });
  assert.equal(v.needsApproval, false);
  assert.equal(v.canSubmit, true);
});

test("a promotion with the due unread is blocked, never quoted as the full rank price", () => {
  const v = derivePromote({ ...READY, rank: 2, target: RANK_PARTNER, due: undefined });
  assert.equal(v.loaded, false);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Reading the cost/);
});

// ── fuse ─────────────────────────────────────────────────────────────────────────────────────

test("a fuse needs two or three brokers and no duplicates", () => {
  const one = deriveFuse({ ...READY, ids: [1], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: 2n });
  assert.equal(one.canSubmit, false);
  assert.match(one.blockedReason ?? "", /Pick 2 or 3/);

  const four = deriveFuse({ ...READY, ids: [1, 2, 3, 4], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: 5n });
  assert.equal(four.canSubmit, false);

  const dupe = deriveFuse({ ...READY, ids: [1, 1], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: 2n });
  assert.equal(dupe.canSubmit, false);
  assert.match(dupe.blockedReason ?? "", /picked twice/);
});

test("⚠️ every fused id must be held and unfused — the contract rejects a fused SURVIVOR too", () => {
  const notOwned = deriveFuse({ ...READY, ids: [1, 2], allOwned: false, anyAlreadyFused: false, nftApproved: true, burn: 2n });
  assert.equal(notOwned.canSubmit, false);
  assert.match(notOwned.blockedReason ?? "", /must hold every broker/);

  const fused = deriveFuse({ ...READY, ids: [1, 2], allOwned: true, anyAlreadyFused: true, nftApproved: true, burn: 2n });
  assert.equal(fused.canSubmit, false);
  assert.match(fused.blockedReason ?? "", /already fused/);
});

test("fusion requires the ERC-721 approval and says so before anything else", () => {
  const v = deriveFuse({ ...READY, ids: [1, 2], allOwned: true, anyAlreadyFused: false, nftApproved: false, burn: 2n });
  assert.equal(v.needsNftApproval, true);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Approve the engine once/);
});

test("fusion also needs the token allowance — the burn is real", () => {
  const v = deriveFuse({ ...READY, ids: [1, 2, 3], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: 5n, allowance: 0n });
  assert.equal(v.needsApproval, true);
  assert.equal(v.canSubmit, false);
  assert.match(v.blockedReason ?? "", /Approve the burn/);
});

test("a ready two- and three-part fusion is allowed", () => {
  const two = deriveFuse({ ...READY, ids: [1, 2], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: fuseBurnFor(2, BURNS) });
  assert.equal(two.canSubmit, true);

  const three = deriveFuse({ ...READY, ids: [1, 2, 3], allOwned: true, anyAlreadyFused: false, nftApproved: true, burn: fuseBurnFor(3, BURNS) });
  assert.equal(three.canSubmit, true);
  assert.equal(three.needsNftApproval, false);
});
