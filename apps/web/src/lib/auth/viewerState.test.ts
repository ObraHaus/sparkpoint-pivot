import test from "node:test";
import assert from "node:assert/strict";

import { shortAccount, viewerState } from "./viewerState.ts";

const NEAR = "sparkpoint2026.near";
const EVM = "0x1234567890abcdef1234567890abcdef12345678";

test("a NEAR session with no wagmi account is signed in and shows NEAR", () => {
  const v = viewerState({
    evmConnected: false,
    evmAddress: undefined,
    evmChainName: "Unsupported network",
    session: { address: NEAR, chain: "near" },
  });

  assert.equal(v.nearSignedIn, true);
  assert.equal(v.signedIn, true);
  assert.equal(v.unconnected, false);
  assert.equal(v.evmConnected, false); // EVM-only actions must still require a wallet
  assert.equal(v.nearAccount, NEAR);
  assert.equal(v.networkLabel, "NEAR"); // NOT "Unsupported network"
  assert.notEqual(v.walletLabel, "Not connected");
});

test("a connected EVM wallet keeps the EVM chain and account labels", () => {
  const v = viewerState({
    evmConnected: true,
    evmAddress: EVM,
    evmChainName: "Base Sepolia",
    session: { address: NEAR, chain: "near" },
  });

  assert.equal(v.evmConnected, true);
  assert.equal(v.nearSignedIn, false);
  assert.equal(v.networkLabel, "Base Sepolia");
  assert.equal(v.walletLabel, shortAccount(EVM));
});

test("a signed-out browser is the only mock-preview state", () => {
  const v = viewerState({
    evmConnected: false,
    evmAddress: undefined,
    evmChainName: "Unsupported network",
    session: null,
  });

  assert.equal(v.nearSignedIn, false);
  assert.equal(v.unconnected, true);
  assert.equal(v.walletLabel, "Not connected");
});
