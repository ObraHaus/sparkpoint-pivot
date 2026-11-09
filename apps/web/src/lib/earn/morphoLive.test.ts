import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_USDC_ADDRESS,
  MorphoLiveError,
  buildMorphoDepositPlan,
  buildMorphoWithdrawPlan,
  feeBpsLabel,
  findMorphoVault,
  parseMorphoAmount,
} from "./morphoLive.ts";

const VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";
const ACCOUNT = "0xBddA41D11014FdD9a656386e29Af1a1349f94f13";

test("amounts parse at the asset/share decimals without floats", () => {
  assert.equal(parseMorphoAmount("100", 6), 100_000_000n);
  assert.equal(parseMorphoAmount("0.000001", 6), 1n);
  assert.equal(parseMorphoAmount("0.0000001", 6), null);
  assert.equal(parseMorphoAmount("0", 6), null);
  assert.equal(parseMorphoAmount("1.123456789012345678", 18), 1_123_456_789_012_345_678n);
  assert.equal(parseMorphoAmount("1.1234567890123456789", 18), null);
});

test("deposit adds an approve leg only when the live allowance is short", () => {
  const needs = buildMorphoDepositPlan({ vault: VAULT, account: ACCOUNT, amount: "100", allowance: 0n });
  assert.equal(needs.kind, "deposit");
  assert.equal(needs.assets, 100_000_000n);
  assert.equal(needs.token, BASE_USDC_ADDRESS);
  assert.equal(needs.needsApprove, true);

  const enough = buildMorphoDepositPlan({
    vault: VAULT,
    account: ACCOUNT,
    amount: "100",
    allowance: 100_000_000n,
  });
  assert.equal(enough.needsApprove, false);

  const unknownAllowance = buildMorphoDepositPlan({ vault: VAULT, account: ACCOUNT, amount: "1", allowance: undefined });
  assert.equal(unknownAllowance.needsApprove, true);
});

test("withdraw takes SHARES at 18 decimals, not the asset's 6", () => {
  const plan = buildMorphoWithdrawPlan({ vault: VAULT, account: ACCOUNT, amount: "0.5" });
  assert.equal(plan.shares, 500_000_000_000_000_000n);
  assert.throws(
    () => buildMorphoWithdrawPlan({ vault: VAULT, account: ACCOUNT, amount: "1.1234567890123456789" }),
    (error: unknown) => error instanceof MorphoLiveError && error.code === "invalid_amount",
  );
});

test("unknown vaults and bad accounts fail closed", () => {
  assert.throws(
    () => buildMorphoDepositPlan({ vault: "0xdead", account: ACCOUNT, amount: "1", allowance: 0n }),
    (error: unknown) => error instanceof MorphoLiveError && error.code === "unknown_vault",
  );
  assert.throws(
    () => buildMorphoDepositPlan({ vault: VAULT, account: "nope", amount: "1", allowance: 0n }),
    (error: unknown) => error instanceof MorphoLiveError && error.code === "invalid_account",
  );
  assert.throws(
    () => buildMorphoDepositPlan({ vault: VAULT, account: ACCOUNT, amount: "1.0000001", allowance: 0n }),
    (error: unknown) => error instanceof MorphoLiveError && error.code === "invalid_amount",
  );
});

test("the curated vault is looked up case-insensitively", () => {
  assert.equal(findMorphoVault(VAULT.toLowerCase())?.name, "Gauntlet USDC Prime");
  assert.equal(findMorphoVault(VAULT)?.shareDecimals, 18);
  assert.equal(findMorphoVault("0xdead"), null);
});

test("fee copy never rounds a real fee down to zero", () => {
  assert.equal(feeBpsLabel(0), "0%");
  assert.equal(feeBpsLabel(500), "5%");
  assert.equal(feeBpsLabel(50), "0.5%");
  assert.equal(feeBpsLabel(1), "0.01%");
});
