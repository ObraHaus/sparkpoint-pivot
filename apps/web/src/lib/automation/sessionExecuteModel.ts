/**
 * Pure orchestration for a hands-off (session-key) submission (US6, feature 022) — no React, no wallet.
 *
 * Two injectable pieces the hook wires to real I/O so the retry/poll semantics are unit-testable:
 *  - {@link submitWithRetry}: POST the client-signed userOp, retrying ONLY a retryable degrade (503/409)
 *    with ONE stable idempotency key — a `400 VALIDATION_ERROR` (bundler reject / scope mismatch) is
 *    terminal and surfaced, never retried. Unlike the eoa relay this submit IS the submission (the
 *    bundler broadcasts), so its response `userOpHash` is authoritative.
 *  - {@link pollUntilTerminal}: poll the bundler userOp receipt (`GET /submit-signed-tx/{id}`) until
 *    confirmed/failed or the budget is exhausted (then still-pending, honestly).
 */

/**
 * Retryable HTTP statuses (mirrors `executionModel.isRelayRetryable`; inlined so this stays a leaf,
 * node:test-loadable module): a `409 DATA_STALE` and a transient `503 UPSTREAM_UNAVAILABLE`. A `400`
 * (bundler reject / scope mismatch) — or anything else — is permanent.
 */
function isRelayRetryable(status: number): boolean {
  return status === 409 || status === 503;
}

/** How many times to try, and the backoff between tries (mirrors `executionModel.RelayPolicy`). */
export interface RelayPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface SubmitResponse {
  status: number;
  userOpHash?: string;
  /** A human message from the agent's error envelope on a non-2xx (e.g. a verbatim bundler reject). */
  message?: string;
}

export interface SubmitDeps {
  /** POST the signed userOp with `idempotencyKey`; resolves the HTTP status + parsed body. Never throws. */
  post: (idempotencyKey: string) => Promise<SubmitResponse>;
  sleep: (ms: number) => Promise<void>;
  /** A fresh idempotency key for the whole logical submission — generated ONCE, reused across retries. */
  newKey: () => string;
}

export interface SubmitResult extends SubmitResponse {
  /** The op was accepted + recorded (a 2xx). */
  ok: boolean;
}

/**
 * Submit the signed userOp with a bounded retry on a *retryable* degrade (503 `UPSTREAM_UNAVAILABLE`
 * / 409 `DATA_STALE`), reusing one idempotency key so a re-submit is idempotent (same nonce/userOpHash
 * at the EntryPoint; `executions.UNIQUE(intent_bundle_id)` backstops double-record). A `400` bundler
 * rejection is terminal. Never throws — a network error surfaces as `status: 0`.
 */
export async function submitWithRetry(deps: SubmitDeps, policy: RelayPolicy): Promise<SubmitResult> {
  const key = deps.newKey();
  let last: SubmitResponse = { status: 0 };
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    last = await deps.post(key);
    if (last.status >= 200 && last.status < 300) return { ok: true, ...last };
    if (!isRelayRetryable(last.status) || attempt === policy.maxAttempts) return { ok: false, ...last };
    await deps.sleep(policy.backoffMs);
  }
  return { ok: false, ...last };
}

export type TerminalStatus = "pending" | "confirmed" | "failed";

export interface PollDeps {
  /** Fetch the current status of the submitted userOp (bundler receipt via the status endpoint). */
  fetchStatus: () => Promise<TerminalStatus>;
  sleep: (ms: number) => Promise<void>;
}

export interface PollPolicy {
  maxPolls: number;
  intervalMs: number;
}

/**
 * Poll the userOp status until it reaches a terminal state (`confirmed`/`failed`) or the budget is
 * spent (returns the last `pending` — the UI then says "still pending, check back"). A `fetchStatus`
 * that throws is treated as a transient `pending` so a blip doesn't abort the poll.
 */
export async function pollUntilTerminal(deps: PollDeps, policy: PollPolicy): Promise<TerminalStatus> {
  let status: TerminalStatus = "pending";
  for (let i = 0; i < policy.maxPolls; i += 1) {
    try {
      status = await deps.fetchStatus();
    } catch {
      status = "pending";
    }
    if (status !== "pending") return status;
    if (i < policy.maxPolls - 1) await deps.sleep(policy.intervalMs);
  }
  return status;
}
