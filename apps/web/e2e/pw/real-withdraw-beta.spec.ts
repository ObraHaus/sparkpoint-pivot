import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installBroadcastingWallet } from "./broadcasting-wallet";

/**
 * REAL beta withdraw e2e — signs + broadcasts a genuine withdrawal from the curated wrapper via the
 * deep link the app exposes today (`/vault/withdraw?vault=<wrapper>`), then confirms the portfolio
 * updates. GATED: PW_REAL_WITHDRAW=1 + a funded PW_TEST_PRIVKEY with a wrapper position.
 *
 * This exists because the beta currently has NO in-app button to reach the withdraw screen for a
 * curated wrapper — only the URL — so the deep link is the only UI path to verify.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const RPC = process.env.PW_ROBINHOOD_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const WRAPPER = process.env.PW_WRAPPER || "0xd43FC69F019d1c1fd509Bd340B44E4aBb6F77cfE";
const AMOUNT = process.env.PW_WITHDRAW_AMOUNT || "0.1";

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "networkidle" });
  const link = page.locator("a:has-text('Sign in with wallet')");
  await link.waitFor({ state: "visible", timeout: 25_000 });
  await link.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

async function dismissWhatsNew(page: Page): Promise<void> {
  const d = page.getByRole("dialog", { name: "What's new" });
  await d.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  if (await d.isVisible().catch(() => false)) {
    await d.getByRole("button", { name: "Got it" }).click().catch(() => {});
    await d.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
  }
}

test.describe("REAL beta withdraw e2e · chain 4663", () => {
  test.skip(!PRIV || process.env.PW_REAL_WITHDRAW !== "1", "gated (PW_REAL_WITHDRAW=1 + PW_TEST_PRIVKEY)");
  test.setTimeout(420_000);

  test("withdraw from the curated wrapper via the deep link, then verify the portfolio", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);

    await test.step("withdraw screen via the deep link", async () => {
      await page.goto(`/vault/withdraw?vault=${WRAPPER}`, { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      await expect(page.getByText(/Amount to withdraw/i)).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: "/tmp/opencode/e2e-withdraw-amount.png", fullPage: true });
      console.log("WITHDRAW SCREEN:\n" + (await page.locator("body").innerText()).slice(0, 1500));
      const input = page.locator('input[placeholder="0.00"]').first();
      await input.fill(AMOUNT);
      const review = page.getByRole("button", { name: /Review withdrawal/i });
      await expect(review).toBeEnabled({ timeout: 30_000 });
      await review.click();
      await expect(page.getByText(/Confirm: Withdrawal/i)).toBeVisible({ timeout: 30_000 });
    });

    await test.step("sign withdrawal", async () => {
      await page.screenshot({ path: "/tmp/opencode/e2e-withdraw-confirm.png", fullPage: true });
      console.log("WITHDRAW CONFIRM:\n" + (await page.locator("body").innerText()).slice(0, 1800));
      const sign = page.getByRole("button", { name: /Sign withdrawal/i });
      try {
        await expect(sign).toBeEnabled({ timeout: 90_000 });
      } catch (e) {
        console.log("WITHDRAW GATE FAILED:\n" + (await page.locator("body").innerText()).slice(0, 2500));
        throw e;
      }
      await sign.click();
      await expect(page.getByText(/Withdrawal confirmed/i).first()).toBeVisible({ timeout: 300_000 });
      const href = await page.getByRole("link", { name: /View transaction/i }).first().getAttribute("href");
      console.log("WITHDRAW TX:", href);
      // The receipt must show the amount that was SIGNED — a full withdrawal zeroes the position,
      // and a receipt rebuilt from the live model read "$0.00 is back in your wallet".
      const receipt = await page.locator("body").innerText();
      const back = receipt.match(/\$[0-9,]+\.[0-9]{2} is back in your wallet/)?.[0] ?? "";
      console.log("RECEIPT:", back);
      expect(back).not.toBe("");
      expect(back).not.toMatch(/^\$0\.00 /);
    });

    await test.step("portfolio reflects the withdrawal", async () => {
      await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      await expect(page.getByText(/Steakhouse/i).first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(8_000);
      console.log("PORTFOLIO AFTER WITHDRAW:\n" + (await page.locator("body").innerText()).slice(0, 2200));
    });

    if (consoleErrors.length) {
      console.log("CONSOLE ERRORS (" + consoleErrors.length + "):\n" + consoleErrors.slice(0, 15).join("\n"));
    }
  });
});
