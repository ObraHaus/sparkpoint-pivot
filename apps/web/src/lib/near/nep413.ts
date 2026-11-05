/**
 * 076 — NEP-413 message signing + server-side verification.
 *
 * A NEAR wallet proves account control by signing a borsh-encoded NEP-413 payload:
 *
 *   u32 tag (= 2^31 + 413) | String message | [u8; 32] nonce | String recipient | Option<String> callbackUrl
 *
 * This module owns the exact wire encoding and the ed25519 check. It is SERVER-ONLY (Node
 * `crypto`): the browser never verifies a signature, and the client only hands the wallet
 * `{ message, recipient, nonce }` (the wallet library builds the same payload itself).
 *
 * The tag is what stops a signed login message being replayed as a transaction: NEAR's
 * transaction borsh starts with a different discriminant, and NEP-413 wallets prepend this
 * tag before signing. There is NO transaction surface here.
 */

import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";

/** NEP-413's signed-message domain tag (2^31 + 413). */
export const NEP413_TAG = 2 ** 31 + 413;

/** The human-readable statement embedded in every SparkPoint login message. */
export const NEP413_STATEMENT =
  "Sign in to SparkPoint. This proves you control this NEAR account. " +
  "It does not authorize any transaction or move any funds.";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((char, index) => [char, index]),
);

/** Decode a base58 string (Bitcoin alphabet, as used by NEAR keys/signatures). */
export function decodeBase58(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;
  const bytes: number[] = [];
  for (const char of value) {
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) throw new Error("invalid base58 character");
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

/** Encode bytes as base58 (used by tests + the CI signing hook). */
export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => BASE58_ALPHABET[d]).join("");
}

export interface Nep413Payload {
  readonly message: string;
  /** Exactly 32 bytes. */
  readonly nonce: Uint8Array;
  readonly recipient: string;
  /** NEP-413 optional callback URL. SparkPoint never sets one; omit it (borsh Option = None). */
  readonly callbackUrl?: string | null;
}

/** Borsh-encode the NEP-413 payload exactly as a NEP-413 wallet signs it. */
export function encodeNep413Payload(payload: Nep413Payload): Uint8Array {
  const encoder = new TextEncoder();
  const message = encoder.encode(payload.message);
  const recipient = encoder.encode(payload.recipient);
  const callback = payload.callbackUrl ? encoder.encode(payload.callbackUrl) : null;
  const size =
    4 + 4 + message.length + 32 + 4 + recipient.length + 1 + (callback ? 4 + callback.length : 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint32(offset, NEP413_TAG, true);
  offset += 4;
  view.setUint32(offset, message.length, true);
  offset += 4;
  out.set(message, offset);
  offset += message.length;
  if (payload.nonce.length !== 32) throw new Error("NEP-413 nonce must be exactly 32 bytes");
  out.set(payload.nonce, offset);
  offset += 32;
  view.setUint32(offset, recipient.length, true);
  offset += 4;
  out.set(recipient, offset);
  offset += recipient.length;
  if (callback) {
    out[offset] = 1;
    offset += 1;
    view.setUint32(offset, callback.length, true);
    offset += 4;
    out.set(callback, offset);
  } else {
    out[offset] = 0;
  }
  return out;
}

/** Split a `curve:base58` NEAR public key into its curve + raw bytes. */
export function parseNearKey(value: string): { curve: string; bytes: Uint8Array } {
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) throw new Error("malformed NEAR key");
  const curve = value.slice(0, colon).toLowerCase();
  const bytes = decodeBase58(value.slice(colon + 1));
  return { curve, bytes };
}

/**
 * NEP-413 wallets return the signature as BASE64 (not a `curve:base58` key). Accept both shapes:
 * the standard base64 form and the `ed25519:<base58>` form some tooling emits.
 */
export function parseNearSignature(value: string): { curve: string; bytes: Uint8Array } {
  if (value.includes(":")) return parseNearKey(value);
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  return { curve: "ed25519", bytes };
}

/** NEP-413 signs SHA-256(borsh payload), not the raw payload (NEAR signature parity). */
export function nep413Digest(payload: Nep413Payload): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(Buffer.from(encodeNep413Payload(payload))).digest());
}

/** DER prefix for a raw ed25519 SubjectPublicKeyInfo (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify an ed25519 signature over the NEP-413 payload. Returns false (never throws) for any
 * malformed curve/key/signature, so callers can fail closed without a try/catch around every field.
 */
export function verifyNep413Signature(input: {
  publicKey: string;
  signature: string;
  payload: Nep413Payload;
}): boolean {
  try {
    const key = parseNearKey(input.publicKey);
    const sig = parseNearSignature(input.signature);
    if (key.curve !== "ed25519" || sig.curve !== "ed25519") return false;
    if (key.bytes.length !== 32 || sig.bytes.length !== 64) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.bytes)]),
      format: "der",
      type: "spki",
    });
    // NEP-413: sign SHA-256(prefixTag ++ borsh(Payload)).
    return verifyEd25519(
      null,
      Buffer.from(nep413Digest(input.payload)),
      publicKey,
      Buffer.from(sig.bytes),
    );
  } catch {
    return false;
  }
}
