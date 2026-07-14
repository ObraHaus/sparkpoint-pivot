import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge geo-fence middleware (T026).
 *
 * Gates app surfaces for known-restricted regions — but is a CONVENIENCE filter,
 * never the enforcement boundary. The chain is truth: the on-chain withdraw path
 * is always reachable regardless of anything decided here.
 *
 * ALWAYS let through, UNCONDITIONALLY (FR-044 / SC-014):
 *   • `/exit` (+ subpaths)  — the N2 withdraw escape hatch is NEVER geo-blocked.
 *   • `/trust` (+ subpaths) — provability / the Trust Center is NEVER geo-blocked.
 *   • `/`                    — the marketing landing.
 *   • `/geo-blocked`         — the notice itself (never block it ⇒ no redirect loop).
 *   • Next internals + static assets (`/_next`, `/api`, favicon, metadata routes).
 *
 * DEFAULT-ALLOW: region is derived from an edge geo header (Vercel/Cloudflare/
 * generic proxies). When there is no geo signal — local dev, tests, or a proxy
 * that strips it — this DEFAULTS TO ALLOW. Only a KNOWN-blocked region is
 * redirected to `/geo-blocked`; every other region passes.
 *
 * Dependency-free (next/server only). The blocked-region set is edge/server-only
 * config (`GEO_BLOCKED_REGIONS`, NOT NEXT_PUBLIC_* — it never reaches the client);
 * the authoritative list is a compliance decision, overridable without a code change.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T026; spec.md FR-044, SC-014.
 */

/**
 * ISO-3166-1 alpha-2 codes to geo-block. Default is the comprehensively
 * sanctioned set; compliance may override via `GEO_BLOCKED_REGIONS` (CSV).
 */
const BLOCKED_REGIONS = new Set(
  (process.env.GEO_BLOCKED_REGIONS ?? "CU,IR,KP,SY")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0),
);

/** Exact paths always allowed (landing, geo notice, favicon + metadata routes). */
const ALWAYS_ALLOW_EXACT = new Set<string>([
  "/",
  "/geo-blocked",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/icon.png",
  "/apple-icon",
  "/opengraph-image",
  "/twitter-image",
]);

/**
 * Path PREFIXES always allowed, matched segment-wise (`/trust` matches `/trust`
 * and `/trust/…` but never `/trustworthy`). `/exit` and `/trust` are the
 * never-geo-blocked surfaces; the rest are framework/static infra.
 */
const ALWAYS_ALLOW_PREFIX = ["/exit", "/trust", "/_next", "/api", "/assets"];

function isAlwaysAllowed(pathname: string): boolean {
  if (ALWAYS_ALLOW_EXACT.has(pathname)) return true;
  return ALWAYS_ALLOW_PREFIX.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The visitor's ISO country code from an edge geo header, or `null` when there is
 * no usable signal (local dev / stripped proxy / unknown). `null` ⇒ default allow.
 */
function regionOf(req: NextRequest): string | null {
  const h = req.headers;
  const raw =
    h.get("x-vercel-ip-country") ??
    h.get("cf-ipcountry") ??
    h.get("x-country-code") ??
    h.get("x-geo-country");
  if (raw === null) return null;
  const code = raw.trim().toUpperCase();
  // "XX"/"ZZ" (unknown) and "T1" (Tor) are non-signals ⇒ allow.
  if (code.length === 0 || code === "XX" || code === "ZZ" || code === "T1") return null;
  return code;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Unconditional allow — /exit (N2 escape hatch), /trust (provability), the
  // landing, the geo notice, Next internals, and static assets are NEVER blocked.
  if (isAlwaysAllowed(pathname)) return NextResponse.next();

  const region = regionOf(req);

  // No geo signal ⇒ DEFAULT ALLOW (local dev / tests / stripping proxy).
  if (region === null) return NextResponse.next();

  // Known-blocked region ⇒ redirect to the notice. Everything else passes.
  if (BLOCKED_REGIONS.has(region)) {
    const url = req.nextUrl.clone();
    url.pathname = "/geo-blocked";
    url.search = "";
    const res = NextResponse.redirect(url, 307);
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Cost guard only — the in-code allow-list above is the real boundary. Skip
  // true static infra by PREFIX (not by ".*\\..*", which would let /chat.rsc
  // bypass the gate). `/exit`, `/trust`, and `/` are re-allowed in-code so a
  // future matcher change can never accidentally geo-block the escape hatch.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
