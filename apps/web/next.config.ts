import type { NextConfig } from "next";

// Per-build release identity (feature 006, force-refresh-on-new-release). Computed ONCE per build and
// frozen, so it changes on EVERY real deploy — including a config/dependency-only redeploy where the
// git commit is unchanged (a pure SHA would miss those and leave stale clients). SOURCE_COMMIT is
// provided by the Coolify build (build_command `git rev-parse`, or "Include Source Commit in Build");
// the base-36 timestamp fallback guarantees a non-empty, per-build value even when neither is wired.
const RELEASE_COMMIT = process.env.SPARKPOINT_BUILD_ID || process.env.SOURCE_COMMIT || "dev";
const BUILD_ID = `${RELEASE_COMMIT}-${Date.now().toString(36)}`;

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
