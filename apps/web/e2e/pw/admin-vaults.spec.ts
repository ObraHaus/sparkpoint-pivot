import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 011 /admin/vaults e2e (browser, fake injected wallet → SIWE → admin session). Guards the
 * regression where the admin BFF 500'd ("Unexpected error") because the factory ABIs weren't in the
 * deployed agent image. Read-only: the injected wallet signs only SIWE (no eth_sendTransaction).
 *
 * Run against alpha: PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1 PW_TEST_PRIVKEY=<admin key>.
 * Needs an ADMIN-allowlisted key on Base Sepolia (84532) where the demo factory/wrapper live.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  // domcontentloaded (not networkidle): /verify holds a live connection so networkidle can never
  // settle on the CPU-constrained alpha infra. The signLink.waitFor below gates on real readiness.
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 30_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("011 /admin/vaults (live)", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (an admin-allowlisted test wallet key on 84532)");

  test("Registered wrappers loads the wrapper + live on-chain state (no 500)", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
    await signIn(page);

    await page.goto("/admin/vaults", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);

    // The registered-wrappers panel renders.
    await expect(page.getByText("Registered wrappers")).toBeVisible({ timeout: 25_000 });

    // The demo wrapper's row loads with its LIVE on-chain state (label) — proving the keyless factory
    // ABI reads work in the deployed image (the regression this guards was a 500 here).
    await expect(page.getByText("SparkPoint Morpho USDC").first()).toBeVisible({ timeout: 30_000 });

    // The bug is gone: no error state.
    await expect(page.getByText(/Unexpected error|Failed to load/)).toHaveCount(0);

    // chainConfigured === true (the factory RPC read succeeded), so the panel says so.
    await expect(page.getByText("live on-chain reads")).toBeVisible({ timeout: 30_000 });
  });
});
