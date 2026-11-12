import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  MessageV0,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  MAX_TRANSACTION_BYTES,
  SolanaRpcError,
  SolanaSendError,
  computeUnitLimitFor,
  countComputeBudgetInstructions,
  medianPriorityFeeMicroLamports,
  prepareSolanaTransaction,
  sendSolanaTransaction,
  withComputeBudgetInstructions,
  type SolanaRpcTransport,
} from "./sendTransaction.ts";
import type { SolanaInjectedProvider } from "./wallet.ts";

const LOOKUP_TABLE = Keypair.generate().publicKey;

function baseTransaction(): VersionedTransaction {
  const payer = Keypair.generate().publicKey;
  const writable = Keypair.generate().publicKey;
  const readonlyProgram = Keypair.generate().publicKey;
  const readonlyOther = Keypair.generate().publicKey;
  const message = new MessageV0({
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 2,
    },
    staticAccountKeys: [payer, writable, readonlyProgram, readonlyOther],
    recentBlockhash: "11111111111111111111111111111111",
    compiledInstructions: [
      { programIdIndex: 2, accountKeyIndexes: [0, 1, 4], data: new Uint8Array([1, 2, 3]) },
      { programIdIndex: 5, accountKeyIndexes: [4], data: new Uint8Array([9]) },
    ],
    addressTableLookups: [
      {
        accountKey: LOOKUP_TABLE,
        writableIndexes: [0],
        readonlyIndexes: [1],
      },
    ],
  });
  return new VersionedTransaction(message);
}

function mockRpc(
  handlers: Record<string, (params: readonly unknown[]) => unknown>,
): { transport: SolanaRpcTransport; calls: Array<{ method: string; params: readonly unknown[] }> } {
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  return {
    calls,
    transport: {
      async call<T>(method: string, params: readonly unknown[]): Promise<T> {
        calls.push({ method, params });
        const handler = handlers[method];
        if (!handler) return undefined as T;
        return handler(params) as T;
      },
    },
  };
}

function baseHandlers(overrides: Record<string, (params: readonly unknown[]) => unknown> = {}) {
  return {
    getLatestBlockhash: () => ({
      value: {
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 1_000,
      },
    }),
    simulateTransaction: () => ({ value: { err: null, unitsConsumed: 233_720 } }),
    getRecentPrioritizationFees: () => [{ prioritizationFee: 30_000 }],
    ...overrides,
  };
}

function signingProvider(transaction: VersionedTransaction): SolanaInjectedProvider {
  return {
    connect: async () => ({}),
    signAndSendTransaction: async () => {
      throw new Error("signAndSendTransaction must not be used when signTransaction exists");
    },
    signTransaction: async () => transaction,
  };
}

test("compute unit limit adds margin, clamps to the safe range and falls back", () => {
  assert.equal(computeUnitLimitFor(233_720), 300_000);
  assert.equal(computeUnitLimitFor(400_000), 490_000);
  assert.equal(computeUnitLimitFor(5_000_000), 1_400_000);
  assert.equal(computeUnitLimitFor(null), 400_000);
  assert.equal(computeUnitLimitFor(undefined), 400_000);
});

test("priority fee is the median, clamped to 20k..200k µlamports", () => {
  assert.equal(medianPriorityFeeMicroLamports([]), 50_000n);
  assert.equal(medianPriorityFeeMicroLamports([100]), 20_000n);
  assert.equal(medianPriorityFeeMicroLamports([10_000, 30_000, 100_000]), 30_000n);
  assert.equal(medianPriorityFeeMicroLamports([100_000, 300_000]), 200_000n);
});

test("compute-budget instructions are prepended and lookup indexes shift by one", () => {
  const original = baseTransaction();
  const originalKeys = original.message.staticAccountKeys.length;
  const augmented = withComputeBudgetInstructions(original, 300_000, 50_000n);

  assert.notEqual(augmented, original);
  assert.equal(original.message.staticAccountKeys.length, originalKeys);
  assert.equal(countComputeBudgetInstructions(original), 0);
  assert.equal(countComputeBudgetInstructions(augmented), 2);
  assert.equal(augmented.serialize().length <= MAX_TRANSACTION_BYTES, true);

  const message = augmented.message as MessageV0;
  assert.equal(message.staticAccountKeys.length, originalKeys + 1);
  assert.equal(
    message.staticAccountKeys.at(-1)?.toBase58(),
    new PublicKey(COMPUTE_BUDGET_PROGRAM_ID).toBase58(),
  );
  assert.equal(message.header.numReadonlyUnsignedAccounts, 3);

  const [limit, price, ...rest] = message.compiledInstructions;
  assert.equal(limit?.programIdIndex, originalKeys);
  assert.deepEqual(Array.from(limit?.data ?? []), [2, 0xe0, 0x93, 0x04, 0x00]);
  assert.equal(price?.programIdIndex, originalKeys);
  assert.deepEqual(Array.from(price?.data ?? []), [3, 0x50, 0xc3, 0x00, 0x00, 0, 0, 0, 0]);

  // Static indexes below the old count are unchanged; lookup indexes move by one.
  assert.deepEqual(rest[0]?.accountKeyIndexes, [0, 1, 5]);
  assert.equal(rest[0]?.programIdIndex, 2);
  assert.deepEqual(rest[1]?.accountKeyIndexes, [5]);
  assert.equal(rest[1]?.programIdIndex, 6);
  assert.deepEqual(message.addressTableLookups, original.message.addressTableLookups);
});

