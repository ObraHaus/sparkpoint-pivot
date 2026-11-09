import test from "node:test";
import assert from "node:assert/strict";

import {
  BURROW_CONTRACT,
  BURROW_STORAGE_MIN_YOCTO,
  FT_TRANSFER_CALL_GAS,
  MAX_SUPPLY_UNITS,
  NEAR_GAS_RESERVE_YOCTO,
  TOKEN_STORAGE_MIN_YOCTO,
  USDC_DECIMALS,
  USDC_TOKEN_ID,
  buildSupplyPlan,
  buildWithdrawPlan,
  checkSupplyBalances,
  checkWithdrawBalances,
  classifyReceipt,
  firstTransactionHash,
  formatUsdc,
  fromBurrowInnerUnits,
  functionCall,
  isAllowedAsset,
  isAllowedContract,
  parseUsdcAmount,
  planIsFresh,
  refusedWalletSwitch,
  toBurrowInnerUnits,
} from "./burrow.ts";

const ACCOUNT = "sparkpoint2026.near";

test("pinned IDs verified live: Burrow contract and native USDC", () => {
  assert.equal(BURROW_CONTRACT, "contract.main.burrow.near");
  // Official public NEAR native USDC NEP-141 mainnet contract id — pinned here on purpose.
  assert.equal(USDC_TOKEN_ID, "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"); // gitleaks:allow (public USDC NEP-141 contract id, not a secret)
  assert.equal(USDC_DECIMALS, 6);
  assert.equal(isAllowedContract(BURROW_CONTRACT), true);
  assert.equal(isAllowedContract(USDC_TOKEN_ID), true);
  assert.equal(isAllowedContract("wrap.near"), false);
  assert.equal(isAllowedAsset(USDC_TOKEN_ID), true);
  assert.equal(isAllowedAsset("usdt.tether-token.near"), false);
});

test("functionCall refuses an unknown contract and preserves exact gas/deposit", () => {
  assert.throws(() => functionCall("evil.near", "execute", {}, "1", 0n), /non-allowlisted/);
  const call = functionCall(BURROW_CONTRACT, "execute", {}, "100000000000000", 1n);
  assert.deepEqual(call.params, {
    methodName: "execute",
    args: {},
    gas: "100000000000000",
    deposit: "1",
  });
});

test("parseUsdcAmount is exact and refuses over-precision instead of rounding", () => {
  assert.deepEqual(parseUsdcAmount("25"), { ok: true, raw: 25_000_000n, human: "25" });
  assert.deepEqual(parseUsdcAmount("12.5"), { ok: true, raw: 12_500_000n, human: "12.5" });
  assert.deepEqual(parseUsdcAmount("0.010000"), { ok: true, raw: 10_000n, human: "0.01" });
  assert.deepEqual(parseUsdcAmount("1.2345678"), { ok: false, error: "too_precise" });
  assert.deepEqual(parseUsdcAmount(""), { ok: false, error: "empty" });
  assert.deepEqual(parseUsdcAmount("-1"), { ok: false, error: "not_numeric" });
  assert.deepEqual(parseUsdcAmount("1,000"), { ok: false, error: "not_numeric" });
  assert.deepEqual(parseUsdcAmount("0.001"), { ok: false, error: "below_minimum" });
  assert.deepEqual(parseUsdcAmount("1000000.000001"), { ok: false, error: "above_maximum" });
  assert.deepEqual(parseUsdcAmount("0", "withdraw"), { ok: false, error: "below_minimum" });
});

test("formatUsdc and Burrow inner-unit conversion are exact", () => {
  assert.equal(formatUsdc(0n), "0");
  assert.equal(formatUsdc(1n), "0.000001");
  assert.equal(formatUsdc(12_500_000n), "12.5");
  assert.equal(formatUsdc(MAX_SUPPLY_UNITS), "1000000");
  assert.equal(toBurrowInnerUnits(1_000_000n), 1_000_000_000_000_000_000n);
  assert.equal(fromBurrowInnerUnits(1_000_000_000_000_000_000n), 1_000_000n);
});

