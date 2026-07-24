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

/* ── §3.6 best-effort relay of a signed tx (outcome correlation) ─────────────── */

/**
 * The HTTP statuses the agent marks *retryable* for the `/submit-signed-tx` relay: a `409` (the
 * relayed tx isn't yet visible to the agent's RPC — `DATA_STALE`, propagation lag) and a transient
 * `503` (`UPSTREAM_UNAVAILABLE`). A `400` byte-mismatch (SC-005) — or any other status — is permanent.
 */
export function isRelayRetryable(status: number): boolean {
  return status === 409 || status === 503;
}

/** Injectable side effects for {@link relayWithRetry} so the retry policy is unit-testable. */
export interface RelayDeps {
  /** POST the relay with `idempotencyKey`; resolves to the HTTP status (0 on a network error). Never throws. */
  post: (idempotencyKey: string) => Promise<number>;
  /** Resolve after `ms` (the inter-attempt backoff). */
  sleep: (ms: number) => Promise<void>;
  /** A fresh idempotency key for the whole logical submission — generated ONCE, reused across retries. */
  newKey: () => string;
}

/** How many times to try, and the backoff between tries. */
export interface RelayPolicy {
  maxAttempts: number;
  backoffMs: number;
}

/**
 * Best-effort relay of a signed tx for outcome correlation (§3.6), with a bounded retry on a
 * *retryable* degrade so a briefly-lagging real tx still correlates without any user action (the #91
 * verify-before-record returns `409 DATA_STALE` until the agent's RPC sees the tx). Uses ONE stable
 * idempotency key across retries: the agent caches only 2xx (so a `409` is re-processed, not replayed),
 * and `executions.UNIQUE(intent_bundle_id)` is the durable no-double-record backstop. NEVER throws —
 * the direct on-chain receipt is the source of truth (N2 independence). Returns the final HTTP status
 * (2xx success / idempotent replay, the last error status, or 0 on network failure) for tests only.
 */
export async function relayWithRetry(deps: RelayDeps, policy: RelayPolicy): Promise<number> {
  const key = deps.newKey();
  let status = 0;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    status = await deps.post(key);
    if (status >= 200 && status < 300) return status; // recorded (or idempotent 2xx replay) — done
    if (!isRelayRetryable(status) || attempt === policy.maxAttempts) return status;
    await deps.sleep(policy.backoffMs);
  }
  return status;
}
