import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * The full non-custodial auth flow with the fake injected wallet: the wallet auto-connects (an
 * already-authorized browser wallet), /connect advances to /verify, the SIWE `personal_sign` is
 * signed in Node by the test wallet, the server mints a session, and a beta-allowlisted wallet is
 * admitted to the app. Requires a beta-allowlisted PW_TEST_PRIVKEY + the local server wired to the
 * agent (AGENT_INTERNAL_URL/AGENT_S2S_TOKEN) with the gate off — see e2e/pw for the env set.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

/** Complete the SIWE sign-in on /verify; resolves once the wallet is admitted ("You're in."). */
async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "networkidle" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 15_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 25_000 });
}

test.describe("connect → SIWE → session", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (a beta-allowlisted test wallet key)");

  test("injected wallet auto-connects and /connect advances to /verify", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await page.goto("/connect");
    // The already-authorized injected wallet reconnects on mount, so /connect advances to the SIWE step.
    await expect(page).toHaveURL(/\/verify(\/|$|\?)/, { timeout: 20_000 });
  });

  test("SIWE signature mints a session and admits a beta wallet", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    // The four verify steps all resolve green for an allowlisted wallet.
    await expect(page.locator("#vsteps")).toContainText("Signed in (SIWE) · verified");
    await expect(page.locator("#vsteps")).toContainText("Beta access · eligible");
    // The success CTA into the app is offered.
    await expect(page.locator("a:has-text('Start onboarding')")).toBeVisible();
  });

  test("an authenticated wallet can open a protected app route (live portfolio)", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    // With the session set, a protected route renders instead of bouncing to /connect (R1 portfolio).
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/portfolio(\/|$|\?)/);
    await expect(page.locator("body")).toBeVisible();
    // Not bounced to the public connect/verify gate.
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);
  });
});
