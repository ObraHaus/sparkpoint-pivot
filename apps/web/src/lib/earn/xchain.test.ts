import test from "node:test";
import assert from "node:assert/strict";

import type { EarnQuoteBlock, EarnXchainTransferPlan } from "@sparkpoint/shared/schemas";

import {
  gateAllowsLive,
  originLabel,
  parseXchainFlag,
  planIsOfferable,
  serverXchainEnabled,
  transferPlanLine,
  xchainReviewHref,
  xchainReviewLines,
} from "./xchain.ts";

function plan(overrides: Partial<EarnXchainTransferPlan> = {}): EarnXchainTransferPlan {
  return {
    kind: "erc20_transfer",
    unsigned: true,
    chain: "base",
    chainId: 8453,
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    to: "0x" + "ab".repeat(20),
    amount: "100",
    amountRaw: "100000000",
    symbol: "USDC",
    functionSignature: "transfer(address,uint256)",
    calldata: "0xa9059cbb",
    note: "unsigned",
    ...overrides,
  };
}

function block(overrides: Partial<EarnQuoteBlock> = {}): EarnQuoteBlock {
  return {
    type: "earn_quote",
    state: "preview",
    rail: "oneclick_rhea",
    vault: {
      chain: "near",
      chainId: 0,
      address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      version: "lending",
      name: "Rhea Lending USDC",
      symbol: "USDC",
      asset: {
        address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        symbol: "USDC",
        decimals: 6,
      },
      listed: true,
      tvlUsd: "12733763",
      netApy: "14.05",
      source: "rhea_rpc",
      fetchedAt: "2026-11-01T00:00:00+00:00",
      curatedDefault: false,
      rails: {
        available: ["oneclick_rhea"],
        direct: { available: false, reason: "The beta has no NEAR wallet." },
        oneclickRhea: { available: true, note: "1Click -> Rhea" },
        intentsConnect: { available: false, reason: "Does not apply." },
      },
    },
    origin: {
      key: "base:USDC",
      chain: "base",
      chainLabel: "Base",
      symbol: "USDC",
      amount: "100",
      assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      evmChainId: 8453,
    },
    amountIn: "100",
    protocol: "rhea",
    firstDeposit: true,
    mca: null,
    recipient: "multica.near",
    ...overrides,
  };
}

test("the xchain flag is off unless exactly true", () => {
  assert.equal(parseXchainFlag(undefined), false);
  assert.equal(parseXchainFlag(""), false);
  assert.equal(parseXchainFlag("false"), false);
  assert.equal(parseXchainFlag("1"), false);
  assert.equal(parseXchainFlag("yes"), false);
  assert.equal(parseXchainFlag("true"), true);
  assert.equal(parseXchainFlag(" TRUE "), true);
});

test("the server gate accepts either the server or public flag", () => {
  assert.equal(serverXchainEnabled({}), false);
  assert.equal(serverXchainEnabled({ EARN_LIVE_RHEA_XCHAIN: "true" }), true);
  assert.equal(serverXchainEnabled({ NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN: "true" }), true);
  assert.equal(
    serverXchainEnabled({
      EARN_LIVE_RHEA_XCHAIN: "false",
      NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN: "TRUE",
    }),
    true,
  );
});

test("live is allowed only with server flag AND key presence", () => {
  assert.equal(gateAllowsLive(null), false);
  assert.equal(gateAllowsLive({ serverEnabled: true, keyPresent: false, liveAllowed: false }), false);
  assert.equal(gateAllowsLive({ serverEnabled: false, keyPresent: true, liveAllowed: false }), false);
  assert.equal(gateAllowsLive({ serverEnabled: true, keyPresent: true, liveAllowed: true }), true);
});

test("the review link carries only the values it has", () => {
  assert.equal(xchainReviewHref(), "/vault/rhea-xchain");
  assert.equal(
    xchainReviewHref({
      chain: "near",
      origin: "base:USDC",
      vault: "1720",
      amount: "100",
    }),
    "/vault/rhea-xchain?chain=near&origin=base%3AUSDC&vault=1720&amount=100",
  );
});

test("origin labels are friendly but never invented for unknown keys", () => {
  assert.equal(originLabel("base:USDC"), "Base USDC");
  assert.equal(originLabel("eth:USDC"), "Ethereum USDC");
  assert.equal(originLabel("unknown:FOO"), "unknown:FOO");
  assert.equal(originLabel(null), "—");
});

test("review lines show origin, refund, recipient and fees", () => {
  const lines = xchainReviewLines(
    block({
      oneTimeFee: { amount: "0.30", symbol: "USDC", reason: "first deposit only" },
      netSupplied: "99.68",
    }),
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  );
  const byKey = Object.fromEntries(lines.map((line) => [line.key, line.value]));
  assert.equal(byKey.origin, "100 USDC on Base");
  assert.equal(byKey.refund, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  assert.equal(byKey.recipient, "multica.near");
  assert.equal(byKey.net, "≈ 99.68 USDC");
  assert.match(byKey.fee, /0\.30 USDC/);
});

test("only a real unsigned ERC-20 plan is offerable to the wallet", () => {
  assert.equal(planIsOfferable(plan()), true);
  assert.equal(planIsOfferable(plan({ kind: "unsupported", calldata: null })), false);
  assert.equal(planIsOfferable(plan({ calldata: "not-hex" })), false);
  assert.equal(planIsOfferable(null), false);
});

test("the transfer plan summary is explicit about being unsigned", () => {
  assert.match(transferPlanLine(plan()), /unsigned/);
  assert.match(
    transferPlanLine(plan({ kind: "unsupported", note: "This origin is not an EVM chain." })),
    /not an EVM chain/,
  );
  assert.equal(transferPlanLine(null), "No transfer plan yet.");
});
