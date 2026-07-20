/**
 * Version-compare helpers (feature 006). PURE — no React, no react-query — so the no-op/compare rules
 * are unit-testable in isolation (see version.test.ts). The React poll lives in useVersionCheck.ts.
 *
 * Safety law: uncertainty is ALWAYS a no-op. We never treat "unknown" or an unreadable response as a
 * new build — a spurious reload in a funds app is unacceptable — and we never reload when our own
 * baked id is missing (we can't trust the comparison).
 */

/** The release id baked into THIS bundle at build. Literal member expression so Next inlines it. */
export const CLIENT_BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** Ids that mean "we don't actually know" — never comparable. */
export const UNKNOWN_IDS: ReadonlySet<string> = new Set(["", "unknown"]);

/** True when `id` is a real, comparable release id (present and not a placeholder). */
export function isKnownId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && !UNKNOWN_IDS.has(id);
}

/** True only when both ids are known AND differ — i.e. a genuinely newer server build. */
export function isRealUpdate(
  client: string | null | undefined,
  server: string | null | undefined,
): boolean {
  return isKnownId(client) && isKnownId(server) && client !== server;
}

/**
 * Parse a /api/version response into a version string, or `null` on ANY uncertainty:
 * non-2xx, a redirect (the SITE_LOCKED gate 307s to HTML), a non-JSON content-type, unparseable
 * JSON, or a missing/empty `version`. `null` ⇒ the caller does nothing.
 */
export async function parseVersion(res: Response): Promise<string | null> {
  if (!res.ok || res.redirected) return null;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("application/json")) return null;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const v = (data as { version?: unknown } | null)?.version;
  return typeof v === "string" && v.length > 0 ? v : null;
}