test("a transaction that already has compute budget is left untouched", () => {
  const once = withComputeBudgetInstructions(baseTransaction(), 300_000, 50_000n);
  const again = withComputeBudgetInstructions(once, 300_000, 50_000n);
  assert.equal(again, once);
  assert.equal(countComputeBudgetInstructions(again), 2);
});

test("prepare refreshes the blockhash and adds compute budget from a simulation", async () => {
  const original = baseTransaction();
  const { transport } = mockRpc(baseHandlers());
  const prepared = await prepareSolanaTransaction(original, transport);

  assert.equal(prepared.computeBudgetAdded, true);
  assert.equal(prepared.computeUnitLimit, 300_000);
  assert.equal(prepared.priorityFeeMicroLamports, 30_000n);
  assert.equal(prepared.simulatedUnits, 233_720);
  assert.equal(prepared.lastValidBlockHeight, 1_000);
  assert.notEqual(prepared.transaction.message.recentBlockhash, "11111111111111111111111111111111");
  assert.equal(countComputeBudgetInstructions(prepared.transaction), 2);
});

test("a failed simulation still adds a safe fallback limit", async () => {
  const { transport } = mockRpc(
    baseHandlers({ simulateTransaction: () => ({ value: { err: "boom" } }) }),
  );
  const prepared = await prepareSolanaTransaction(baseTransaction(), transport);
  assert.equal(prepared.computeUnitLimit, 400_000);
});

test("signed bytes are broadcast, rebroadcast, then confirmed", async () => {
  let statusChecks = 0;
  let sends = 0;
  const { transport, calls } = mockRpc(
    baseHandlers({
      sendTransaction: () => {
        sends += 1;
        return "5" + "x".repeat(87);
      },
      getSignatureStatuses: () => {
        statusChecks += 1;
        return {
          value: [
            statusChecks >= 2
              ? { err: null, confirmationStatus: "confirmed" }
              : null,
          ],
        };
      },
      getBlockHeight: () => 999,
    }),
  );

  const result = await sendSolanaTransaction({
    provider: signingProvider(baseTransaction()),
    transaction: baseTransaction(),
    rpc: transport,
    sleep: async () => {},
    maxConfirmationAttempts: 6,
  });

  assert.equal(result.outcome, "confirmed");
  assert.equal(result.signature, "5" + "x".repeat(87));
  assert.equal(result.computeBudgetAdded, true);
  assert.ok(sends >= 2, "the same signed bytes are rebroadcast while pending");
  assert.ok(calls.some((call) => call.method === "sendTransaction"));
  assert.ok(calls.some((call) => call.method === "getSignatureStatuses"));
});

test("a blockhash expiry ends as 'expired — nothing was spent'", async () => {
  const { transport } = mockRpc(
    baseHandlers({
      sendTransaction: () => "5" + "x".repeat(87),
      getSignatureStatuses: () => ({ value: [null] }),
      getBlockHeight: () => 1_001,
    }),
  );

  const result = await sendSolanaTransaction({
    provider: signingProvider(baseTransaction()),
    transaction: baseTransaction(),
    rpc: transport,
    sleep: async () => {},
    maxConfirmationAttempts: 6,
  });

  assert.equal(result.outcome, "expired");
  assert.equal(result.error, null);
});

test("a preflight error surfaces with logs and never reaches the confirmation loop", async () => {
  const { transport, calls } = mockRpc(
    baseHandlers({
      sendTransaction: () => {
        throw new SolanaRpcError("Transaction simulation failed", {
          code: -32002,
          logs: ["Program log: Error: exceeded CUs meter"],
        });
      },
      getSignatureStatuses: () => ({ value: [null] }),
    }),
  );

  await assert.rejects(
    () =>
      sendSolanaTransaction({
        provider: signingProvider(baseTransaction()),
        transaction: baseTransaction(),
        rpc: transport,
        sleep: async () => {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof SolanaSendError);
      assert.match(error.message, /preflight/i);
      assert.match(error.message, /exceeded CUs meter/);
      assert.deepEqual(error.logs, ["Program log: Error: exceeded CUs meter"]);
      return true;
    },
  );
  assert.equal(calls.some((call) => call.method === "getSignatureStatuses"), false);
});

test("wallets without signTransaction fall back to signAndSendTransaction", async () => {
  let signedAndSent = 0;
  const provider: SolanaInjectedProvider = {
    connect: async () => ({}),
    signAndSendTransaction: async () => {
      signedAndSent += 1;
      return { signature: "4" + "y".repeat(87) };
    },
  };
  const { transport, calls } = mockRpc(
    baseHandlers({
      getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: "finalized" }] }),
    }),
  );

  const result = await sendSolanaTransaction({
    provider,
    transaction: baseTransaction(),
    rpc: transport,
    sleep: async () => {},
    maxConfirmationAttempts: 2,
  });

  assert.equal(signedAndSent, 1);
  assert.equal(result.outcome, "confirmed");
  assert.equal(calls.some((call) => call.method === "sendTransaction"), false);
});
