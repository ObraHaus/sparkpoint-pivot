import type { NextConfig } from "next";

// Per-build release identity (feature 006, force-refresh-on-new-release).
//
// ⚠️ MUST be deterministic within a single build. `next.config.ts` is evaluated MORE THAN ONCE per
// build (separate client/server compilations in different processes), so appending `Date.now()` here
// gave the client bundle and the server bundle DIFFERENT ids for the SAME build — the stale-tab check
// then saw a permanent "newer server" and the force-refresh banner reloaded, re-mismatched and tripped
// its loop-breaker (observed live 2026-09-20: HTML id `…-mu9o4ris` vs /api/version `…-mu9o4rpg`).
// The commit is stable across evaluations and still changes on every real deploy. (A same-commit
// rebuild with only env changes will not force a banner; the HTML is no-store, so the next navigation
// picks it up anyway.)
const RELEASE_COMMIT = process.env.SPARKPOINT_BUILD_ID || process.env.SOURCE_COMMIT || "dev";
const BUILD_ID = RELEASE_COMMIT;

const nextConfig: NextConfig = {
  // The shared source-of-truth package (`@sparkpoint/shared`) ships raw TS
  // (`type: module`, subpath exports to `./src/*.ts`) — transpile it here so the
  // seam consumers (policy mirror, agent-card zod schemas, address registry) can
  // import it directly without a separate build step. T098 keeps it drift-free.
  transpilePackages: ["@sparkpoint/shared"],
  // Dev-only: allow the Coder workspace proxy hosts to load Next's dev
  // resources (HMR + on-demand chunks) cross-origin. Without this, previewing
  // `next dev` through `*--…--hello.testcoder.aldrickb.xyz` blocks the client
  // chunks and the page renders without its client JS. No effect on `next start`.
  allowedDevOrigins: ["*.testcoder.aldrickb.xyz", "*.aldrickb.xyz"],
  // Feature 006: tie Next's chunk buildId to our release id AND inline the same value into the
  // bundle so the client knows the build it booted with. A same-origin /api/version echoes the
  // running server's value for the stale-tab comparison (see src/lib/version.ts).
  generateBuildId: () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
