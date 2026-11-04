/**
 * 075 — NEAR account-id helpers (display shape only).
 *
 * A NEAR account id is a lower-case, dot-separated id (2–64 chars) or an implicit 64-char hex
 * account. These checks are a client-side shape guard for prefilled recipients; they never prove
 * ownership and are never sent to the agent as an authorisation claim.
 */

const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;
const NAMED_ACCOUNT_RE = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** True when `value` looks like a NEAR account id (named or implicit). */
export function isValidNearAccountId(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;
  return IMPLICIT_ACCOUNT_RE.test(candidate) || NAMED_ACCOUNT_RE.test(candidate);
}

/**
 * Truncate a NEAR account id for tight UI. Named ids are short and stay intact; a long implicit
 * (64-hex) id or an unusually long subaccount keeps a recognisable head + tail.
 */
export function truncateNearAccount(value: string, head = 10, tail = 6): string {
  const candidate = value.trim();
  if (candidate.length <= Math.max(24, head + tail + 1)) return candidate;
  return `${candidate.slice(0, head)}…${candidate.slice(-tail)}`;
}
