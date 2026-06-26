import { defineConfig, devices } from "@playwright/test";

/**
 * Parity harness config.
 * - Starts the static showcase server (the approved design) on :4123.
 * - Expects the scaffold (apps/web) reachable at SCAFFOLD_URL (default http://localhost:3000) —
 *   run `pnpm dev` (or `pnpm build && pnpm start`) in apps/web first; the config will reuse it.
 * - Two viewport projects: desktop (1440x900) and mobile (390x844).
 */
const SCAFFOLD_URL = process.env.SCAFFOLD_URL || "http://localhost:3000";
const SHOWCASE_URL = process.env.SHOWCASE_URL || "http://localhost:4123";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  workers: 3,
  reporter: [["html", { open: "never", outputFolder: "playwright-report" }], ["list"]],
  outputDir: "./test-results",
  use: {
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    // Freeze entrance/looping animations so screenshots are deterministic.
    reducedMotion: "reduce",
    baseURL: SCAFFOLD_URL,
  },
  metadata: { scaffoldUrl: SCAFFOLD_URL, showcaseUrl: SHOWCASE_URL },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: "node serve-showcase.mjs",
      url: SHOWCASE_URL,
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
});
