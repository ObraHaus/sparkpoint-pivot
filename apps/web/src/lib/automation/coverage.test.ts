import { test } from "node:test";
import assert from "node:assert/strict";

import { isEligibleForAutoExec, actionSelector } from "./coverage.ts";
import { VAULT_DEPOSIT_SELECTOR, VAULT_REDEEM_SELECTOR } from "./scope.ts";
import type { SessionKeyGrant } from "./useSessionKey.ts";
import type { ProposedAction } from "@sparkpoint/shared/schemas";

const VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2";
const NOW = 1_800_000_000_000; // ms
const NOW_S = Math.floor(NOW / 1000);

function grant(over: Partial<SessionKeyGrant> = {}): SessionKeyGrant {
  return {
    sessionKey: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    status: "active",
    allowlist: [
      { target: VAULT, selector: VAULT_DEPOSIT_SELECTOR },
      { target: VAULT, selector: VAULT_REDEEM_SELECTOR },
    ],
    perTxCap: "500000000", // 500 USDC
    cumulativeCap: "5000000000", // 5,000 USDC
    spent: "0",
    maxSlippageBps: 50,
    validUntil: NOW_S + 7 * 86_400,
    validAfter: 0,
    ...over,
  };
}

function deposit(amount: string): ProposedAction {
  return { type: "vault_deposit", asset: "0x0000000000000000000000000000000000000abc", decimals: 6, amount } as ProposedAction;
}

test("actionSelector maps vault types, null otherwise", () => {
  assert.equal(actionSelector("vault_deposit"), VAULT_DEPOSIT_SELECTOR);
  assert.equal(actionSelector("vault_redeem"), VAULT_REDEEM_SELECTOR);
  assert.equal(actionSelector("aerodrome_swap"), null);
});

test("an in-scope deposit within caps is eligible", () => {
  assert.equal(isEligibleForAutoExec(deposit("100000000"), grant(), NOW).ok, true);
});

test("no grant ⇒ ineligible", () => {
  assert.equal(isEligibleForAutoExec(deposit("1"), null, NOW).ok, false);
});

test("over the per-tx cap ⇒ ineligible", () => {
  const r = isEligibleForAutoExec(deposit("500000001"), grant(), NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /per-transaction/i);
});

test("would exceed remaining cumulative budget ⇒ ineligible", () => {
  const r = isEligibleForAutoExec(deposit("400000000"), grant({ spent: "4700000000" }), NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /budget/i);
});

test("off-allowlist selector ⇒ ineligible", () => {
  const r = isEligibleForAutoExec(deposit("1"), grant({ allowlist: [{ target: VAULT, selector: VAULT_REDEEM_SELECTOR }] }), NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /allowlist/i);
});

test("expired grant ⇒ ineligible", () => {
  assert.equal(isEligibleForAutoExec(deposit("1"), grant({ validUntil: NOW_S - 1 }), NOW).ok, false);
});

test("inactive (revoked/exhausted) grant ⇒ ineligible", () => {
  assert.equal(isEligibleForAutoExec(deposit("1"), grant({ status: "revoked" }), NOW).ok, false);
  assert.equal(isEligibleForAutoExec(deposit("1"), grant({ status: "exhausted" }), NOW).ok, false);
});

test("a non-vault action type ⇒ ineligible", () => {
  const swap = { type: "aerodrome_swap", asset: "0x0000000000000000000000000000000000000abc", decimals: 6, amount: "1" } as ProposedAction;
  assert.equal(isEligibleForAutoExec(swap, grant(), NOW).ok, false);
});

test("an EXIT (redeem) is never cap-gated (N2) — eligible even above the caps", () => {
  const redeem = { type: "vault_redeem", asset: "0x0000000000000000000000000000000000000abc", decimals: 6, amount: "999999999999" } as ProposedAction;
  assert.equal(isEligibleForAutoExec(redeem, grant(), NOW).ok, true);
});
