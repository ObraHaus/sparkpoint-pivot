import { test } from "node:test";
import assert from "node:assert/strict";
import { toOutcomesView } from "./outcomesView.ts";

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
