/**
 * BETA_OPEN — the public-open switch for the beta access gate (2026-10-04).
 *
 * The beta is no longer a closed, invite-only program: with `BETA_OPEN=true` every wallet that
 * completes SIWE (proves it controls the address) is admitted to the (app) shell — no allowlist,
 * no application, no SRK gate. Admin is DELIBERATELY unaffected: `/admin` + the admin APIs still
 * require an `admin` row in the DB-backed allowlist (`claims.admin`), resolved by the agent.
 *
 * FAIL-CLOSED, the same posture as `SITE_LOCKED`: anything other than an explicit "true" keeps the
 * allowlist in force, so an unset/typo'd value can never silently open the beta. Read at the three
 * server enforcement points — the edge middleware (which MUST reference `process.env.BETA_OPEN`
 * directly, so Next inlines it into the edge bundle), the BFF beta gate, and the session/verify
 * routes (which mint + report the `beta` claim).
 *
 * NON-CUSTODY (N2): this is an ACCESS switch only. It never gates /exit, /trust, or the on-chain
 * withdraw path; those stay open to everyone, signed in or not.
 */

/** Parse a `BETA_OPEN` env value. Exact "true" (case/whitespace-insensitive) opens the beta. */
export function betaGateOpen(value: string | undefined | null): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/**
 * Server-side value of the switch. Node route handlers can import this directly; the edge
 * middleware references `process.env.BETA_OPEN` itself (edge env is not reliably inlined through
 * an imported module) and calls {@link betaGateOpen} on the raw value.
 */
export const BETA_OPEN = betaGateOpen(process.env.BETA_OPEN);
