import "server-only";

/**
 * 076 — trusted server config for a NEAR login. The recipient is the app's OWN domain (never the
 * request body), and the test-mode switch is a SERVER env that production never sets.
 */

const CANONICAL_DOMAINS = ["alpha.sparkpoint.io", "sparkpoint.io", "beta.sparkpoint.io"];

/**
 * The domain a NEP-413 message must name for this deployment.
 *
 * TRUSTED CONFIG ONLY: `NEAR_LOGIN_RECIPIENT`, then `SIWE_DOMAIN`, then a host in the app's own
 * canonical-domain allowlist. It deliberately does NOT fall back to an arbitrary request `Host`
 * header — that would let a caller choose the domain bound into the signed message. The one
 * exception is the env-gated test mode, which exists only for localhost/CI.
 */
export function nearLoginRecipient(req: Request): string | null {
  const pinned = (process.env.NEAR_LOGIN_RECIPIENT ?? "").trim();
  if (pinned) return pinned;
  const siwe = (process.env.SIWE_DOMAIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
  if (siwe) return siwe;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (host && CANONICAL_DOMAINS.includes(host)) return host;
  if (nearLoginTestMode().enabled && host) return host;
  return null;
}

/**
 * Env-gated test hook: skip ONLY the on-chain key lookup, and only for the designated account.
 * The account pin is REQUIRED — an unset pin disables the hook entirely (never "any account").
 */
export function nearLoginTestMode(): { enabled: boolean; accountId?: string } {
  const requested = (process.env.NEAR_LOGIN_TEST_MODE ?? "").trim().toLowerCase() === "true";
  const accountId = (process.env.NEAR_LOGIN_TEST_ACCOUNT ?? "").trim() || undefined;
  return { enabled: requested && Boolean(accountId), accountId };
}
