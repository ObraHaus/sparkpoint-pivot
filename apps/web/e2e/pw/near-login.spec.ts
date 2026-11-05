import { expect, test } from "@playwright/test";

import { installNearLoginMock } from "./near-login-mock";

/**
 * 076 — NEAR-only login end to end.
 *
 * Requires a build with `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` and a server with
 * `NEAR_LOGIN_TEST_MODE=true` + `NEAR_LOGIN_TEST_ACCOUNT` (the throwaway test account) plus
 * `SESSION_SECRET` and a reachable agent (nonce store). The signature is REAL ed25519; only the
 * on-chain key lookup is skipped by the test-mode switch.
 */

const ENABLED = process.env.NEAR_LOGIN_TEST_MODE === "true";

test.describe("076 NEAR-only login", () => {
  test.skip(!ENABLED, "NEAR_LOGIN_TEST_MODE not set");

  test("signs in with only a NEAR wallet and reaches the app shell", async ({ page }) => {
    await installNearLoginMock(page);
    await page.goto("/connect", { waitUntil: "domcontentloaded" });

    const nearSignIn = page.getByTestId("near-signin");
    await expect(nearSignIn).toBeVisible();
    await nearSignIn.click();

    await page.waitForURL("**/verify", { timeout: 30_000 });
    await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
    await expect(page.locator("#vsteps")).toContainText("Signed in (NEP-413)");
    await expect(page.locator("#vsteps")).toContainText("sparkpoint2026.near");

    for (const path of ["/chat", "/portfolio", "/vault", "/settings"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}(\\/|$|\\?)`));
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("the EVM wallet option is still offered alongside NEAR", async ({ page }) => {
    await page.goto("/connect", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("near-signin")).toBeVisible();
    // The EVM row(s) come from the real wagmi injected connector set; at least the NEAR option and
    // the EVM copy must coexist (no EVM wallet is required to see the page).
    await expect(page.getByText(/Browser wallet|MetaMask/i).first()).toBeVisible();
  });
});
