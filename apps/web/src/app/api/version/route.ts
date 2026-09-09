import { NextResponse } from "next/server";

/**
 * GET /api/version — feature 006 (force-refresh-on-new-release).
 *
 * Reports THIS running deployment's release id so a stale tab can detect that a newer build is live
 * and reload onto it. It echoes the build-time-baked `NEXT_PUBLIC_BUILD_ID` (see next.config.ts) and
 * is NEVER recomputed per request — a per-request value (e.g. Date.now()) would make every client
 * permanently mismatch and loop the reload. `no-store` so no proxy/CDN pins an old value.
 *
 * Non-custody: read-only, no params, no auth, no funds path. Gate-exempt via middleware ALLOW_EXACT
 * so the fail-closed SITE_LOCKED gate returns JSON here instead of a 307 to /coming-soon.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Baked at build (module-load), frozen for the life of the container.
const VERSION = process.env.NEXT_PUBLIC_BUILD_ID || "unknown";

export function GET(): NextResponse {
  return NextResponse.json({ version: VERSION }, { headers: { "cache-control": "no-store" } });
}
