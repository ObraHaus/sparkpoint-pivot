import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionWalletStale } from "./session-binding.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const A_MIXED = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa"; // same wallet, different case
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const sess = (address: string) => ({ address });

test("no session (loading=undefined / signed out=null) is never stale, whatever the wallet", () => {
  assert.equal(isSessionWalletStale(undefined, A, true), false);
  assert.equal(isSessionWalletStale(null, A, true), false);
  assert.equal(isSessionWalletStale(undefined, undefined, false), false);
  assert.equal(isSessionWalletStale(null, undefined, true), false);
});

test("same connected wallet as the session → NOT stale (case-insensitive)", () => {
  assert.equal(isSessionWalletStale(sess(A), A, true), false);
  assert.equal(isSessionWalletStale(sess(A), A_MIXED, true), false); // checksum vs lowercase
  assert.equal(isSessionWalletStale(sess(A_MIXED), A, true), false);
});

test("a DIFFERENT connected wallet than the session → stale (the wallet-switch bug)", () => {
  // Forward case: signed in as A, extension switched to B — B must get a fresh sign-in, not A's verdict.
  assert.equal(isSessionWalletStale(sess(A), B, true), true);
  // Reverse case: signed in as allowlisted A, switched to B — B must not coast on A's beta claim.
  assert.equal(isSessionWalletStale(sess(B), A, true), true);
  // seenConnected is irrelevant once a concrete wallet is connected.
  assert.equal(isSessionWalletStale(sess(A), B, false), true);
});

test("disconnected AFTER having been connected → stale (real disconnect)", () => {
  assert.equal(isSessionWalletStale(sess(A), undefined, true), true);
});

test("disconnected with a session but never-yet-connected → NOT stale (SSR reconnect window)", () => {
  // First load: cookie resolves before wagmi reconnects (address still undefined, none seen yet).
  // Must NOT drop a valid session here, else every page load would sign the user out pre-reconnect.
  assert.equal(isSessionWalletStale(sess(A), undefined, false), false);
});
