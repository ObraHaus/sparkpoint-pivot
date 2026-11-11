import test from "node:test";
import assert from "node:assert/strict";

import {
  RHEA_LIVE_ENV_NAMES,
  RHEA_LIVE_MARKET,
  amountAfterActionChange,
  confirmBlocker,
  confirmBlockerCopy,
  formatNearYocto,
  parseLiveFlag,
  publicLiveRheaEnabled,
  reviewLines,
  serverLiveRheaEnabled,
  type PreflightReview,
} from "./liveEarn.ts";
import { USDC_TOKEN_ID } from "./burrow.ts";

const review: PreflightReview = {
  action: "supply",
  accountId: "sparkpoint2026.near",
  amount: "25",
  amountRaw: "25000000",
  tokenBalance: "100",
  nearBalance: "1.5",
  nearRequired: "0.02",
  supplied: null,
  storage: { registersBurrowAccount: false, registersTokenReceiver: false, totalNear: "0" },
  contract: "contract.main.burrow.near",
  token: USDC_TOKEN_ID,
  blockHeight: 223_700_000,
  blockHash: "TestBlockHash111111111111111111111111111",
  checkedAtMs: 1_000,
};

test("both live flags are off unless exactly true", () => {
  assert.equal(parseLiveFlag(undefined), false);
  assert.equal(parseLiveFlag(""), false);
  assert.equal(parseLiveFlag("1"), false);
  assert.equal(parseLiveFlag("yes"), false);
  assert.equal(parseLiveFlag("true"), true);
  assert.equal(parseLiveFlag(" TRUE "), true);
  assert.deepEqual([...RHEA_LIVE_ENV_NAMES], ["EARN_LIVE_RHEA", "NEXT_PUBLIC_EARN_LIVE_RHEA"]);
});

test("public and server switches read their own env names", () => {
  const previousPublic = process.env.NEXT_PUBLIC_EARN_LIVE_RHEA;
  const previousServer = process.env.EARN_LIVE_RHEA;
  try {
    delete process.env.NEXT_PUBLIC_EARN_LIVE_RHEA;
    delete process.env.EARN_LIVE_RHEA;
    assert.equal(publicLiveRheaEnabled(), false);
    assert.equal(serverLiveRheaEnabled(), false);
    process.env.NEXT_PUBLIC_EARN_LIVE_RHEA = "true";
    assert.equal(publicLiveRheaEnabled(), true);
    assert.equal(serverLiveRheaEnabled(), false);
    process.env.EARN_LIVE_RHEA = "true";
    assert.equal(serverLiveRheaEnabled(), true);
    process.env.EARN_LIVE_RHEA = "false";
    assert.equal(serverLiveRheaEnabled(), false);
  } finally {
    if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_EARN_LIVE_RHEA;
    else process.env.NEXT_PUBLIC_EARN_LIVE_RHEA = previousPublic;
    if (previousServer === undefined) delete process.env.EARN_LIVE_RHEA;
    else process.env.EARN_LIVE_RHEA = previousServer;
  }
});

test("the market pins the same-chain contract/token and names the deferred path", () => {
  assert.equal(RHEA_LIVE_MARKET.protocol, "rhea");
  assert.equal(RHEA_LIVE_MARKET.chain, "near");
  assert.equal(RHEA_LIVE_MARKET.contract, "contract.main.burrow.near");
  assert.equal(RHEA_LIVE_MARKET.token, USDC_TOKEN_ID);
  assert.equal(RHEA_LIVE_MARKET.appUrl, "https://app.rhea.finance/lending");
});

test("confirm is blocked until acknowledged, fresh and on the expected account", () => {
  const base = {
    acknowledged: true,
    checkedAtMs: 1_000,
    expectedAccountId: "sparkpoint2026.near",
    currentAccountId: "sparkpoint2026.near",
    nowMs: 2_000,
  };
  assert.equal(confirmBlocker(base), null);
  assert.equal(confirmBlocker({ ...base, acknowledged: false }), "not_acknowledged");
  assert.equal(confirmBlocker({ ...base, nowMs: 1_000 + 61_000 }), "stale_plan");
  assert.equal(confirmBlocker({ ...base, currentAccountId: "other.near" }), "wallet_switch");
  assert.equal(confirmBlocker({ ...base, currentAccountId: null }), "wallet_switch");
  assert.equal(confirmBlocker({ ...base, expectedAccountId: "" }), "no_account");
  assert.match(confirmBlockerCopy("wallet_switch"), /account changed/i);
  assert.match(confirmBlockerCopy("stale_plan"), /60 seconds/i);
  assert.match(confirmBlockerCopy("not_acknowledged"), /Tick the confirmation/i);
  assert.match(confirmBlockerCopy("no_account"), /Connect the NEAR wallet/i);
});

test("review lines show the signer, contract, token, balances and freshness", () => {
  const lines = reviewLines(review);
  const byKey = Object.fromEntries(lines.map((line) => [line.key, line.value]));
  assert.equal(byKey.account, "sparkpoint2026.near");
  assert.equal(byKey.amount, "25 USDC");
  assert.equal(byKey.contract, "contract.main.burrow.near");
  assert.equal(byKey.token, USDC_TOKEN_ID);
  assert.match(byKey["token-balance"], /100 USDC/);
  assert.match(byKey["near-balance"], /1\.5 NEAR/);
  assert.match(byKey.freshness, /223700000/);
  assert.equal(byKey.storage, undefined);
  assert.equal(byKey.supplied, undefined);
});

test("switching Supply and Withdraw clears the other tab's amount", () => {
  assert.equal(amountAfterActionChange("supply", "withdraw", "0.05"), "");
  assert.equal(amountAfterActionChange("withdraw", "supply", "10"), "");
  assert.equal(amountAfterActionChange("supply", "supply", "25"), "25");
});

test("withdraw review reads as money received, never a negative debit", () => {
  const lines = reviewLines({ ...review, action: "withdraw", amount: "-0.05", supplied: "0.05" });
  const byKey = Object.fromEntries(lines.map((line) => [line.key, line.value]));
  assert.equal(byKey.amount, "0.05 USDC to your wallet");
  assert.doesNotMatch(byKey.amount, /^-/);
  assert.match(byKey.amount, /to your wallet/);
  const supply = reviewLines({ ...review, action: "supply", amount: "-0.05" });
  const supplyByKey = Object.fromEntries(supply.map((line) => [line.key, line.value]));
  assert.equal(supplyByKey.amount, "0.05 USDC");
});

test("withdraw review adds the supplied balance and storage notice when applicable", () => {
  const lines = reviewLines({
    ...review,
    action: "withdraw",
    supplied: "40",
    storage: { registersBurrowAccount: true, registersTokenReceiver: true, totalNear: "0.10125" },
  });
  const byKey = Object.fromEntries(lines.map((line) => [line.key, line.value]));
  assert.equal(byKey.supplied, "40 USDC");
  assert.match(byKey.storage, /0\.10125 NEAR/);
  assert.match(byKey.storage, /registers your Burrow account/);
});

test("yoctoNEAR formats for the review without inventing precision", () => {
  assert.equal(formatNearYocto(20_000_000_000_000_000_000_000n), "0.02");
  assert.equal(formatNearYocto("101250000000000000000000"), "0.10125");
  assert.equal(formatNearYocto(1_000_000_000_000_000_000_000_000n), "1");
});
