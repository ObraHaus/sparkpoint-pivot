import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 016 — P1 quick wins, browser e2e against the deployed app with the fake injected wallet.
 * - US4: /settings notification toggles + display density persist per-device (localStorage) across a
 *   reload, and Compact density stamps `data-density` on <html> (applies app-wide).
 * Trust card (US3) is verified separately on the public /trust page (no wallet needed). Skips
 * without a beta-allowlisted PW_TEST_PRIVKEY.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 25_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("016 P1 quick wins", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.describe.configure({ timeout: 180_000 });

  test("US4: a notification toggle persists across reload (per-device localStorage)", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator(".settab", { hasText: "Notifications" }).click();

    const first = page.locator('button[role="switch"]').first();
    await first.waitFor({ state: "visible", timeout: 15_000 });
    const before = await first.getAttribute("aria-checked");
    await first.click();
    const after = await first.getAttribute("aria-checked");
    expect(after).not.toBe(before); // the toggle flipped

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".settab", { hasText: "Notifications" }).click();
    const persisted = page.locator('button[role="switch"]').first();
    await persisted.waitFor({ state: "visible", timeout: 15_000 });
    expect(await persisted.getAttribute("aria-checked")).toBe(after); // survived the reload
  });

  test("US4: Compact density stamps data-density on <html> app-wide", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator(".settab", { hasText: "Appearance" }).click();
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact", { timeout: 10_000 });
    // and it persists across a reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact", { timeout: 10_000 });
  });
});
