import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";

import { encodeBase58, encodeNep413Payload, nep413Digest, verifyNep413Signature } from "./nep413.ts";
import {
  buildNearLoginMessage,
  nonceToBytes,
  verifyNearLogin,
  type NearLoginDeps,
} from "./login.ts";

const RECIPIENT = "beta.sparkpoint.io";
const ACCOUNT = "sparkpoint2026.near";

function keypair(): { publicKey: string; privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { publicKey: `ed25519:${encodeBase58(new Uint8Array(raw))}`, privateKey };
}

function nonce(): string {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64url");
}

function signedLogin(recipient = RECIPIENT, overrides: { nonce?: string; expiresAt?: string } = {}) {
  const { publicKey, privateKey } = keypair();
  const n = overrides.nonce ?? nonce();
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  const message = buildNearLoginMessage({ recipient, nonce: n, issuedAt, expiresAt });
  const payload = { message, nonce: nonceToBytes(n), recipient };
  const signature = Buffer.from(
    edSign(null, Buffer.from(nep413Digest(payload)), privateKey),
  ).toString("base64");
  return { publicKey, signature, message, nonce: n, issuedAt, expiresAt };
}

function deps(overrides: Partial<NearLoginDeps> = {}): NearLoginDeps {
  const record = { issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  return {
    expectedRecipient: RECIPIENT,
    consumeNonce: async () => record,
    keyIsFullAccess: async () => true,
    ...overrides,
  };
}

test("valid NEP-413 signature + full-access key is accepted", async () => {
  const login = signedLogin();
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce },
    deps({
      consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }),
    }),
  );
  assert.deepEqual(result, { ok: true });
});

test("a tampered signature is rejected", async () => {
  const login = signedLogin();
  const bad = login.signature.slice(0, -2) + (login.signature.endsWith("11") ? "22" : "11");
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: bad, message: login.message, nonce: login.nonce },
    deps({ consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }) }),
  );
  assert.deepEqual(result, { ok: false, error: "invalid_signature" });
});

test("a signature made for a different recipient is rejected", async () => {
  const login = signedLogin("evil.example");
  const canonical = buildNearLoginMessage({
    recipient: RECIPIENT,
    nonce: login.nonce,
    issuedAt: login.issuedAt,
    expiresAt: login.expiresAt,
  });
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: canonical, nonce: login.nonce },
    deps({ consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }) }),
  );
  assert.deepEqual(result, { ok: false, error: "invalid_signature" });
});

test("a reused nonce is rejected the second time", async () => {
  const login = signedLogin();
  const record = { issuedAt: login.issuedAt, expiresAt: login.expiresAt };
  let uses = 0;
  const d = deps({
    consumeNonce: async () => {
      uses += 1;
      return uses === 1 ? record : null;
    },
  });
  const input = { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce };
  assert.deepEqual(await verifyNearLogin(input, d), { ok: true });
  assert.deepEqual(await verifyNearLogin(input, d), { ok: false, error: "nonce_expired" });
});

test("an expired nonce is rejected", async () => {
  const login = signedLogin(RECIPIENT, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce },
    deps({
      consumeNonce: async () => ({
        issuedAt: login.issuedAt,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    }),
  );
  assert.deepEqual(result, { ok: false, error: "nonce_expired" });
});

test("a key that is not on the account is rejected", async () => {
  const login = signedLogin();
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce },
    deps({
      consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }),
      keyIsFullAccess: async () => false,
    }),
  );
  assert.deepEqual(result, { ok: false, error: "key_not_full_access" });
});

test("test mode without a pinned account fails closed", async () => {
  const login = signedLogin();
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce },
    deps({
      consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }),
      keyIsFullAccess: async () => false,
      testMode: true,
    }),
  );
  assert.deepEqual(result, { ok: false, error: "test_account_required" });
});

test("test mode only accepts the pinned account", async () => {
  const login = signedLogin();
  const result = await verifyNearLogin(
    { accountId: ACCOUNT, publicKey: login.publicKey, signature: login.signature, message: login.message, nonce: login.nonce },
    deps({
      consumeNonce: async () => ({ issuedAt: login.issuedAt, expiresAt: login.expiresAt }),
      keyIsFullAccess: async () => false,
      testMode: true,
      testAccountId: "someone-else.near",
    }),
  );
  assert.deepEqual(result, { ok: false, error: "test_account_required" });
});

test("the borsh payload starts with the NEP-413 tag", () => {
  const payload = { message: "hi", nonce: new Uint8Array(32), recipient: RECIPIENT };
  const encoded = encodeNep413Payload(payload);
  assert.equal(new DataView(encoded.buffer).getUint32(0, true), 2 ** 31 + 413);
  assert.equal(verifyNep413Signature({ publicKey: "ed25519:bad", signature: "ed25519:bad", payload }), false);
});
