import { NextResponse, type NextRequest } from "next/server";

// Construction gate — feature 003-landing-only-gate.
//
// FAIL-CLOSED: any value other than an explicit "false" locks the site to the
// landing page only. Read at build time for the Edge runtime, so SITE_LOCKED
// MUST be present in each deployment's BUILD env (Coolify injects per-app env
// at build):
//   develop  -> SITE_LOCKED=false   (full app, team/client preview)
//   public   -> SITE_LOCKED=true    (landing only)
// Launch = set SITE_LOCKED=false and redeploy. No code change, no revert.
const LOCKED = (process.env.SITE_LOCKED ?? "").toLowerCase() !== "false";

// Only these are public when locked. Matched on pathname so that RSC / .rsc /
// .segment.rsc payload requests to gated routes — which share the gated
// pathname — are gated too. This is an ALLOW-LIST, never a denylist: unknown,
// dynamic, and future routes are gated by default.
const ALLOW_EXACT = new Set([
  "/",
  "/coming-soon",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  // App Router metadata asset routes — must stay public so the branded favicon,
  // social/OG image, and PWA manifest load on the gated landing.
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-icon",
  "/opengraph-image",
  "/twitter-image",
]);
const ALLOW_PREFIX = ["/_next/static", "/_next/image"];

export function middleware(req: NextRequest) {
  if (!LOCKED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (
    ALLOW_EXACT.has(pathname) ||
    ALLOW_PREFIX.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // Gated: send everything else to the Coming soon page. Use redirect (not
  // rewrite) so a soft client navigation receives a real redirect instead of
  // the wrong RSC flight. noindex so the under-construction app is not crawled.
  const url = req.nextUrl.clone();
  url.pathname = "/coming-soon";
  url.search = "";
  const res = NextResponse.redirect(url, 307);
  res.headers.set("x-robots-tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Skip middleware for true static infra (by PREFIX, not by file extension —
  // excluding ".*\\..*" would let /chat.rsc bypass the gate). The in-code
  // allow-list above is the real boundary; this matcher is only a cost guard.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
