import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 1 — Construction gate (feature 003-landing-only-gate). UNCHANGED.
//
// FAIL-CLOSED: any value other than an explicit "false" locks the site to the landing page only.
// Read for the Edge runtime, so SITE_LOCKED MUST be in each deployment's env:
//   develop -> SITE_LOCKED=false  (full app, gated by the Phase-B access gate below)
//   public  -> SITE_LOCKED=true   (landing only)
// ─────────────────────────────────────────────────────────────────────────────
const LOCKED = (process.env.SITE_LOCKED ?? "").toLowerCase() !== "false";

// Referenced DIRECTLY here so Next inlines the value into the edge middleware bundle at build time
// (an imported-module `process.env` read is not reliably inlined for the edge runtime, which does
// not expose arbitrary runtime env). Passed into verifySession below. Same value the node routes
// sign with, so signatures verify identically on both sides.
const MW_SESSION_SECRET = process.env.SESSION_SECRET || process.env.AUTH_SECRET || undefined;

const ALLOW_EXACT = new Set([
  "/",
  "/coming-soon",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/icon.png",
  "/apple-icon",
  "/opengraph-image",
  "/twitter-image",
  "/api/subscribe",
  // Feature 006: the release-id read must return JSON even on a LOCKED (landing-only) deploy,
  // not a 307 to /coming-soon (the poller no-ops on a redirect/HTML).
  "/api/version",
  // Network-gate incident capture — must accept the beacon even on a LOCKED deploy (log-only,
  // no auth/DB). On UNLOCKED/develop it's already reachable via INFRA_PREFIX; this is parity.
  "/api/debug/network",
]);
const ALLOW_PREFIX = [
  "/_next/static",
  "/_next/image",
  // 044: the published revenue allocations. These MUST stay reachable without a session, on a
  // LOCKED deploy included — the whole point of publishing them (FR-010) is that a holder, or
  // anyone at all, can recompute a period's split and check it against the on-chain Merkle root.
  // An artifact you have to be logged in to read is not a public record.
  //
  // ⚠️ Nothing here is secret: every address and amount is derivable from the chain, and each
  // claim transaction is public anyway. What would be a defect is this path silently 307ing to
  // /coming-soon, which is what happens to anything added to apps/web that a machine needs to
  // fetch (see the tokenURI/OG-bot class of bug).
  "/allocations/",
];

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — Phase B access gate (runs only when UNLOCKED / develop).
//
// Enforces the SIWE session: (app) shell routes need a beta session; /admin needs an admin session
// (invisible 404 to everyone else). NEVER gated — the landing, the login flow (/connect,/verify),
// the escape hatches (/exit,/trust and their subpages, N2), static/infra, and /api/* (each API
// route self-enforces: the BFF derives identity from the session, the auth routes are the login).
// ─────────────────────────────────────────────────────────────────────────────

/** Public pages that never require a session (exact match). */
const PUBLIC_EXACT = new Set([
  "/",
  "/connect",
  "/verify",
  "/coming-soon",
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

/** Static/infra + API prefixes — always allowed (API routes self-enforce). */
const INFRA_PREFIX = ["/_next", "/api", "/assets", "/wallets", "/fonts", "/images"];

/** The non-custody escape hatches — withdraw + trust center. NEVER gated by any auth (N2). */
const ESCAPE_HATCH = ["/exit", "/trust"];

/** True when `pathname` is exactly `base` or a descendant (`base/...`). */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Render the app's 404 for a denied /admin request — keeps the surface invisible (no 403 leak). */
function deny404(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/gate-404";
  url.search = "";
  return NextResponse.rewrite(url);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Gate 1: construction lock.
  if (LOCKED) {
    if (ALLOW_EXACT.has(pathname) || ALLOW_PREFIX.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = "/coming-soon";
    url.search = "";
    const res = NextResponse.redirect(url, 307);
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }

  // Gate 2: access gate (unlocked). Never-gated paths first.
  if (INFRA_PREFIX.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (ESCAPE_HATCH.some((base) => under(pathname, base))) return NextResponse.next();
  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();

  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, MW_SESSION_SECRET);

  // Admin surface — invisible to non-admins (404, never 403 or a revealing redirect).
  if (under(pathname, "/admin")) {
    return claims?.admin ? NextResponse.next() : deny404(req);
  }

  // App shell — requires a beta session.
  if (!claims) {
    const url = req.nextUrl.clone();
    url.pathname = "/connect";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }
  if (!claims.beta) {
    // Authenticated but not allowlisted → the honest "not in the beta yet" state on /verify
    // (which also points them at /exit to withdraw). Never a fake pass.
    const url = req.nextUrl.clone();
    url.pathname = "/verify";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.next();
}

export const config = {
  // Skip middleware for true static infra (by PREFIX, not extension). The in-code lists above are
  // the real boundary; this matcher is only a cost guard.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
