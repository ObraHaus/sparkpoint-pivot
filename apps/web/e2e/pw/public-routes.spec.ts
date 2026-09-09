import { expect, test } from "@playwright/test";

/**
 * Public, non-custodial routes must render WITHOUT a wallet and must NEVER be gated behind
 * connect/beta — /exit and /trust are the withdraw + transparency surfaces and have to work
 * regardless of backend or auth state (N2). No wallet is injected in these tests.
 */

test("landing renders", async ({ page }) => {
  const resp = await page.goto("/");
  expect(resp?.status()).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
});

test("/exit is reachable without a wallet (never gated)", async ({ page }) => {
  await page.goto("/exit");
  // Must NOT be bounced to /connect or /verify — the exit path is always open.
  await expect(page).toHaveURL(/\/exit(\/|$|\?)/);
  await expect(page.locator("body")).toBeVisible();
});

test("/trust is reachable without a wallet (never gated)", async ({ page }) => {
  await page.goto("/trust");
  await expect(page).toHaveURL(/\/trust(\/|$|\?)/);
  await expect(page.locator("body")).toBeVisible();
});

test("a protected app route bounces an unauthenticated visitor to /connect", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/connect(\/|$|\?)/);
});
