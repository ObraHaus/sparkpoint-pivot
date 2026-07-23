import assert from "node:assert/strict";
import { test } from "node:test";
import {
  derivePremiumPayState,
  PREMIUM_PRICE_SRK_BASE,
  PREMIUM_PRICE_SRK_WHOLE,
} from "./premiumPay.ts";

const SRK = "0x2dF90304126560F01Dd6EafB508B69c033dFeD52";
const TREASURY = "0xCB135893C84876aab9E10792b56e5bEa91dc578f";

test("price is the configured 500 SRK value — never the retired mock 320/500", () => {
  // The whole-token price is 500 and the base price is exactly 500 * 1e18 — not 320, not a bare 500.
  assert.equal(PREMIUM_PRICE_SRK_WHOLE, 500n);
  assert.equal(PREMIUM_PRICE_SRK_BASE, 500n * 10n ** 18n);
  assert.notEqual(PREMIUM_PRICE_SRK_BASE, 320n);
  assert.notEqual(PREMIUM_PRICE_SRK_BASE, 500n);
  assert.equal(derivePremiumPayState({ srk: SRK, treasury: TREASURY }).price, PREMIUM_PRICE_SRK_BASE);
});

test("displayed balance equals the on-chain balanceOf (pass-through, no fabrication)", () => {
  const s = derivePremiumPayState({ srk: SRK, treasury: TREASURY, balance: 777n * 10n ** 18n });
  assert.equal(s.balance, 777n * 10n ** 18n);
  assert.equal(s.balanceKnown, true);
});

test("balance not yet read ⇒ balanceKnown false and no low-balance claim", () => {
  const s = derivePremiumPayState({ srk: SRK, treasury: TREASURY });
  assert.equal(s.balanceKnown, false);
  // balance defaults to 0n internally, but the UI must gate the low state on balanceKnown.
  assert.equal(s.balance, 0n);
});

test("no allowance is involved — the payment is a single plain transfer (SC-007)", () => {
  // The state exposes no `needsApprove`/`allowance`: a self-transfer needs no approval, so the flow
  // never presents an approve leg and grants no standing pull-approval to the treasury.
  const s = derivePremiumPayState({ srk: SRK, treasury: TREASURY, balance: PREMIUM_PRICE_SRK_BASE });
  assert.equal("needsApprove" in s, false);
  assert.equal("allowance" in s, false);
});

test("low + shortfall computed from real balance vs price", () => {
  const s = derivePremiumPayState({ srk: SRK, treasury: TREASURY, balance: 200n * 10n ** 18n });
  assert.equal(s.low, true);
  assert.equal(s.shortfall, 300n * 10n ** 18n);

  const ok = derivePremiumPayState({ srk: SRK, treasury: TREASURY, balance: PREMIUM_PRICE_SRK_BASE });
  assert.equal(ok.low, false);
  assert.equal(ok.shortfall, 0n);
});

test("unset srk on the active chain ⇒ unavailable (not configured), no fabricated price/balance", () => {
  assert.equal(derivePremiumPayState({ treasury: TREASURY }).configured, false);
  assert.equal(derivePremiumPayState({ srk: SRK }).configured, false);
  assert.equal(derivePremiumPayState({}).configured, false);
  assert.equal(derivePremiumPayState({ srk: SRK, treasury: TREASURY }).configured, true);
});
