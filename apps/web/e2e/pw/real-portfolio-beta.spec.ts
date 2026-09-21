import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installBroadcastingWallet } from "./broadcasting-wallet";

/**
 * REAL beta portfolio e2e (spec 053 verification) — drives beta.sparkpoint.io with the funded smoke
 * wallet and verifies the surfaces the 053 fix targeted: a real net worth at $1 par, the idle USDG
 * row with its CTA, a data-driven allocation, the known-token wallet list, and NO false
 * "AI vault isn't in the beta" copy. Read-only (no broadcasts), but still gated because it needs a
 * beta-allowlisted wallet: PW_REAL_PORTFOLIO=1 + PW_TEST_PRIVKEY.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const RPC = process.env.PW_ROBINHOOD_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";

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

test.describe("REAL beta portfolio e2e · chain 4663", () => {
  test.skip(!PRIV || process.env.PW_REAL_PORTFOLIO !== "1", "gated (PW_REAL_PORTFOLIO=1 + PW_TEST_PRIVKEY)");
  test.setTimeout(180_000);

  test("portfolio shows the wallet's real funds, not a network placeholder", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
    page.on("response", (res) => {
      if (res.status() >= 400) console.log(`HTTP ${res.status()} ${res.url().replace("https://beta.sparkpoint.io", "")}`);
    });

    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);

    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    // Wait for the live reads to settle (the idle row renders only once the chain reads are in).
    await expect(page.getByText(/Idle USDG/i).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "/tmp/opencode/e2e-portfolio-idle.png", fullPage: true });
    const text = await page.locator("body").innerText();
    console.log("PORTFOLIO TEXT:\n" + text.slice(0, 3000));

    // 053 acceptance: the false placeholder is gone and the funds are visible.
    await expect(page.getByText(/AI vault isn’t in the beta/i)).toHaveCount(0);
    await expect(page.getByText(/Connect your wallet to see your portfolio/i)).toHaveCount(0);
    await expect(page.getByText(/Put it to work/i).first()).toBeVisible();
    // Net worth must be a real figure (the wallet holds ~0.79 USDG) — not an em dash.
    const netWorth = await page.locator(".pf-net").first().innerText();
    console.log("NET WORTH:", netWorth);
    expect(netWorth.trim()).not.toBe("—");
    expect(netWorth).toMatch(/0\.7[0-9]|0\.8[0-9]/);

    // The wallet-token card lists the chain's known tokens (USDG at minimum).
    await expect(page.getByText("Wallet tokens")).toBeVisible();
    await expect(page.getByText(/USDG/).first()).toBeVisible();

    if (consoleErrors.length) {
      console.log("CONSOLE ERRORS (" + consoleErrors.length + "):\n" + consoleErrors.slice(0, 20).join("\n"));
    }
  });

  test("vault board renders the curated vault with a working deposit CTA", async ({ page }) => {
    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);
    await page.goto("/vault", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    const cta = page.getByRole("button", { name: /^Deposit USDG$/i }).first();
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await cta.click();
    await expect(page.getByText(/Amount to deposit/i)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "/tmp/opencode/e2e-vault-amount.png", fullPage: true });
  });
});
