import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cacheUnlockKey,
  clearUnlockCache,
  deriveUnlockKey,
  getCachedUnlockKey,
  getSessionKey,
  hasSessionKey,
  putSessionKey,
  scopeKey,
  unlockMessage,
  wipeAccountKeys,
  wipeSessionKey,
  type KeyScope,
} from "./sessionKeyStore.ts";

const SCOPE: KeyScope = {
  chainId: 84532,
  account: "0xAbC1111111111111111111111111111111111111",
  sessionAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
};
// Two distinct 65-byte "wallet signatures".
const SIG_A = ("0x" + "11".repeat(65)) as `0x${string}`;
const SIG_B = ("0x" + "22".repeat(65)) as `0x${string}`;

test("scopeKey is versioned + lower-cased (case-stable across chain/account/session)", () => {
  assert.equal(scopeKey(SCOPE), "sp.session.key.v1:84532:0xabc1111111111111111111111111111111111111:0x90f79bf6eb2c4f870365e785982e1f101e93b906");
  // upper/lower variants of the same scope resolve to the same key.
  assert.equal(scopeKey({ ...SCOPE, account: SCOPE.account.toUpperCase() as `0x${string}` }), scopeKey(SCOPE));
});

test("unlockMessage names the account + chain and disclaims authorizing any move", () => {
  const m = unlockMessage(SCOPE.account, SCOPE.chainId);
  assert.match(m, /0xabc1111111111111111111111111111111111111/);
  assert.match(m, /84532/);
  assert.match(m, /does NOT authorize any move/i);
});

test("deriveUnlockKey is deterministic — the SAME signature round-trips AES-GCM", async () => {
  const keyA1 = await deriveUnlockKey(SIG_A);
  const keyA2 = await deriveUnlockKey(SIG_A);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode("secret");
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA1, pt);
  const back = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyA2, ct);
  assert.equal(new TextDecoder().decode(back), "secret");
});

test("a DIFFERENT signature derives a key that CANNOT decrypt (stolen snapshot alone is useless)", async () => {
  const keyA = await deriveUnlockKey(SIG_A);
  const keyB = await deriveUnlockKey(SIG_B);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keyA, new TextEncoder().encode("secret"));
  await assert.rejects(() => crypto.subtle.decrypt({ name: "AES-GCM", iv }, keyB, ct));
});

test("the in-memory unlock cache stores + clears per (account,chain)", async () => {
  clearUnlockCache();
  assert.equal(getCachedUnlockKey(SCOPE.account, SCOPE.chainId), undefined);
  const key = await deriveUnlockKey(SIG_A);
  cacheUnlockKey(SCOPE.account, SCOPE.chainId, key);
  assert.equal(getCachedUnlockKey(SCOPE.account, SCOPE.chainId), key);
  assert.equal(getCachedUnlockKey(SCOPE.account, 8453), undefined); // scoped by chain
  clearUnlockCache();
  assert.equal(getCachedUnlockKey(SCOPE.account, SCOPE.chainId), undefined);
});

test("SSR / no-IndexedDB: every store op degrades safely (no throw), never a fabricated key", async () => {
  // In the Node test env there is no `indexedDB` — the store must no-op / null, never throw.
  const key = await deriveUnlockKey(SIG_A);
  assert.equal(await putSessionKey(SCOPE, ("0x" + "ab".repeat(32)) as `0x${string}`, key), false);
  assert.equal(await getSessionKey(SCOPE, key), null);
  assert.equal(await hasSessionKey(SCOPE), false);
  await assert.doesNotReject(() => wipeSessionKey(SCOPE));
  await assert.doesNotReject(() => wipeAccountKeys(SCOPE.account));
});
