import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 018 — P1 remainders, browser e2e against the deployed app with the injected wallet.
 * - US1: /outcomes shows a REAL ledger or an honest empty/pending state — NEVER the fabricated
 *        −$27.86 / "2 wins / 1 loss" / dead tx links.
 * - US2: the vault deposit confirm gate runs a real pre-sign dry-run row (best-effort — driven
 *        through the amount screen; asserts the dry-run copy surfaces).
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

test.describe("018 P1 remainders", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.describe.configure({ timeout: 180_000 });

  test("US1: /outcomes is honest — never the fabricated −$27.86 / fake proof links", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/outcomes", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(3500); // let the ledger fetch resolve
    const body = await page.locator("body").innerText();
    // The fabricated figures are gone.
    expect(body).not.toContain("27.86");
    // Either a real ledger (with a real explorer tx link) or an honest empty/pending state.
    const hasRealTxLink =
      (await page.locator("a.cite[href*='/tx/0x']").count()) > 0;
    const hasHonestEmpty =
      /No realized outcomes yet|still syncing|Connect your wallet|Loading your outcomes|Couldn't load/.test(body);
    expect(hasRealTxLink || hasHonestEmpty).toBeTruthy();
    // No dead proof links: every .cite must carry a real href (the old mock had none).
    const deadLinks = await page.locator("a.cite:not([href])").count();
    expect(deadLinks).toBe(0);
  });

  test("US2: the deposit confirm gate surfaces a real pre-sign dry-run row", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    // Same live-intent confirm route the P0 gate test drives.
    await page.goto("/confirm/deposit?assets=1000000", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(4000); // let the pre-sign checks render
    const body = await page.locator("body").innerText();
    // The new eth_call dry-run row must be wired into the gate — one of its states appears
    // (dry-running / passed / would-revert / approve-first). Not the old cosmetic setTimeout sim.
    const hasDryRun = /Dry-run|Dry-running|would revert|Approve first/i.test(body);
    expect(hasDryRun).toBeTruthy();
  });
});
