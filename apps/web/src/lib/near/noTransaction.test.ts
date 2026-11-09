import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNearWalletAdapter,
  type NearAccountStorage,
  type NearConnectorHandle,
  type NearSignedMessage,
  type NearWalletHandle,
  type NearWalletMock,
} from "./adapter.ts";

const ACCOUNT = {
  accountId: "sparkpoint2026.near",
  publicKey: "ed25519:93KzqfxDmbFtSs5FCRJJGJpTg1Qc8r6oCzHyebrbnwr1",
};

function memoryStorage(): NearAccountStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

interface CallLog {
  calls: string[];
}

function throwingWallet(log: CallLog): NearWalletHandle {
  return {
    getAccounts: async () => {
      log.calls.push("getAccounts");
      return [ACCOUNT];
    },
    signMessage: async () => {
      log.calls.push("signMessage");
      const signed: NearSignedMessage = {
        accountId: ACCOUNT.accountId,
        publicKey: ACCOUNT.publicKey,
        signature: "ed25519:mock-signature",
      };
      return signed;
    },
    signOut: async () => {
      log.calls.push("signOut");
    },
    // Present on a real wallet, but the adapter must never reach for them. If it ever does, the
    // test fails loudly instead of pretending a transaction was harmless.
    signAndSendTransaction: async () => {
      log.calls.push("signAndSendTransaction");
      throw new Error("signAndSendTransaction must never be called");
    },
    signTransaction: async () => {
      log.calls.push("signTransaction");
      throw new Error("signTransaction must never be called");
    },
  } as unknown as NearWalletHandle;
}

test("connect + signMessage never touch signAndSendTransaction or signTransaction", async () => {
  const log: CallLog = { calls: [] };
  const wallet = throwingWallet(log);
  const connector: NearConnectorHandle = {
    connect: async (input) => {
      log.calls.push(`connect:${input?.walletId ?? "picker"}`);
      return wallet;
    },
    disconnect: async () => {
      log.calls.push("disconnect");
    },
    getConnectedWallet: async () => ({ wallet, accounts: [ACCOUNT] }),
    wallet: async () => wallet,
  };
  const adapter = createNearWalletAdapter({
    network: "mainnet",
    storage: memoryStorage(),
    mock: null,
    connectorFactory: async () => connector,
  });

  assert.deepEqual(await adapter.connect(), ACCOUNT);
  const signed = await adapter.signMessage({
    message: "hello",
    recipient: "app.rhea.finance",
    nonce: new Uint8Array(32),
  });
  assert.equal(signed.signature, "ed25519:mock-signature");
  await adapter.disconnect();

  assert.deepEqual(log.calls, [
    "connect:meteor-wallet",
    "getAccounts",
    "signMessage",
    "disconnect",
  ]);
  assert.equal(log.calls.some((c) => /signAndSend|signTransaction/.test(c)), false);
});

test("Meteor is tried first and an unavailable wallet falls back to the picker", async () => {
  const log: CallLog = { calls: [] };
  const wallet = throwingWallet(log);
  const connector: NearConnectorHandle = {
    connect: async (input) => {
      log.calls.push(`connect:${input?.walletId ?? "picker"}`);
      if (input?.walletId === "meteor-wallet") throw new Error("Wallet not found");
      return wallet;
    },
    disconnect: async () => undefined,
    getConnectedWallet: async () => ({ wallet, accounts: [ACCOUNT] }),
    wallet: async () => wallet,
  };
  const adapter = createNearWalletAdapter({
    network: "mainnet",
    storage: memoryStorage(),
    mock: null,
    connectorFactory: async () => connector,
  });

  await adapter.connect();
  assert.deepEqual(log.calls, ["connect:meteor-wallet", "connect:picker", "getAccounts"]);
});

test("the injected e2e mock is the adapter and its throwing transaction methods stay unused", async () => {
  const log: CallLog = { calls: [] };
  const mock: NearWalletMock & { signAndSendTransaction: () => Promise<never> } = {
    connect: async () => {
      log.calls.push("connect");
      return ACCOUNT;
    },
    disconnect: async () => {
      log.calls.push("disconnect");
    },
    getAccount: async () => ACCOUNT,
    signMessage: async () => {
      log.calls.push("signMessage");
      return {
        accountId: ACCOUNT.accountId,
        publicKey: ACCOUNT.publicKey,
        signature: "ed25519:e2e-mock",
      };
    },
    signAndSendTransaction: async () => {
      log.calls.push("signAndSendTransaction");
      throw new Error("signAndSendTransaction must never be called");
    },
  };
  const adapter = createNearWalletAdapter({ network: "mainnet", storage: memoryStorage(), mock });

  await adapter.connect();
  await adapter.signMessage({ message: "m", recipient: "app.rhea.finance", nonce: new Uint8Array(32) });
  await adapter.disconnect();
  assert.deepEqual(log.calls, ["connect", "signMessage", "disconnect"]);
});

test("source guard: login/preview modules never call a transaction method", () => {
  // 078 adds ONE explicit transaction capability (`adapter.ts` → wallet). Everything on the login,
  // NEP-413 and preview paths stays transaction-free.
  const loginPathFiles = [
    "NearWalletProvider.tsx",
    "recipient.ts",
    "rhea.ts",
    "phaseC.ts",
    "useNearLogin.ts",
    "login.ts",
    "login-server.ts",
  ];
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const file of loginPathFiles) {
    const source = readFileSync(resolve(here, file), "utf8");
    assert.equal(
      /\.(signAndSendTransaction|signAndSendTransactions|signTransaction)\s*\(/.test(source),
      false,
      `${file} must not call a NEAR transaction method`,
    );
  }
});

test("source guard: the only wallet transaction call is inside adapter sendTransactions", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const source = readFileSync(resolve(here, "adapter.ts"), "utf8");
  const calls = source.match(/\.(signAndSendTransaction|signAndSendTransactions)\s*\(/g) ?? [];
  assert.equal(calls.length, 2, "adapter has exactly the wallet mock + wallet transaction calls");
  assert.match(
    source,
    /async sendTransactions\([\s\S]*signAndSendTransactions\s*\(/,
    "the transaction calls live inside the explicit sendTransactions boundary",
  );
  const signMessageStart = source.indexOf("async signMessage(");
  assert.notEqual(signMessageStart, -1);
  const nextMethod = source.indexOf("\n  async ", signMessageStart + 1);
  const signMessageBody = source.slice(signMessageStart, nextMethod === -1 ? undefined : nextMethod);
  assert.doesNotMatch(signMessageBody, /signAndSend/, "signMessage must not call a transaction method");
});
