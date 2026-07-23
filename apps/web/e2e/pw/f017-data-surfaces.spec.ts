import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 017 — P1 data surfaces, browser e2e against the deployed app with the injected wallet.
 * - US2: /vault shows the live Aave APY honestly ("≈0% (testnet)" / "—"), never the old 4.3%/3.87%.
 * - US3: /fees shows the honest fee panel, not the fabricated yield-vs-revenue bars / "$0.00 fees".
 * - US1: /portfolio uses the corrected PnL copy (no "net deposited"), and the position detail shows
 *        the realized-PnL / avg-cost UI (or the honest pending state) — never a crash.
 * Skips without a beta-allowlisted PW_TEST_PRIVKEY.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 25_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("017 P1 data surfaces", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.describe.configure({ timeout: 180_000 });

  test("US2: /vault shows a live/honest APY, never the fabricated 4.3%/3.87%", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/vault", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    // The old hardcoded figures must be gone.
    await expect(page.locator("text=3.87%")).toHaveCount(0);
    await expect(page.locator("text=/4\\.3% Aave/")).toHaveCount(0);
    // An honest live label is shown for the net APY (≈0% on testnet, or "—" if unreadable).
    await expect(page.locator("text=/≈0% \\(testnet\\)|Net APY/").first()).toBeVisible({ timeout: 20_000 });
  });

  test("US3: /fees shows the honest panel, not the fabricated bars / $0.00", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/fees", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    // The fabricated revenue chart + hardcoded "$0.00 fees so far" are gone.
    await expect(page.locator("text=your yield vs our revenue · last 5 months")).toHaveCount(0);
    await expect(page.locator("text=in fees so far")).toHaveCount(0);
    // The honest live-fee panel is present.
    await expect(page.locator("text=profit above your high-water mark").first()).toBeVisible({ timeout: 20_000 });
  });

  test("US1: /portfolio uses the corrected PnL copy (no 'net deposited') and renders", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page).toHaveURL(/\/portfolio(\/|$|\?)/);
    // The stale "net deposited" cost-basis copy is replaced by the avg-cost wording (017).
    await expect(page.locator("text=net deposited")).toHaveCount(0);
  });
});
