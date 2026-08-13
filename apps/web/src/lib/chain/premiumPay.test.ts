import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSettlePremium,
  derivePremiumPayState,
  PREMIUM_PRICE_SRK_BASE,
  PREMIUM_PRICE_SRK_WHOLE,
  PREMIUM_SETTLEMENT_CHAIN_IDS,
} from "./premiumPay.ts";

const SRK = "0x2dF90304126560F01Dd6EafB508B69c033dFeD52";
const TREASURY = "0xCB135893C84876aab9E10792b56e5bEa91dc578f";
/** The one chain the agent's PaymentVerifier can see. */
const BASE_SEPOLIA = 84532;
/** Has its OWN SRK + faucet since 043 phase 1 — real, spendable, and unverifiable as a payment. */
const ROBINHOOD_TESTNET = 46630;

test("price is the client-decided 10,000 SRK value — never the retired 320/500", () => {
  // The whole-token price is 10,000 and the base price is exactly 10000 * 1e18 — never a bare 10000
  // (that would be 1e-14 SRK), and never the superseded 500 or the retired mock 320.
  assert.equal(PREMIUM_PRICE_SRK_WHOLE, 10_000n);
  assert.equal(PREMIUM_PRICE_SRK_BASE, 10_000n * 10n ** 18n);
  assert.notEqual(PREMIUM_PRICE_SRK_BASE, 320n);
  assert.notEqual(PREMIUM_PRICE_SRK_BASE, 500n * 10n ** 18n);
  assert.notEqual(PREMIUM_PRICE_SRK_BASE, 10_000n);
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
  assert.equal(s.shortfall, PREMIUM_PRICE_SRK_BASE - 200n * 10n ** 18n);
  // At the current 10,000-SRK price that is 9,800 SRK short — two faucet claims away.
  assert.equal(s.shortfall, 9_800n * 10n ** 18n);

  const ok = derivePremiumPayState({ srk: SRK, treasury: TREASURY, balance: PREMIUM_PRICE_SRK_BASE });
  assert.equal(ok.low, false);
  assert.equal(ok.shortfall, 0n);
});

test("unset srk on the active chain ⇒ unavailable (not configured), no fabricated price/balance", () => {
  const on = { chainId: BASE_SEPOLIA };
  assert.equal(derivePremiumPayState({ ...on, treasury: TREASURY }).configured, false);
  assert.equal(derivePremiumPayState({ ...on, srk: SRK }).configured, false);
  assert.equal(derivePremiumPayState({ ...on }).configured, false);
  assert.equal(derivePremiumPayState({ ...on, srk: SRK, treasury: TREASURY }).configured, true);
});

test("a chain the verifier cannot see is NEVER configured, however complete its addresses", () => {
  // 043 phase 1 gave Robinhood testnet its own SRK + faucet so a broker can retire SRK on its own
  // chain. That SRK is real and spendable — but `payment_verifier.py` is built with one srk_address
  // and one RPC, so a transfer made there can never be credited. Paying on it would be money out
  // with no Premium and no repair path, so the buy must be unavailable even if a future edit fills
  // in `premiumTreasury` for that chain. This asserts the gate, not the absence of a field.
  assert.equal(
    derivePremiumPayState({ srk: SRK, treasury: TREASURY, chainId: ROBINHOOD_TESTNET }).configured,
    false,
  );
  // …and no chain at all is likewise closed, rather than defaulting to "probably Base Sepolia".
  assert.equal(derivePremiumPayState({ srk: SRK, treasury: TREASURY }).configured, false);

  assert.equal(canSettlePremium(BASE_SEPOLIA), true);
  assert.equal(canSettlePremium(ROBINHOOD_TESTNET), false);
  assert.equal(canSettlePremium(undefined), false);
  // Base MAINNET is not a settlement chain either — SRK Premium is testnet-only today.
  assert.equal(canSettlePremium(8453), false);
  assert.deepEqual([...PREMIUM_SETTLEMENT_CHAIN_IDS], [BASE_SEPOLIA]);
});
