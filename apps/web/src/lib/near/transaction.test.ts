import test from "node:test";
import assert from "node:assert/strict";

import { createNearWalletAdapter, type NearWalletMock } from "./adapter.ts";
import { USDC_TOKEN_ID, type NearTransaction } from "./burrow.ts";

const ACCOUNT = {
  accountId: "sparkpoint2026.near",
  publicKey: "ed25519:93KzqfxDmbFtSs5FCRJJGJpTg1Qc8r6oCzHyebrbnwr1",
};

const transaction: NearTransaction = {
  receiverId: ACCOUNT.accountId,
  actions: [
    {
      type: "FunctionCall",
      params: {
        methodName: "execute",
        args: { actions: [{ Withdraw: { token_id: USDC_TOKEN_ID, max_amount: "1000000" } }] },
        gas: "100000000000000",
        deposit: "1",
      },
    },
  ],
};

function mock(overrides: Partial<NearWalletMock> = {}): NearWalletMock & {
  sent: Array<{ receiverId: string; actions: unknown[] }>;
} {
  const sent: Array<{ receiverId: string; actions: unknown[] }> = [];
  const base: NearWalletMock = {
    connect: async () => ACCOUNT,
    disconnect: async () => undefined,
    getAccount: async () => ACCOUNT,
    signMessage: async () => ({
      accountId: ACCOUNT.accountId,
      publicKey: ACCOUNT.publicKey,
      signature: "ed25519:mock",
    }),
    signAndSendTransactions: async (params) => {
      sent.push(...params.transactions);
      return [{ transaction: { hash: "11111111111111111111111111111111" } }];
    },
    ...overrides,
  };
  return Object.assign(base, { sent });
}

test("sendTransactions refuses immediately when the connected account changed", async () => {
  const wallet = mock({ getAccount: async () => ({ accountId: "someone-else.near" }) });
  const adapter = createNearWalletAdapter({ network: "mainnet", storage: null, mock: wallet });
  await assert.rejects(
    () => adapter.sendTransactions([transaction], { expectedAccountId: ACCOUNT.accountId }),
    /account changed/i,
  );
  assert.equal(wallet.sent.length, 0);
});

test("sendTransactions refuses when the wallet reports no account", async () => {
  const wallet = mock({ getAccount: async () => null });
  const adapter = createNearWalletAdapter({ network: "mainnet", storage: null, mock: wallet });
  await assert.rejects(
    () => adapter.sendTransactions([transaction], { expectedAccountId: ACCOUNT.accountId }),
    /account changed/i,
  );
  assert.equal(wallet.sent.length, 0);
});

test("sendTransactions hands the exact reviewed unsigned actions to the wallet once", async () => {
  const wallet = mock();
  const adapter = createNearWalletAdapter({ network: "mainnet", storage: null, mock: wallet });
  const outcomes = await adapter.sendTransactions([transaction], { expectedAccountId: ACCOUNT.accountId });
  assert.equal(outcomes.length, 1);
  assert.equal(wallet.sent.length, 1);
  assert.deepEqual(wallet.sent[0], {
    receiverId: transaction.receiverId,
    actions: transaction.actions,
  });
});

test("NEP-413 signMessage still never sends a transaction", async () => {
  const wallet = mock();
  const adapter = createNearWalletAdapter({ network: "mainnet", storage: null, mock: wallet });
  await adapter.signMessage({ message: "m", recipient: "app.rhea.finance", nonce: new Uint8Array(32) });
  assert.equal(wallet.sent.length, 0);
});
