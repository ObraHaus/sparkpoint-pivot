import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNearDepositTransaction,
  canSendFromWallet,
  humanToBaseUnits,
  nearFtContractId,
} from "./walletSend.ts";

test("wallet-send is offered only for an EVM origin this build registered", () => {
  assert.equal(canSendFromWallet(4663, [4663]), true);
  assert.equal(canSendFromWallet(8453, [8453, 84532, 46330]), true);
  assert.equal(canSendFromWallet(1, [8453, 84532, 46330]), false);
  assert.equal(canSendFromWallet(null, [4663]), false);
  assert.equal(canSendFromWallet(undefined, [4663]), false);
});

test("human amounts convert to exact base units (commas and short fractions too)", () => {
  assert.equal(humanToBaseUnits("5000", 6), 5_000_000_000n);
  assert.equal(humanToBaseUnits("5,000.50", 6), 5_000_500_000n);
  assert.equal(humanToBaseUnits("0.000001", 6), 1n);
  assert.equal(humanToBaseUnits("1", 0), 1n);
});

test("an over-precise, zero or malformed amount is refused, never rounded", () => {
  assert.equal(humanToBaseUnits("0.0000001", 6), null);
  assert.equal(humanToBaseUnits("0", 6), null);
  assert.equal(humanToBaseUnits("-5", 6), null);
  assert.equal(humanToBaseUnits("1e6", 6), null);
  assert.equal(humanToBaseUnits("", 6), null);
});

const NEAR_WRAP = {
  chain: "near",
  symbol: "NEAR",
  assetId: "nep141:wrap.near",
};

const NEAR_FT = {
  chain: "near",
  symbol: "USDC",
  assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};

test("a wrap.near deposit wraps the exact amount then ft_transfers it to the deposit address", () => {
  const tx = buildNearDepositTransaction({
    depositAddress: "deposit.near",
    amountBaseUnits: 12_340_000_000_000_000_000_000_000n,
    asset: NEAR_WRAP,
  });
  assert.ok(tx);
  assert.equal(tx.receiverId, "wrap.near");
  assert.equal(tx.actions.length, 2);
  const wrap = tx.actions[0]!;
  const send = tx.actions[1]!;
  assert.equal(wrap.type, "FunctionCall");
  assert.equal(send.type, "FunctionCall");
  if (wrap.type !== "FunctionCall" || send.type !== "FunctionCall") return;
  assert.equal(wrap.params.methodName, "near_deposit");
  assert.equal(wrap.params.deposit, "12340000000000000000000000");
  assert.equal(send.params.methodName, "ft_transfer");
  assert.equal(send.params.args.receiver_id, "deposit.near");
  assert.equal(send.params.args.amount, "12340000000000000000000000");
  assert.equal(send.params.deposit, "1");
});

test("a NEAR FT deposit is an ft_transfer to the deposit address with 1 yoctoNEAR attached", () => {
  const tx = buildNearDepositTransaction({
    depositAddress: "deposit.near",
    amountBaseUnits: 5_000_000n,
    asset: NEAR_FT,
  });
  assert.ok(tx);
  assert.equal(tx.receiverId, NEAR_FT.assetId.slice("nep141:".length));
  assert.equal(tx.actions.length, 1);
  const action = tx.actions[0]!;
  assert.equal(action.type, "FunctionCall");
  if (action.type !== "FunctionCall") return;
  assert.equal(action.params.methodName, "ft_transfer");
  assert.equal(action.params.args.receiver_id, "deposit.near");
  assert.equal(action.params.args.amount, "5000000");
  assert.equal(action.params.deposit, "1");
});

test("a NEAR deposit is refused for an invalid address, zero amount or unusable asset — never guessed", () => {
  assert.equal(
    buildNearDepositTransaction({ depositAddress: "not a near id!", amountBaseUnits: 1n, asset: NEAR_WRAP }),
    null,
  );
  assert.equal(
    buildNearDepositTransaction({ depositAddress: "deposit.near", amountBaseUnits: 0n, asset: NEAR_WRAP }),
    null,
  );
  assert.equal(
    buildNearDepositTransaction({
      depositAddress: "deposit.near",
      amountBaseUnits: 1n,
      asset: { chain: "near", symbol: "X", assetId: "not-a-nep141-id" },
    }),
    null,
  );
});

test("the NEP-141 contract is extracted only from a valid nep141 asset id", () => {
  assert.equal(nearFtContractId("nep141:wrap.near"), "wrap.near");
  assert.equal(nearFtContractId("nep141:not an id"), null);
  assert.equal(nearFtContractId("wrap.near"), null);
  assert.equal(nearFtContractId(""), null);
});
