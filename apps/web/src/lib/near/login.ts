/**
 * 076 — the server-side NEAR NEP-413 login flow (pure, dependency-injected).
 *
 * The web routes own cookies/HTTP; this module owns the security decisions so every branch is
 * unit-testable without a running server:
 *   - the account id has a valid NEAR shape;
 *   - the nonce is consumed exactly once (the store returns its server-issued lifetime);
 *   - the signed message is the SERVER's canonical message for that nonce/recipient/lifetime;
 *   - the ed25519 signature verifies over the NEP-413 borsh payload;
 *   - the signing key is a FULL-ACCESS key of the account (unless the explicit, env-gated test
 *     mode is on for a designated throwaway test account).
 *
 * NON-CUSTODY: a successful check only proves account control. It authorizes no transaction.
 */

import { isValidNearAccountId } from "./account.ts";
import { NEP413_STATEMENT, verifyNep413Signature } from "./nep413.ts";

/** How long a NEAR login message stays valid (mirrors the server nonce TTL). */
export const NEAR_LOGIN_TTL_MS = 10 * 60 * 1000;

export interface NearLoginMessageInput {
  readonly recipient: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * The canonical message a NEAR wallet signs. Both the client (from the nonce response) and the
 * server (from the consumed nonce record) build this exact string, so a client cannot substitute
 * a different statement and still verify.
 */
export function buildNearLoginMessage(input: NearLoginMessageInput): string {
  return [
    "SparkPoint sign-in",
    "",
    `Domain: ${input.recipient}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    "",
    NEP413_STATEMENT,
  ].join("\n");
}

/** Decode the URL-safe base64 nonce into the 32 raw bytes NEP-413 signs. */
export function nonceToBytes(nonce: string): Uint8Array {
  const normalized = nonce.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

export interface NearNonceRecord {
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface NearLoginInput {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
  readonly message: string;
  readonly nonce: string;
}

export interface NearLoginDeps {
  /** The app domain this deployment accepts (trusted server config, never the request body). */
  readonly expectedRecipient: string;
  /** Consume the nonce atomically; null ⇒ unknown, reused, or expired. */
  readonly consumeNonce: (nonce: string) => Promise<NearNonceRecord | null>;
  /** True iff `publicKey` is a FullAccess key of `accountId` (read-only RPC). */
  readonly keyIsFullAccess: (accountId: string, publicKey: string) => Promise<boolean>;
  /** Env-gated test mode: skips ONLY the on-chain key lookup, never the signature check. */
  readonly testMode?: boolean;
  /** When test mode is on, only this account may use it. */
  readonly testAccountId?: string;
}

export type NearLoginFailure =
  | "bad_account"
  | "bad_nonce"
  | "nonce_expired"
  | "bad_message"
  | "invalid_signature"
  | "key_not_full_access"
  | "key_check_failed"
  | "test_account_required";

export type NearLoginResult = { ok: true } | { ok: false; error: NearLoginFailure };

export async function verifyNearLogin(
  input: NearLoginInput,
  deps: NearLoginDeps,
): Promise<NearLoginResult> {
  if (!isValidNearAccountId(input.accountId)) return { ok: false, error: "bad_account" };
  if (!input.nonce || input.nonce.length > 128) return { ok: false, error: "bad_nonce" };

  const record = await deps.consumeNonce(input.nonce);
  if (!record) return { ok: false, error: "nonce_expired" };
  if (Date.parse(record.expiresAt) <= Date.now()) return { ok: false, error: "nonce_expired" };

  const canonical = buildNearLoginMessage({
    recipient: deps.expectedRecipient,
    nonce: input.nonce,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  });
  if (input.message !== canonical) return { ok: false, error: "bad_message" };

  const nonceBytes = nonceToBytes(input.nonce);
  if (nonceBytes.length !== 32) return { ok: false, error: "bad_nonce" };

  const valid = verifyNep413Signature({
    publicKey: input.publicKey,
    signature: input.signature,
    payload: {
      message: canonical,
      nonce: nonceBytes,
      recipient: deps.expectedRecipient,
    },
  });
  if (!valid) return { ok: false, error: "invalid_signature" };

  if (deps.testMode) {
    if (deps.testAccountId && input.accountId !== deps.testAccountId) {
      return { ok: false, error: "test_account_required" };
    }
    return { ok: true };
  }

  let fullAccess = false;
  try {
    fullAccess = await deps.keyIsFullAccess(input.accountId, input.publicKey);
  } catch {
    return { ok: false, error: "key_check_failed" };
  }
  if (!fullAccess) return { ok: false, error: "key_not_full_access" };
  return { ok: true };
}
