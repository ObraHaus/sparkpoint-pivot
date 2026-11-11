import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_CHAIN_ID, resolveAgentConnection, resolveAgentIdentity, resolveChainId } from "./identity.ts";

test("NaN — the value that actually shipped — never reaches the wire", () => {
  // The Aug-3 regression: wagmi reported NaN mid-reconnect, `?? DEFAULT` did not catch it, and
  // `x-chain-id: NaN` went out on 7/7 requests.
  assert.equal(resolveChainId(NaN), DEFAULT_CHAIN_ID);
  assert.equal(resolveChainId(Number("not-a-chain")), DEFAULT_CHAIN_ID);
});

test("absent / empty values fall back", () => {
  for (const v of [undefined, null, "", 0, -1]) {
    assert.equal(resolveChainId(v), DEFAULT_CHAIN_ID, String(v));
  }
});

test("non-integer and non-finite values fall back", () => {
  for (const v of [1.5, Infinity, -Infinity]) {
    assert.equal(resolveChainId(v), DEFAULT_CHAIN_ID, String(v));
  }
});

test("supported chains pass through untouched", () => {
  assert.equal(resolveChainId(8453), 8453); // Base
  assert.equal(resolveChainId(84532), 84532); // Base Sepolia
});

test("a numeric string is coerced, not rejected", () => {
  assert.equal(resolveChainId("84532"), 84532);
});

test("an unsupported network falls back rather than being asserted to the agent", () => {
  assert.equal(resolveChainId(1), DEFAULT_CHAIN_ID); // Ethereum mainnet is not a chat chain
  assert.equal(resolveChainId(999999), DEFAULT_CHAIN_ID);
});

test("an explicit fallback is honoured", () => {
  assert.equal(resolveChainId(NaN, 84532), 84532);
});

test("the result is ALWAYS a finite positive integer", () => {
  for (const v of [NaN, undefined, "x", {}, [], Infinity, 84532, "8453"]) {
    const out = resolveChainId(v);
    assert.ok(Number.isInteger(out) && out > 0, `${String(v)} → ${out}`);
    assert.ok(!String(out).includes("NaN"));
  }
});

test("the default is a chain SparkPoint actually operates on, not a hardcoded id", async () => {
  // Regression: the default was `8453` (Base mainnet), where CHAIN_META says offersVault:false
  // and switchable:false — audit-gated. While the NaN bug was live the fallback never fired, so
  // nobody noticed; the moment the guard worked, every read asserted a chain with no deployment
  // and the agent 503'd all of them. The default must therefore come from the chain metadata.
  const { CHAIN_META } = await import("@sparkpoint/shared/chains");
  const meta = CHAIN_META[DEFAULT_CHAIN_ID];
  assert.ok(meta, `DEFAULT_CHAIN_ID ${DEFAULT_CHAIN_ID} must be a known chain`);
  assert.equal(meta.offersVault, true, "a default read chain must have a vault deployed");
  assert.equal(meta.switchable, true, "…and be one a user can actually be on");
});

test("a chain the user is genuinely on is passed through, even a gated one", () => {
  // Honesty cuts both ways: if the wallet really is on Base mainnet, say so and let the agent
  // and the network gate respond. Only the FALLBACK was ever wrong.
  assert.equal(resolveChainId(8453), 8453);
});

test("a server-verified NEAR session resolves an online agent identity", () => {
  // No wagmi account (Meteor Mobile). The BFF derives the same owner from the verified session;
  // the client must still be non-null so the chat is live, not "Demo mode".
  const id = resolveAgentIdentity(undefined, undefined, {
    address: "sparkpoint2026.near",
    chain: "near",
  });
  assert.deepEqual(id, {
    account: "sparkpoint2026.near",
    owner: "sparkpoint2026.near",
    chainId: DEFAULT_CHAIN_ID,
    authChain: "near",
  });
});

test("a signed-out browser still has no agent identity", () => {
  assert.equal(resolveAgentIdentity(undefined, 84532, null), null);
  assert.equal(resolveAgentIdentity(undefined, 84532, { address: "0xabc", chain: "evm" }), null);
});

test("a connected EVM wallet stays an EVM identity even with a NEAR session object", () => {
  const id = resolveAgentIdentity("0x1234567890abcdef1234567890abcdef12345678", 84532, {
    address: "sparkpoint2026.near",
    chain: "near",
  });
  assert.deepEqual(id, {
    account: "0x1234567890abcdef1234567890abcdef12345678",
    owner: "0x1234567890abcdef1234567890abcdef12345678",
    chainId: 84532,
    authChain: "evm",
  });
});

test("an in-flight session with no wallet is loading, not signed out (no demo/connect yet)", () => {
  const state = resolveAgentConnection(undefined, undefined, undefined);
  assert.equal(state.loading, true);
  assert.equal(state.identity, null);
});

test("a resolved null session with no wallet is signed out (demo/preview is honest)", () => {
  const state = resolveAgentConnection(undefined, 84532, null);
  assert.equal(state.loading, false);
  assert.equal(state.identity, null);
});

test("a resolved NEAR session is online with no demo, even without a wallet", () => {
  const state = resolveAgentConnection(undefined, undefined, {
    address: "sparkpoint2026.near",
    chain: "near",
  });
  assert.equal(state.loading, false);
  assert.equal(state.identity?.authChain, "near");
  assert.equal(state.identity?.account, "sparkpoint2026.near");
});

test("a connected EVM wallet is online and never loading, even mid session fetch", () => {
  const evm = "0x1234567890abcdef1234567890abcdef12345678";
  const state = resolveAgentConnection(evm, 84532, undefined);
  assert.equal(state.loading, false);
  assert.equal(state.identity?.account, evm);
  assert.equal(state.identity?.authChain, "evm");
});
