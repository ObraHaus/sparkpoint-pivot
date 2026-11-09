import test from "node:test";
import assert from "node:assert/strict";

import type { VersionedTransaction } from "@solana/web3.js";

import {
  SolanaWalletError,
  connectSolanaWallet,
  getInjectedSolanaProvider,
  solanaWalletErrorMessage,
  submitSolanaTransaction,
  type SolanaInjectedProvider,
} from "./wallet.ts";

const ADDRESS = "J9EH8VmiXd58kuhhUCbED6Pm1dZU9fFQELhVE9UyMEKz";

function mockProvider(log: string[]): SolanaInjectedProvider {
  return {
    isPhantom: true,
    publicKey: { toBase58: () => ADDRESS },
    connect: async () => {
      log.push("connect");
      return { publicKey: { toBase58: () => ADDRESS } };
    },
    signAndSendTransaction: async () => {
      log.push("signAndSendTransaction");
      return { signature: "5" + "x".repeat(87) };
    },
  };
}

test("connecting never signs or sends", async () => {
  const log: string[] = [];
  const address = await connectSolanaWallet(mockProvider(log));
  assert.equal(address, ADDRESS);
  assert.deepEqual(log, ["connect"]);
});

test("the explicit submit hands the unsigned tx to the wallet exactly once", async () => {
  const log: string[] = [];
  const provider = mockProvider(log);
  const signature = await submitSolanaTransaction(provider, {} as VersionedTransaction);
  assert.match(signature, /^5x+/);
  assert.deepEqual(log, ["signAndSendTransaction"]);
});

test("a wallet that returns no signature is an error, not a silent success", async () => {
  const provider: SolanaInjectedProvider = {
    connect: async () => ({}),
    signAndSendTransaction: async () => ({ signature: "" }),
  };
  await assert.rejects(
    () => submitSolanaTransaction(provider, {} as VersionedTransaction),
    (error: unknown) => error instanceof SolanaWalletError,
  );
});

test("provider discovery is a no-op on the server and prefers Phantom in the browser", () => {
  assert.equal(getInjectedSolanaProvider(), null);
  const phantom = mockProvider([]);
  const generic = mockProvider([]);
  (globalThis as unknown as { window: unknown }).window = { phantom: { solana: phantom }, solana: generic };
  try {
    assert.equal(getInjectedSolanaProvider(), phantom);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("cancellation is reported as cancellation, never as a sent transaction", () => {
  assert.match(solanaWalletErrorMessage(new Error("User rejected the request")), /cancelled/i);
  assert.match(solanaWalletErrorMessage(new Error("boom")), /boom/);
});
