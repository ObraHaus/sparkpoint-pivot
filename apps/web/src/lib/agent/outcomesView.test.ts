import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toOutcomesView,
  toRecommendationOutcome,
  toOutcomeDetailView,
} from "./outcomesView.ts";

test("reconciled ledger: formats gains/losses/flat + carries tx proof", () => {
  const v = toOutcomesView({
    reconciles: true,
    stale: false,
    netRealizedUsd: "-20.00",
    wins: 1,
    losses: 1,
    outcomes: [
      { realizedUsd: "-30.00", kind: "loss", amountUsd: "20.00", txHash: "0xaaa", blockNumber: 30 },
      { realizedUsd: "10.00", kind: "gain", amountUsd: "60.00", txHash: "0xbbb", blockNumber: 20 },
    ],
  });
  assert.equal(v.reconciles, true);
  assert.equal(v.netRealizedText, "−$20.00"); // unicode minus for a net loss
  assert.equal(v.netKind, "loss");
  assert.equal(v.wins, 1);
  assert.equal(v.losses, 1);
  assert.equal(v.rows.length, 2);
  assert.equal(v.rows[0].realizedText, "−$30.00");
  assert.equal(v.rows[0].kind, "loss");
  assert.equal(v.rows[0].amountText, "$20.00");
  assert.equal(v.rows[0].txHash, "0xaaa");
  assert.equal(v.rows[1].realizedText, "+$10.00");
  assert.equal(v.rows[1].kind, "gain");
});

test("flat withdrawal renders as $0.00, kind flat", () => {
  const v = toOutcomesView({
    reconciles: true,
    netRealizedUsd: "0.00",
    wins: 0,
    losses: 0,
    outcomes: [{ realizedUsd: "0.00", kind: "flat", amountUsd: "50.00", txHash: "0xc", blockNumber: 5 }],
  });
  assert.equal(v.rows[0].realizedText, "$0.00");
  assert.equal(v.rows[0].kind, "flat");
  assert.equal(v.netRealizedText, "$0.00");
});

test("NOT reconciled → empty ledger, null net (honest, never a partial guess)", () => {
  const v = toOutcomesView({
    reconciles: false,
    outcomes: [{ realizedUsd: "10.00", kind: "gain", amountUsd: "60.00", txHash: "0xz", blockNumber: 9 }],
  });
  assert.equal(v.reconciles, false);
  assert.deepEqual(v.rows, []);
  assert.equal(v.netRealizedText, null);
  assert.equal(v.wins, 0);
  assert.equal(v.losses, 0);
});

test("undefined/empty wire → empty non-reconciled view (no crash)", () => {
  const v = toOutcomesView(undefined);
  assert.equal(v.reconciles, false);
  assert.deepEqual(v.rows, []);
  assert.equal(v.netRealizedText, null);
});

test("missing kind falls back to sign of the realized string", () => {
  const v = toOutcomesView({
    reconciles: true,
    outcomes: [
      { realizedUsd: "-1.00", amountUsd: "9.00", txHash: "0x1", blockNumber: 1 },
      { realizedUsd: "2.00", amountUsd: "9.00", txHash: "0x2", blockNumber: 2 },
    ],
  });
  assert.equal(v.rows[0].kind, "loss");
  assert.equal(v.rows[1].kind, "gain");
});

/* ── §020/US5 — per-recommendation attribution surface ─────────────────────── */

