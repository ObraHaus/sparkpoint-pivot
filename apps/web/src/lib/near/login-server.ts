import "server-only";

/**
 * 076 — trusted server config for a NEAR login. The recipient is the app's OWN domain (never the
 * request body), and the test-mode switch is a SERVER env that production never sets.
 */

const CANONICAL_DOMAINS = ["alpha.sparkpoint.io", "sparkpoint.io", "beta.sparkpoint.io"];

/** The domain a NEP-413 message must name for this deployment. */
export function nearLoginRecipient(req: Request): string {
  const pinned = (process.env.NEAR_LOGIN_RECIPIENT ?? "").trim();
  if (pinned) return pinned;
  const siwe = (process.env.SIWE_DOMAIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
  if (siwe) return siwe;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host.split(",")[0].trim() || CANONICAL_DOMAINS[0];
}

/** Env-gated test hook: skip ONLY the on-chain key lookup, and only for the designated account. */
export function nearLoginTestMode(): { enabled: boolean; accountId?: string } {
  const enabled = (process.env.NEAR_LOGIN_TEST_MODE ?? "").trim().toLowerCase() === "true";
  const accountId = (process.env.NEAR_LOGIN_TEST_ACCOUNT ?? "").trim() || undefined;
  return { enabled, accountId };
}
