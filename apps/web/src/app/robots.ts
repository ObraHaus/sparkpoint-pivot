import type { MetadataRoute } from "next";

// Crawler rules track the construction gate (feature 003-landing-only-gate).
// When locked, advertise only the landing and keep the under-construction app
// out of indexes. (Best-effort hint; the middleware redirect + per-response
// x-robots-tag is the real enforcement.)
const LOCKED = (process.env.SITE_LOCKED ?? "").toLowerCase() !== "false";

export default function robots(): MetadataRoute.Robots {
  if (LOCKED) {
    // Allow the homepage only ("/$" anchors the root); disallow everything else.
    return { rules: { userAgent: "*", allow: "/$", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/" } };
}
