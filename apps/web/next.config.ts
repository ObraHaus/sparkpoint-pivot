import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: allow the Coder workspace proxy hosts to load Next's dev
  // resources (HMR + on-demand chunks) cross-origin. Without this, previewing
  // `next dev` through `*--…--hello.testcoder.aldrickb.xyz` blocks the client
  // chunks and the page renders without its client JS. No effect on `next start`.
  allowedDevOrigins: ["*.testcoder.aldrickb.xyz", "*.aldrickb.xyz"],
};

export default nextConfig;