test("reconciled ledger parses recommendations[]: entry/realized/unrealized + provable link", () => {
  const v = toOutcomesView({
    reconciles: true,
    stale: false,
    netRealizedUsd: "0.00",
    wins: 0,
    losses: 0,
    outcomes: [],
    recommendations: [
      {
        recId: "5c3a1c91-4424-4514-9a4f-20c10c1905a7",
        title: "Deposit into the SparkPoint vault",
        strategyKind: "vault_deposit",
        actedTxHash: "0xdd00f9a8",
        entryBlock: 12345,
        entryUsd: "5.00",
        realizedUsd: "0.00",
        unrealizedUsd: "0.12",
        label: "open",
        attributionMethod: "intent_log",
        shared: false,
        reconstructable: true,
      },
    ],
  });
  assert.equal(v.recommendations.length, 1);
  const r = v.recommendations[0];
  assert.equal(r.recId, "5c3a1c91-4424-4514-9a4f-20c10c1905a7");
  assert.equal(r.title, "Deposit into the SparkPoint vault");
  assert.equal(r.entryText, "$5.00");
  assert.equal(r.realizedText, "$0.00");
  assert.equal(r.realizedKind, "flat");
  assert.equal(r.unrealizedText, "+$0.12");
  assert.equal(r.unrealizedKind, "gain");
  assert.equal(r.label, "open");
  assert.equal(r.shared, false);
  assert.equal(r.attributionLabel, "Linked to the transaction you signed");
  assert.equal(r.actedTxHash, "0xdd00f9a8");
});

test("a shared lot is labelled honestly; a loss lot colours down", () => {
  const r = toRecommendationOutcome({
    recId: "r1",
    title: "Vault deposit",
    strategyKind: "vault_deposit",
    actedTxHash: "0xabc",
    entryUsd: "100.00",
    realizedUsd: "-4.00",
    unrealizedUsd: "-1.00",
    label: "loss",
    attributionMethod: "intent_log",
    shared: true,
  });
  assert.equal(r.shared, true);
  assert.equal(r.label, "loss");
  assert.equal(r.realizedText, "−$4.00");
  assert.equal(r.realizedKind, "loss");
  assert.equal(r.unrealizedKind, "loss");
});

test("a '-0.00' unrealized renders flat, not a red loss (honest zero)", () => {
  const r = toRecommendationOutcome({
    recId: "r2",
    entryUsd: "5.00",
    realizedUsd: "0.00",
    unrealizedUsd: "-0.00",
    label: "open",
    attributionMethod: "intent_log",
  });
  assert.equal(r.unrealizedText, "$0.00");
  assert.equal(r.unrealizedKind, "flat");
});

test("a non-intent_log link is NOT labelled (never inferred); title defaults", () => {
  const r = toRecommendationOutcome({ recId: "r3", entryUsd: "1.00", realizedUsd: "0.00", unrealizedUsd: "0.00" });
  assert.equal(r.attributionLabel, "");
  assert.equal(r.title, "Recommendation");
});

test("NOT reconciled → recommendations empty too (honest, never a partial guess)", () => {
  const v = toOutcomesView({
    reconciles: false,
    recommendations: [
      { recId: "x", title: "t", entryUsd: "5.00", realizedUsd: "1.00", unrealizedUsd: "0.00", label: "win" },
    ],
  });
  assert.equal(v.reconciles, false);
  assert.deepEqual(v.recommendations, []);
});

test("detail view: realized APY formats for a closed lot; carries rationale + proposed action", () => {
  const d = toOutcomeDetailView({
    recId: "r1",
    title: "Vault deposit",
    rationale: "Steady Aave yield fits your lower-risk plan.",
    strategyKind: "vault_deposit",
    // The REAL §2.7/§3.5 ProposedAction wire: {type, asset, decimals, amount(base units)} — NOT
    // {kind, amountUsdc}. A $5 USDC deposit is amount "5000000" at 6 decimals.
    proposedAction: {
      type: "vault_deposit",
      asset: "0xba50Cd2Ac9e5f5e0f9E9e0e5e5e5e5e5e5e54D5f",
      decimals: 6,
      amount: "5000000",
      recommendationId: "r1",
    },
    status: "executed",
    actedTxHash: "0xabc",
    entryBlock: 100,
    entryUsd: "5.00",
    realizedUsd: "0.62",
    unrealizedUsd: "0.00",
    realizedApyBps: 1234,
    label: "win",
    attributionMethod: "intent_log",
    shared: false,
    asOfBlock: 200,
  });
  assert.ok(d);
  assert.equal(d!.rationale, "Steady Aave yield fits your lower-risk plan.");
  assert.equal(d!.status, "executed");
  assert.equal(d!.realizedApyText, "+12.34%/yr");
  // Humanised type + DECIMAL-scaled amount — never the raw base-unit "5000000", never a fake symbol.
  assert.equal(d!.proposedActionSummary, "vault deposit · 5");
  assert.equal(d!.asOfBlock, 200);
  assert.equal(d!.attributionLabel, "Linked to the transaction you signed");
});

