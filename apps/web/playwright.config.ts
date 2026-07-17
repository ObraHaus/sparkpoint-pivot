import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright browser-e2e config (R4 #18). Drives a locally-served PRODUCTION build with a fake
 * injected EIP-1193 wallet (see e2e/pw/injected-wallet.ts) so the non-custodial connect → SIWE →
 * session flow runs headless. Distinct from the Node-based gate matrix in e2e/auth.e2e.mjs.
 *
 * The server is started by `webServer` (`pnpm start`) unless PW_BASE_URL points elsewhere. Env the
 * server needs (SESSION_SECRET, AGENT_INTERNAL_URL/AGENT_S2S_TOKEN, gate-off, RPC) is inherited from
 * the shell that launches `playwright test` — see e2e/pw/README for the exact set.
 */
const BASE_URL = process.env.PW_BASE_URL || "http://localhost:3000";
const useOwnServer = !process.env.PW_NO_SERVER && BASE_URL.includes("localhost");

export default defineConfig({
  testDir: "./e2e/pw",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(useOwnServer
    ? {
        webServer: {
          command: "pnpm start -p 3000",
          url: BASE_URL,
          timeout: 120_000,
          reuseExistingServer: true,
        },
      }
    : {}),
});
