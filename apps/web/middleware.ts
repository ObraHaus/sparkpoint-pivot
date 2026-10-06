import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { betaGateOpen } from "@/lib/auth/openBeta";

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

// BETA_OPEN — the public-open switch (2026-10-04). When true, ANY wallet with a valid SIWE session
// reaches the (app) shell; the admin surface is untouched (still `claims.admin`). Referenced
// DIRECTLY here for the same edge-inlining reason as the secret above. FAIL-CLOSED: anything other
// than an explicit "true" keeps the allowlist gate exactly as it was.
const BETA_OPEN = betaGateOpen(process.env.BETA_OPEN);

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
  // 045: the public alpha application. Both halves are listed on purpose. The landing page is
  // served on a LOCKED deploy and now carries the form, so the endpoint it posts to must be
  // served there too — otherwise the form renders, submits, and gets a 307 to /coming-soon that
  // the client reads as a failure. `/apply` is the same form on its own linkable address.
  "/apply",
  "/api/access/apply",
  // The Sparky Broker mint whitelist application — same public shape as /apply (a standalone form
  // address so it can be posted and linked) and the same shared submission endpoint, which is
  // already listed above.
  "/mint-whitelist",
]);
const ALLOW_PREFIX = [
  "/_next/static",
  "/_next/image",
  // 044: the published revenue allocations, on a LOCKED deploy.
  //
  // ⚠️ THIS LIST IS ONLY GATE 1. An entry here does nothing on develop, which is UNLOCKED and runs
  // Gate 2 instead — so a path that needs to be public everywhere must ALSO be in `INFRA_PREFIX`
  // below. Adding it here alone is exactly the mistake that shipped: the file was published,
  // deployed and still 307'd for every anonymous fetch.
  "/allocations/",
];

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — Phase B access gate (runs only when UNLOCKED / develop).
//
// Enforces the SIWE session: (app) shell routes need a beta session (or ANY session when
// `BETA_OPEN=true` — the public beta); /admin needs an admin session (invisible 404 to everyone
// else). NEVER gated — the landing, the login flow (/connect,/verify),
// the escape hatches (/exit,/trust and their subpages, N2), static/infra, and /api/* (each API
// route self-enforces: the BFF derives identity from the session, the auth routes are the login).
// ─────────────────────────────────────────────────────────────────────────────

/** Public pages that never require a session (exact match). */
const PUBLIC_EXACT = new Set([
  "/",
  "/connect",
  "/verify",
  // 045 — applying for access must never require access. The whole point is that the applicant has
  // no session; gating this would redirect them to /connect, which is the wall they are writing to
  // ask about. (`/api/access/apply` needs no entry here: Gate 2 passes every `/api` path via
  // INFRA_PREFIX. It IS listed in ALLOW_EXACT above, which Gate 1 needs.)
  "/apply",
  // The Sparky Broker mint whitelist application: the same rule. A visitor asking for a mint spot
  // has no reason to hold app access, so gating this would be the same dead end.
  "/mint-whitelist",
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
const INFRA_PREFIX = [
  "/_next",
  "/api",
  "/assets",
  "/wallets",
  "/fonts",
  "/images",
  // 044: the published revenue allocations. A period's split is a claim about other people's
  // money, so the document it was computed from has to be fetchable by anyone who wants to
  // recompute the Merkle root and check it (FR-010). An artifact you must log in to read is not a
  // public record. Nothing here is secret — every address and amount is derivable from the chain,
  // and each claim transaction is public anyway.
  "/allocations/",
];

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

  // App shell — requires a beta session, or simply a session when the beta is open to all.
  if (!claims) {
    const url = req.nextUrl.clone();
    url.pathname = "/connect";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }
  if (!claims.beta && !BETA_OPEN) {
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