test("supply without pending registration is one exact ft_transfer_call", () => {
  const plan = buildSupplyPlan({
    accountId: ACCOUNT,
    amount6: 25_000_000n,
    storage: { burrowRegistered: true, tokenReceiverRegistered: true },
  });
  assert.equal(plan.transactions.length, 1);
  assert.equal(plan.transactions[0].receiverId, ACCOUNT);
  assert.equal(plan.transactions[0].actions.length, 1);
  assert.deepEqual(plan.transactions[0].actions[0], {
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer_call",
      args: { receiver_id: BURROW_CONTRACT, amount: "25000000", msg: "" },
      gas: FT_TRANSFER_CALL_GAS,
      deposit: "1",
    },
  });
  assert.equal(plan.storage.totalYocto, 0n);
  assert.equal(plan.nearRequiredYocto, NEAR_GAS_RESERVE_YOCTO);
});

test("supply adds exact storage_deposit actions only when registration is missing", () => {
  const plan = buildSupplyPlan({
    accountId: ACCOUNT,
    amount6: 10_000n,
    storage: { burrowRegistered: false, tokenReceiverRegistered: false },
  });
  const actions = plan.transactions[0].actions;
  assert.equal(actions.length, 3);
  assert.equal(actions[0].params.methodName, "storage_deposit");
  assert.deepEqual(actions[0].params.args, {});
  assert.equal(actions[0].params.deposit, BURROW_STORAGE_MIN_YOCTO.toString());
  assert.equal(actions[1].params.methodName, "storage_deposit");
  assert.deepEqual(actions[1].params.args, { account_id: BURROW_CONTRACT, registration_only: true });
  assert.equal(actions[1].params.deposit, TOKEN_STORAGE_MIN_YOCTO.toString());
  assert.equal(actions[2].params.methodName, "ft_transfer_call");
  assert.equal(plan.storage.registersBurrowAccount, true);
  assert.equal(plan.storage.registersTokenReceiver, true);
  assert.equal(plan.storage.totalYocto, BURROW_STORAGE_MIN_YOCTO + TOKEN_STORAGE_MIN_YOCTO);
  assert.equal(plan.nearRequiredYocto, BURROW_STORAGE_MIN_YOCTO + TOKEN_STORAGE_MIN_YOCTO + NEAR_GAS_RESERVE_YOCTO);
});

test("supply refuses invalid accounts, sub-minimum and over-maximum amounts", () => {
  const base = { storage: { burrowRegistered: true, tokenReceiverRegistered: true } } as const;
  assert.throws(() => buildSupplyPlan({ ...base, accountId: "Not Valid!", amount6: 10_000n }), /account id/);
  assert.throws(() => buildSupplyPlan({ ...base, accountId: ACCOUNT, amount6: 9_999n }), /Minimum supply/);
  assert.throws(
    () => buildSupplyPlan({ ...base, accountId: ACCOUNT, amount6: MAX_SUPPLY_UNITS + 1n }),
    /Maximum supply/,
  );
});

test("balance checks name the exact failure", () => {
  assert.equal(
    checkSupplyBalances({
      tokenBalance6: 1n,
      nearBalanceYocto: 10n ** 24n,
      nearRequiredYocto: NEAR_GAS_RESERVE_YOCTO,
      amount6: 25_000_000n,
    }),
    "insufficient_token_balance",
  );
  assert.equal(
    checkSupplyBalances({
      tokenBalance6: 25_000_000n,
      nearBalanceYocto: 1n,
      nearRequiredYocto: NEAR_GAS_RESERVE_YOCTO,
      amount6: 25_000_000n,
    }),
    "insufficient_near_for_gas_storage",
  );
  assert.equal(
    checkSupplyBalances({
      tokenBalance6: 25_000_000n,
      nearBalanceYocto: NEAR_GAS_RESERVE_YOCTO,
      nearRequiredYocto: NEAR_GAS_RESERVE_YOCTO,
      amount6: 25_000_000n,
    }),
    null,
  );
});

