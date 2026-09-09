import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet, switchInjectedAccount, waitForWalletReady } from "./injected-wallet";

/**
 * Wallet-switch regression (the reported alpha bug): a SIWE session must stay bound to the wallet in
 * front of the user. Switching accounts in the extension used to leave the app showing the OLD
 * wallet's verdict, because the session cookie was never re-checked against the connected wallet.
 *
 * FORWARD (the exact report): sign in with a NON-allowlisted wallet A → "not in the alpha yet"
 * (correct). Switch to allowlisted wallet B → the app must clear A's stale session and offer a fresh
 * sign-in for B (before the fix it was stuck on "not in the alpha yet" with no CTA).
 *
 * REVERSE (stale-pass): sign in with allowlisted A (in the app), switch to non-allowlisted B → B's
 * browser must NOT keep coasting on A's `beta` claim; the next protected navigation bounces to
 * /connect.
 *
 * Requires TWO throwaway testnet keys on the SAME supported chain:
 *   PW_TEST_PRIVKEY         — a BETA-allowlisted wallet (already used by connect-siwe.spec)
 *   PW_TEST_PRIVKEY_NONBETA — a wallet that is NOT on the agent's beta allowlist
 * Both plus the agent wiring (AGENT_INTERNAL_URL/AGENT_S2S_TOKEN, gate off) — see e2e/pw/README.
 * The suite `test.skip`s unless both keys are set, so the public suite still runs anywhere.
 */

const BETA = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const NONBETA = process.env.PW_TEST_PRIVKEY_NONBETA as Hex | undefined;

/** Click the SIWE CTA on /verify (must already be visible). */
async function clickSignIn(page: Page): Promise<void> {
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 15_000 });
  await signLink.click();
}

/**
 * Switch the injected account and wait for the app's stale-session logout to fire. Waits for wagmi
 * to be subscribed first (so the switch always propagates), then gives the effect headroom on heavy
 * routes (e.g. /portfolio) where hydration + live reads can delay it.
 */
async function switchAndAwaitLogout(page: Page, index: number): Promise<void> {
  await waitForWalletReady(page);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/auth/logout") && r.request().method() === "POST",
      { timeout: 30_000 },
    ),
    switchInjectedAccount(page, index),
  ]);
}

test.describe("SIWE session stays bound to the connected wallet", () => {
  test.skip(!BETA || !NONBETA, "needs PW_TEST_PRIVKEY (beta) + PW_TEST_PRIVKEY_NONBETA (non-beta)");

  test("FORWARD: non-allowlisted → switch to allowlisted re-offers sign-in and admits it", async ({
    page,
  }) => {
    // Active account = NON-allowlisted (index 0); the allowlisted wallet is index 1.
    await installInjectedWallet(page, { privateKeys: [NONBETA!, BETA!] });
    await page.goto("/verify", { waitUntil: "networkidle" });

    // Sign in as the non-allowlisted wallet → honestly blocked, and (the trap) no sign-in CTA.
    await clickSignIn(page);
    // Stage-driven copy (stageCopy.label / .adjective) — assert the shape, not a pinned "Beta".
    await expect(page.locator("#vsteps")).toContainText(/access · not in the \w+ yet/, {
      timeout: 25_000,
    });
    await expect(page.locator("a:has-text('Sign in with wallet')")).toHaveCount(0);

    // 026: the blocked branch is no longer a DEAD END — it now offers the access-application form,
    // and (N2) the /exit escape hatch is still right there beside it, not behind the form.
    await expect(page.locator("#app-contact")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#app-name")).toBeVisible();
    await expect(page.locator("#app-reason")).toBeVisible();
    await expect(page.locator("a:has-text('Withdraw via /exit')")).toBeVisible();

    // Switch to the allowlisted wallet in the "extension". The app must drop the stale session.
    await switchAndAwaitLogout(page, 1);

    // REGRESSION ASSERTION: the fresh sign-in CTA returns for the newly-connected wallet
    // (before the fix it stayed stuck on "not in the alpha yet" with no way forward).
    await expect(page.locator("a:has-text('Sign in with wallet')")).toBeVisible({ timeout: 15_000 });

    // And completing SIWE as the allowlisted wallet now admits it.
    await clickSignIn(page);
    await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 25_000 });
    // Stage-driven copy (029 renamed the stage to alpha) — assert the shape, not a pinned stage.
    await expect(page.locator("#vsteps")).toContainText(/\w+ access · eligible/);
  });

  test("REVERSE: allowlisted → switch to non-allowlisted stops passing the app gate", async ({
    page,
  }) => {
    // Active account = allowlisted (index 0); the non-allowlisted wallet is index 1.
    await installInjectedWallet(page, { privateKeys: [BETA!, NONBETA!] });
    await page.goto("/verify", { waitUntil: "networkidle" });
    await clickSignIn(page);
    await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 25_000 });

    // Protected route is reachable while signed in as the allowlisted wallet.
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/portfolio(\/|$|\?)/);

    // Switch to the non-allowlisted wallet → the app clears the stale beta session.
    await switchAndAwaitLogout(page, 1);

    // REGRESSION ASSERTION: the next protected navigation is NOT admitted on the old beta claim.
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/connect(\/|$|\?)/, { timeout: 15_000 });

    // Non-custody: withdraw/exit stays open to everyone regardless of session state (N2).
    await page.goto("/exit", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/exit(\/|$|\?)/);
  });
});
