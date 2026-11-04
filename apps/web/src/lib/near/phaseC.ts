/**
 * 075 — Phase C gating for the Rhea "sign in your wallet" step.
 *
 * Phase C is OFF by default. When the build flag is off the Rhea card renders exactly as it did
 * before (display-only placeholder). When an operator explicitly turns it on AND a NEAR wallet is
 * connected AND the preview carries a `messageToSign`, the card offers a NEP-413 `signMessage`
 * call. The signature is displayed as SIGNING ONLY: it is never submitted anywhere, no transaction
 * is built, and the deposit button stays disabled.
 */

import { isValidNearAccountId } from "./account.ts";

export const RHEA_NEP413_RECIPIENT = "app.rhea.finance";

export function phaseCSignEnabled(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** The build-time Phase C switch (Next inlines the `NEXT_PUBLIC_*` read). */
export function phaseCEnabledFromEnv(): boolean {
  return phaseCSignEnabled(process.env.NEXT_PUBLIC_NEAR_PHASE_C_SIGN);
}

export interface RheaSignOfferInput {
  readonly enabled: boolean;
  readonly accountId: string | null;
  readonly messageToSign: string | null | undefined;
}

/** True only when the flag is on, a usable account is selected, and there is a message. */
export function shouldOfferRheaSign(input: RheaSignOfferInput): boolean {
  if (!input.enabled) return false;
  if (!input.messageToSign?.trim()) return false;
  return !!input.accountId && isValidNearAccountId(input.accountId);
}

export interface NearSignRequest {
  readonly message: string;
  readonly recipient: string;
  readonly nonce: Uint8Array;
}

/** NEP-413 request for the Phase C message. A nonce can be injected for deterministic tests. */
export function buildRheaSignRequest(message: string, nonce?: Uint8Array): NearSignRequest {
  return {
    message,
    recipient: RHEA_NEP413_RECIPIENT,
    nonce: nonce ?? randomNonce(),
  };
}

export function randomNonce(): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("NEAR sign-only nonce requires crypto.getRandomValues");
  }
  const nonce = new Uint8Array(32);
  cryptoObj.getRandomValues(nonce);
  return nonce;
}