test("withdraw builds Burrow execute Withdraw with token_id and 18-dp max_amount", () => {
  const plan = buildWithdrawPlan({
    accountId: ACCOUNT,
    amount6: 12_500_000n,
    suppliedInnerUnits: 20_000_000_000_000_000_000n,
    canWithdraw: true,
  });
  assert.equal(plan.transactions[0].receiverId, ACCOUNT);
  const action = plan.transactions[0].actions[0];
  assert.equal(action.params.methodName, "execute");
  assert.equal(action.params.gas, "100000000000000");
  assert.equal(action.params.deposit, "1");
  assert.deepEqual(action.params.args, {
    actions: [{ Withdraw: { token_id: USDC_TOKEN_ID, max_amount: "12500000000000000000" } }],
  });
  assert.equal(plan.nearRequiredYocto, NEAR_GAS_RESERVE_YOCTO);
});

test("withdraw Max uses the exact supplied inner balance, not a floored 6-dp value", () => {
  const supplied = 12_500_000_999_999_999_999n;
  const plan = buildWithdrawPlan({
    accountId: ACCOUNT,
    amount6: 12_500_000n,
    suppliedInnerUnits: supplied,
    canWithdraw: true,
    maxAmountInnerUnits: supplied,
  });
  const args = plan.transactions[0].actions[0].params.args as {
    actions: Array<{ Withdraw: { max_amount: string } }>;
  };
  assert.equal(args.actions[0].Withdraw.max_amount, supplied.toString());
});

test("withdraw refuses when disabled, over supplied, or invalid", () => {
  assert.throws(
    () =>
      buildWithdrawPlan({
        accountId: ACCOUNT,
        amount6: 1_000_000n,
        suppliedInnerUnits: 10n ** 30n,
        canWithdraw: false,
      }),
    /disabled withdrawals/,
  );
  assert.throws(
    () =>
      buildWithdrawPlan({
        accountId: ACCOUNT,
        amount6: 2_000_000n,
        suppliedInnerUnits: 1_000_000n,
        canWithdraw: true,
      }),
    /more than your supplied/,
  );
  assert.equal(
    checkWithdrawBalances({
      nearBalanceYocto: 10n ** 24n,
      nearRequiredYocto: NEAR_GAS_RESERVE_YOCTO,
      suppliedInnerUnits: 1_000_000n,
      requested6: 2_000_000n,
    }),
    "insufficient_supplied",
  );
});

test("freshness and wallet-switch guards are exact", () => {
  assert.equal(planIsFresh(1_000, 1_000), true);
  assert.equal(planIsFresh(1_000, 61_000), true);
  assert.equal(planIsFresh(1_000, 61_001), false);
  assert.equal(planIsFresh(2_000, 1_000), false);
  assert.equal(refusedWalletSwitch("a.near", "a.near"), false);
  assert.equal(refusedWalletSwitch("a.near", "b.near"), true);
  assert.equal(refusedWalletSwitch("a.near", null), true);
});

test("receipt classification never fakes success", () => {
  assert.deepEqual(classifyReceipt({ status: { SuccessValue: "" }, final_execution_status: "FINAL" }), {
    status: "confirmed",
    error: null,
  });
  assert.deepEqual(classifyReceipt({ status: { SuccessValue: "" }, final_execution_status: "EXECUTED_OPTIMISTIC" }), {
    status: "pending",
    error: null,
  });
  const failed = classifyReceipt({
    status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: "boom" } } } },
    final_execution_status: "FINAL",
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /ActionError/);
  assert.deepEqual(classifyReceipt(undefined), { status: "pending", error: null });
  assert.deepEqual(classifyReceipt({ final_execution_status: "FINAL" }), {
    status: "failed",
    error: "The transaction finalized without a success value.",
  });
  assert.equal(firstTransactionHash([{ transaction: { hash: "abc" } }]), "abc");
  assert.equal(firstTransactionHash([{ transaction_outcome: { id: "def" } }]), "def");
  assert.equal(firstTransactionHash([]), null);
});
