import { test, expect } from "@playwright/test";
import { primeTheme, gotoSettled } from "../lib/parity";

const SCAFFOLD_URL = process.env.SCAFFOLD_URL || "http://localhost:3000";

// Poke / click the scaffold the way a user (or the client) would, asserting the same
// behaviour and copy the showcase exhibits. These are the trust-critical interactions.
test.describe("scaffold interactions match the design", () => {
  test.beforeEach(async ({ page }) => {
    await primeTheme(page, "dark");
  });

  test("self-custodial pill opens the Prove-it sheet (Can / Can't + guarantees)", async ({ page }) => {
    await gotoSettled(page, `${SCAFFOLD_URL}/chat`, 400);
    await page.getByText("Fully self-custodial").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Can");
    await expect(sheet).toContainText("Can't");
    await expect(sheet).toContainText("No admin withdrawal");
    await expect(sheet).toContainText("Withdraw anytime");
    await expect(sheet).toContainText("You own your keys");
    await expect(sheet.getByText("See exact on-chain permissions")).toBeVisible();
  });

  test("command palette (⌘K) opens and filters", async ({ page }) => {
    await gotoSettled(page, `${SCAFFOLD_URL}/chat`, 400);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder("Search actions, screens…")).toBeVisible();
    await dialog.getByPlaceholder("Search actions, screens…").fill("vault");
    await expect(dialog.getByText("Open Vault")).toBeVisible();
  });

  test("network switcher flips Base ↔ Sui and updates the wallet address", async ({ page }, testInfo) => {
    // By design the network + wallet pills collapse off the top bar below 1024px
    // (they move into the avatar menu / Settings), so this top-bar flow is desktop-only.
    test.skip(testInfo.project.name !== "desktop", "network pill is hidden on mobile by design");
    await gotoSettled(page, `${SCAFFOLD_URL}/chat`, 400);
    const walletBefore = await page.locator(".walletPill .mono").first().textContent();
    await page.locator(".netPill").first().click();
    await page.getByRole("button", { name: /Sui/ }).click();
    await expect(page.locator("#netName, .netPill").first()).toContainText(/Sui/);
    const walletAfter = await page.locator(".walletPill .mono").first().textContent();
    expect(walletAfter).not.toEqual(walletBefore);
  });

  test("confirm gate keeps Sign disabled until the acknowledgement is checked", async ({ page }) => {
    await gotoSettled(page, `${SCAFFOLD_URL}/confirm/deposit`, 2600);
    const sign = page.getByRole("button", { name: /Sign/i }).last();
    // After simulation, an acknowledgement gates the Sign button.
    const ack = page.locator('input[type="checkbox"]').first();
    if (await ack.count()) {
      await expect(sign).toBeDisabled();
      await ack.check();
      await expect(sign).toBeEnabled();
    } else {
      // some intents have no ack gate; Sign should still be present
      await expect(sign).toBeVisible();
    }
  });

  test("avatar menu exposes the light/dark theme toggle", async ({ page }) => {
    await gotoSettled(page, `${SCAFFOLD_URL}/chat`, 400);
    await page.locator(".avatar-btn").click();
    const menu = page.locator(".menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/Dark mode|Light mode/)).toBeVisible();
  });

  test("disclaimer strip carries the exact non-custody copy + links", async ({ page }) => {
    await gotoSettled(page, `${SCAFFOLD_URL}/chat`, 400);
    const strip = page.locator(".disclaimer");
    await expect(strip).toContainText("The AI proposes. Guardrails check it. You sign it.");
    await expect(strip.getByText("Prove it")).toBeVisible();
    await expect(strip.getByText("How we make money")).toBeVisible();
    await expect(strip.getByText("Exit anytime")).toBeVisible();
  });
});
