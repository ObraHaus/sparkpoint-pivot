import test from "node:test";
import assert from "node:assert/strict";

import {
  clearDepositSnapshot,
  depositStorageKey,
  readDepositSnapshot,
  type KeyValueStore,
  writeDepositSnapshot,
} from "./depositStorage.ts";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const block = {
  origin: { key: "base:USDC", amount: "5000" },
  destination: { key: "btc:BTC" },
  quotedAt: "2026-11-01T00:19:48.065Z",
};

test("the key scopes a deposit to the conversation AND the quoted block", () => {
  const a = depositStorageKey("cnv_1", block);
  assert.equal(a, depositStorageKey("cnv_1", block));
  assert.notEqual(a, depositStorageKey("cnv_2", block));
  assert.notEqual(a, depositStorageKey("cnv_1", { ...block, quotedAt: "2026-11-01T00:25:00.000Z" }));
  assert.match(depositStorageKey(undefined, block), /:anon:/);
});

test("a saved deposit round-trips and can be cleared", () => {
  const store = memoryStore();
  const key = depositStorageKey("cnv_1", block);
  const snapshot = {
    depositAddress: "0xdeposit",
    deadline: "2026-11-01T00:49:48.065Z",
    recipient: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    refundTo: "0x0000000000000000000000000000000000000001",
    status: "PROCESSING",
    quoteId: 42,
  };
  writeDepositSnapshot(store, key, snapshot);
  assert.deepEqual(readDepositSnapshot(store, key), snapshot);
  clearDepositSnapshot(store, key);
  assert.equal(readDepositSnapshot(store, key), null);
});

test("malformed or incomplete storage is ignored instead of crashing the card", () => {
  const store = memoryStore();
  const key = "k";
  store.setItem(key, "{not json");
  assert.equal(readDepositSnapshot(store, key), null);
  store.setItem(key, JSON.stringify({ recipient: "x" }));
  assert.equal(readDepositSnapshot(store, key), null);
});
