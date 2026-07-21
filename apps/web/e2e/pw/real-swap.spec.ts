import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installBroadcastingWallet } from "./broadcasting-wallet";

/**
 * REAL on-chain swap e2e (feature 007) — signs AND broadcasts a genuine ETH→USDC swap from the deployed
 * app, moving testnet funds. GATED: runs only with PW_REAL_SWAP=1 + a funded PW_TEST_PRIVKEY (never in
 * normal CI). Parameterized by env so one process does one swap on one surface:
 *   PW_SWAP_CHAIN   = 84532 (Base Sepolia) | 46630 (Robinhood)
 *   PW_SWAP_SURFACE = swap | chat
 * Target the deployed app with PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const CHAIN = Number(process.env.PW_SWAP_CHAIN || "84532") as 84532 | 46630;
const SURFACE = (process.env.PW_SWAP_SURFACE || "swap") as "swap" | "chat";
const AMOUNT = process.env.PW_SWAP_AMOUNT || "0.0003";
const RPCS: Record<number, string> = {
  84532: process.env.PW_BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  46630: process.env.PW_ROBINHOOD_RPC || "https://rpc.testnet.chain.robinhood.com",
};

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "networkidle" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 25_000 });
  await signLink.click();
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

test.describe(`REAL swap · ${SURFACE} · chain ${CHAIN}`, () => {
  test.skip(!PRIV || process.env.PW_REAL_SWAP !== "1", "gated (set PW_REAL_SWAP=1 + a funded PW_TEST_PRIVKEY)");
  test.setTimeout(300_000);

  test(`signs + broadcasts a real ETH→USDC swap`, async ({ page }) => {
    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: CHAIN, rpcUrl: RPCS[CHAIN] });
    await signIn(page);

    if (SURFACE === "swap") {
      await page.goto("/swap", { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      await expect(page.getByText("You pay")).toBeVisible({ timeout: 25_000 });
      await page.locator(".field", { hasText: "You pay" }).locator("input").first().fill(AMOUNT);
    } else {
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      const composer = page.getByPlaceholder(/Ask about your wallet/i);
      await composer.click();
      await composer.fill(`swap ${AMOUNT} ETH to USDC`);
      await page.locator("button.sendbtn").click();
      // The assistant's block "Review swap" opens the inline swap card.
      await page.getByRole("button", { name: /Review swap/i }).first().click({ timeout: 150_000 });
      // Wait for the card to fully settle (its balance row appears once tokenIn resolved) so the async
      // init effect can't clobber the amount, then type it robustly (the agent's seed varies per run).
      await expect(page.getByText(/Balance:/i).last()).toBeVisible({ timeout: 30_000 });
      const cardInput = page.locator(".cf-card input").last();
      await cardInput.click();
      await cardInput.pressSequentially(AMOUNT, { delay: 60 });
      await expect(cardInput).toHaveValue(AMOUNT, { timeout: 10_000 });
    }

    // The swap form's "Review swap" → confirm screen (the card's is last in DOM order for chat).
    await page.getByRole("button", { name: /^Review swap$/i }).last().click({ timeout: 60_000 });

    // Sign + broadcast the REAL swap.
    await page.getByRole("button", { name: /Confirm & swap|Approve \+ Swap/i }).click({ timeout: 45_000 });

    // "Swap confirmed" renders ONLY after the on-chain receipt confirms success (useExecuteSwapTx).
    await expect(page.getByText(/Swap confirmed/i)).toBeVisible({ timeout: 240_000 });

    const href = await page.getByRole("link", { name: /View transaction/i }).first().getAttribute("href");
    console.log(`REAL_SWAP_OK chain=${CHAIN} surface=${SURFACE} tx=${href}`);
    expect(href).toBeTruthy();
  });
});
