import type { NextConfig } from "next";

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
};

export default nextConfig;