test("proposedAction: base-unit amounts scale exactly (no float, no raw integer, no fake symbol)", () => {
  const cents = toOutcomeDetailView({
    recId: "a",
    proposedAction: { type: "vault_deposit", asset: "0x", decimals: 6, amount: "5250000" },
  });
  assert.equal(cents!.proposedActionSummary, "vault deposit · 5.25");
  // 18-decimal amount would lose precision via Number(); string math keeps it exact.
  const big = toOutcomeDetailView({
    recId: "b",
    proposedAction: { type: "aave_supply", asset: "0x", decimals: 18, amount: "1000000000000000000" },
  });
  assert.equal(big!.proposedActionSummary, "aave supply · 1");
  // Unparseable / missing amount → label only, never a raw integer.
  const labelOnly = toOutcomeDetailView({ recId: "c", proposedAction: { type: "swap" } });
  assert.equal(labelOnly!.proposedActionSummary, "swap");
  const empty = toOutcomeDetailView({ recId: "d", proposedAction: {} });
  assert.equal(empty!.proposedActionSummary, "");
});

test("detail view: negative realized APY uses the unicode minus; open → null (never extrapolated)", () => {
  const loss = toOutcomeDetailView({
    recId: "l",
    realizedUsd: "-0.30",
    realizedApyBps: -310,
    label: "loss",
    attributionMethod: "intent_log",
  });
  assert.equal(loss!.realizedApyText, "−3.10%/yr");
  const nonFinite = toOutcomeDetailView({ recId: "n", realizedApyBps: Number.POSITIVE_INFINITY });
  assert.equal(nonFinite!.realizedApyText, null);
});

test("rec row honest defensive branches: missing label/recId/figures never fabricate", () => {
  // label absent + realized non-zero → derive from sign (never claim an unprovable win/loss).
  assert.equal(toRecommendationOutcome({ realizedUsd: "-2.00" }).label, "loss");
  assert.equal(toRecommendationOutcome({ realizedUsd: "2.00" }).label, "win");
  // label absent + realized zero → "open" (we don't claim a closed flat we can't see).
  assert.equal(toRecommendationOutcome({ realizedUsd: "0.00" }).label, "open");
  // recId absent → "" (the page hides the toggle + keys off actedTxHash).
  assert.equal(toRecommendationOutcome({ actedTxHash: "0xabc" }).recId, "");
  // entry/realized/unrealized absent → honest em dash, never "$NaN".
  const bare = toRecommendationOutcome({ recId: "z", reconstructable: false });
  assert.equal(bare.entryText, "—");
  assert.equal(bare.realizedText, "—");
  assert.equal(bare.unrealizedText, "—");
});

test("detail view: open lot has null realized APY (never extrapolated); null in → null out", () => {
  const open = toOutcomeDetailView({
    recId: "r2",
    entryUsd: "5.00",
    realizedUsd: "0.00",
    unrealizedUsd: "0.10",
    realizedApyBps: null,
    label: "open",
    attributionMethod: "intent_log",
  });
  assert.equal(open!.realizedApyText, null);
  assert.equal(toOutcomeDetailView(undefined), null);
  assert.equal(toOutcomeDetailView(null), null);
});
