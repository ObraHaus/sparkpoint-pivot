/**
 * Pure helpers for the ExecutionDrawer (feature 019 US2) — no React, no wallet.
 *
 * The load-bearing one is {@link stepToTx}: the drawer signs the SERVER-issued calldata VERBATIM
 * (the byte-match the /submit-signed-tx relay asserts, SC-005) — it NEVER re-encodes the transaction.
 * {@link signGate} keeps the UI fail-closed (sign only when approved + fresh + on the connected chain);
 * an EXIT bundle is still signable even when its simulation is null (the server approved it under N2).
 */

import type { IntentBundle, IntentStep } from "@sparkpoint/shared/schemas";
import type { Address, Hex } from "viem";

/** The exact wagmi `sendTransaction` params for a step — signed verbatim (no re-encode). */
export interface StepTx {
  to: Address;
  data: Hex;
  value: bigint;
}

/** An IntentBundle step → the wagmi tx to sign VERBATIM (the byte-match, N1/SC-005). */
export function stepToTx(step: IntentStep): StepTx {
  return {
    to: step.to as Address,
    data: step.data as Hex,
    value: BigInt(step.value || "0"),
  };
}

/** Exit action kinds — never gated by the UI (N2). The server never blocks these either. */
const EXIT_KINDS: ReadonlySet<string> = new Set(["vault_withdraw", "vault_redeem", "aave_withdraw"]);

export function isExitKind(kind: string): boolean {
  return EXIT_KINDS.has(kind);
}

/** A bundle is expired once `now >= expiresAt`. A malformed timestamp is treated as NOT expired. */
export function isExpired(expiresAt: string, now: number): boolean {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? now >= t : false;
}

export interface SignGate {
  canSign: boolean;
  reason?: string;
}

/**
 * The fail-closed UI sign gate: Sign is offered ONLY when the bundle is policy-approved, unexpired,
 * and its step targets the connected chain. (The server only returns a bundle for approved actions,
 * so this never *blocks an exit* the server allowed — it just refuses to sign a stale/wrong-chain one.)
 */
export function signGate(
  bundle: IntentBundle,
  connectedChainId: number | undefined,
  now: number,
): SignGate {
  if (!bundle.policyVerdict.approved) {
    return { canSign: false, reason: "This action isn't cleared by your guardrails." };
  }
  if (isExpired(bundle.expiresAt, now)) {
    return { canSign: false, reason: "This preview has expired — refresh to sign." };
  }
  const step = bundle.steps[0];
  if (step && connectedChainId !== undefined && step.chainId !== connectedChainId) {
    return { canSign: false, reason: "Wrong network — switch your wallet to continue." };
  }
  return { canSign: true };
}

/** A short human label for a bundle/action kind. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "vault_deposit":
      return "Deposit to the vault";
    case "vault_withdraw":
      return "Withdraw from the vault";
    case "vault_redeem":
      return "Redeem vault shares";
    default:
      return kind;
  }
}

/** Format a signed base-unit integer delta string to a signed decimal (exact, integer-only). */
export function formatDelta(delta: string, decimals: number): string {
  const neg = delta.startsWith("-");
  const raw = (neg ? delta.slice(1) : delta).replace(/^0+(?=\d)/, "");
  const padded = raw.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  const whole = padded.slice(0, cut) || "0";
  const frac = decimals > 0 ? padded.slice(cut).replace(/0+$/, "") : "";
  const num = frac ? `${whole}.${frac}` : whole;
  return (neg ? "-" : "+") + num;
}
