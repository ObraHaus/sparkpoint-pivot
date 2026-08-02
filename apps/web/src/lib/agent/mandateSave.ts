/**
 * Pure outcome model for `POST /mandate` (§3.1) — what failed, and the honest copy for it.
 *
 * Extracted from `useAgent`/the onboarding page so it is unit-testable under the strip-types
 * runner (no React, no `@/` VALUE imports — the one import here is type-only and therefore
 * erased). Two things live here and nowhere else:
 *
 *  1. {@link classifyMandateSaveError} — did the SERVER reject the save (a §1.5 error envelope,
 *     with a real code + message we can show), or did the request never complete (connectivity)?
 *     The onboarding dock used to blame connectivity for BOTH, which is how a hard, permanent
 *     400 read as "check your connection and try again" — advice that could never work.
 *  2. {@link mandateSaveHint} — the dock hint copy for each case. A server rejection surfaces
 *     the server's own message + code so the failure is reportable; only an actual transport
 *     failure mentions the connection.
 *
 * NON-CUSTODY: a mandate is advisory config. Nothing modelled here signs, authorizes, or moves
 * funds — a failed save leaves the user with no plan persisted, never with funds at risk.
 */

/** How a `POST /mandate` attempt failed. */
export type MandateSaveFailureKind =
  /** No wallet identity resolved — there is nothing to scope the mandate to. */
  | "offline"
  /** The agent answered with a §1.5 error envelope (a real, quotable rejection). */
  | "server"
  /** The request never completed (transport failure / aborted) — genuinely connectivity. */
  | "network"
  /** Something threw that is neither of the above — a client-side defect, reported as such. */
  | "unexpected";

export interface MandateSaveFailure {
  readonly kind: MandateSaveFailureKind;
  /** The §1.6 agent error code, when the server rejected (e.g. `VALIDATION_ERROR`). */
  readonly code?: string;
  /** The server's human-readable message, when it sent one. */
  readonly message?: string;
}

/** The result of a save attempt. `ok` ⇒ the POST returned 2xx (the echoed mandate, when present). */
export type MandateSaveOutcome =
  | { readonly ok: true; readonly mandate: unknown }
  | { readonly ok: false; readonly failure: MandateSaveFailure };

/**
 * Structural view of the client's typed §1.5 error (`AgentApiError`). Duck-typed on purpose: a
 * VALUE import of `client.ts` would make this module non-leaf, and structural matching also
 * survives the error crossing a bundle/realm boundary where `instanceof` quietly fails.
 */
function asAgentError(err: unknown): { code: string; message: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; httpStatus?: unknown; message?: unknown };
  if (typeof e.code !== "string" || typeof e.httpStatus !== "number") return null;
  return { code: e.code, message: typeof e.message === "string" ? e.message : "" };
}

function errorName(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/**
 * Classify a thrown `POST /mandate` failure. A §1.5 envelope ⇒ `server` (carrying its code +
 * message); a `fetch` transport failure or an abort ⇒ `network`; anything else ⇒ `unexpected`.
 */
export function classifyMandateSaveError(err: unknown): MandateSaveFailure {
  const agent = asAgentError(err);
  if (agent) {
    return { kind: "server", code: agent.code, message: agent.message || undefined };
  }
  const name = errorName(err);
  if (err instanceof TypeError || name === "TypeError" || name === "AbortError") {
    return { kind: "network" };
  }
  const message = err instanceof Error && err.message ? err.message : undefined;
  return { kind: "unexpected", message };
}

/** Keep a server message from blowing out the one-line dock hint; never truncates mid-escape. */
const MAX_SERVER_MESSAGE = 140;

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_SERVER_MESSAGE ? trimmed : `${trimmed.slice(0, MAX_SERVER_MESSAGE - 1)}…`;
}

const PREFIX = "Couldn’t save your plan";

/**
 * The onboarding dock hint. `null` (no failure) ⇒ the neutral resting copy.
 *
 * The rule this encodes: **only an actual transport failure is allowed to mention the
 * connection.** A server rejection quotes the server, so a user (and whoever they report it to)
 * sees the real reason instead of retrying a network that was never the problem.
 */
export function mandateSaveHint(failure: MandateSaveFailure | null | undefined): string {
  if (!failure) return "You can change this anytime in Settings.";
  switch (failure.kind) {
    case "offline":
      return "Connect your wallet to save your plan — it’s stored against your wallet.";
    case "network":
      return `${PREFIX} — we couldn’t reach the server. Check your connection and try again.`;
    case "server": {
      const message = failure.message ? clamp(failure.message) : "";
      const code = failure.code ? ` (${failure.code})` : "";
      if (message) return `${PREFIX} — ${message}${code}`;
      return failure.code
        ? `${PREFIX} — the server rejected it${code}.`
        : `${PREFIX} — the server rejected it.`;
    }
    case "unexpected":
      return failure.message
        ? `${PREFIX} — something went wrong: ${clamp(failure.message)}`
        : `${PREFIX} — something went wrong on our side.`;
  }
}
