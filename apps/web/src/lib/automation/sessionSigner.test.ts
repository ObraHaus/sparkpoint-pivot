import { test } from "node:test";
import assert from "node:assert/strict";

import { getAddress, recoverMessageAddress, size } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { sessionUserOpHash, signSessionUserOp, SESSION_SIGNATURE_MODE } from "./sessionSigner.ts";
import type { PackedUserOperation } from "@sparkpoint/shared/schemas";

// A fixed (well-known anvil) session key + the exact unsigned op shape the agent emits
// (`session_userop.py` — signature null, hex-string gas envelope). Deterministic → hashes are stable.
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const SESSION_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CHAIN = 84532;

const OP: PackedUserOperation = {
  sender: "0x1111111111111111111111111111111111111111",
  nonce: "0x7",
  factory: null,
  factoryData: null,
  callData: "0xb61d27f6000000000000000000000000000000000000000000000000000000000000abcd",
  callGasLimit: "0x7a120",
  verificationGasLimit: "0x249f0",
  preVerificationGas: "0x30d40",
  maxFeePerGas: "0x2faf080",
  maxPriorityFeePerGas: "0xf4240",
  paymaster: null,
  paymasterData: null,
  signature: null,
};

// Regression pin: the canonical EntryPoint-v0.7 userOpHash viem computes for OP@84532 TODAY. If a viem
// bump or a coercion change moves this, the test fails loudly (a silent hash drift = an AA24 at the
// bundler). The LIVE bundler smoke before merge is the byte-parity cross-check vs the on-chain EntryPoint.
const EXPECTED_HASH = "0x0375bb5dfa740f7c98542373516dcf1bff657838b6199e72de169af9d2576188";

test("userOpHash is stable (regression pin against silent coercion/viem drift)", () => {
  const h = sessionUserOpHash(OP, CHAIN);
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(h, EXPECTED_HASH);
});

test("signature is a 66-byte mode-0x01 session signature (r‖s‖v, v∈{27,28})", async () => {
  const { signedUserOp } = await signSessionUserOp(OP, { chainId: CHAIN, privateKey: PK });
  const sig = signedUserOp.signature;
  assert.equal(size(sig), 66); // 1 (mode) + 32 (r) + 32 (s) + 1 (v)
  assert.equal(sig.slice(0, 4), SESSION_SIGNATURE_MODE);
  const v = parseInt(sig.slice(-2), 16);
  assert.ok(v === 27 || v === 28, `v must be 27/28, got ${v}`);
});

test("recovers to the SESSION address over the EIP-191-wrapped hash (mirrors recoverSessionSigner)", async () => {
  const { signedUserOp, userOpHash } = await signSessionUserOp(OP, { chainId: CHAIN, privateKey: PK });
  // Strip the mode byte → the 65-byte ECDSA sig the contract's ECDSA.recover consumes.
  const sig65 = ("0x" + signedUserOp.signature.slice(4)) as `0x${string}`;
  const recovered = await recoverMessageAddress({ message: { raw: userOpHash }, signature: sig65 });
  assert.equal(getAddress(recovered), getAddress(SESSION_ADDR));
  assert.equal(getAddress(recovered), getAddress(privateKeyToAccount(PK).address));
});

test("signing is deterministic (RFC-6979) — same op ⇒ identical signature", async () => {
  const a = await signSessionUserOp(OP, { chainId: CHAIN, privateKey: PK });
  const b = await signSessionUserOp(OP, { chainId: CHAIN, privateKey: PK });
  assert.equal(a.userOpHash, b.userOpHash);
  assert.equal(a.signedUserOp.signature, b.signedUserOp.signature);
});

test("preserves sender + callData VERBATIM (the SC-005 byte-match the agent re-checks)", async () => {
  const { signedUserOp } = await signSessionUserOp(OP, { chainId: CHAIN, privateKey: PK });
  assert.equal(signedUserOp.sender, OP.sender);
  assert.equal(signedUserOp.callData, OP.callData);
  assert.equal(signedUserOp.nonce, OP.nonce);
  assert.notEqual(signedUserOp.signature, null);
});

test("chainId is bound into the hash (a different chain ⇒ a different userOpHash)", () => {
  assert.notEqual(sessionUserOpHash(OP, CHAIN), sessionUserOpHash(OP, 8453));
});
