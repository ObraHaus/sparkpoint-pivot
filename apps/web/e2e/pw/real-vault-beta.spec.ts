import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installBroadcastingWallet } from "./broadcasting-wallet";

/**
 * REAL beta vault e2e (spec 053 verification) — drives beta.sparkpoint.io with a funded test wallet:
 * sign in → Vault board → deposit USDG into the curated wrapper → confirm the Portfolio shows the
 * position. Signs AND broadcasts genuine transactions (approve + deposit), so it is GATED:
 *   PW_REAL_VAULT=1 + PW_TEST_PRIVKEY (a beta-allowlisted, funded 4663 wallet).
 * Target the deployed app with PW_BASE_URL=https://beta.sparkpoint.io PW_NO_SERVER=1.
 *
 * Observations (console errors, portfolio text) are printed, not asserted away — this is a
 * verification run; product fixes are out of scope.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const RPC = process.env.PW_ROBINHOOD_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const AMOUNT = process.env.PW_VAULT_AMOUNT || "0.4";

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

test.describe("REAL beta vault e2e · chain 4663", () => {
  test.skip(!PRIV || process.env.PW_REAL_VAULT !== "1", "gated (PW_REAL_VAULT=1 + PW_TEST_PRIVKEY)");
  test.setTimeout(420_000);

  test("deposit through the UI, then verify the portfolio", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api/agent/")) {
        const status = res.status();
        if (status >= 400) {
          const body = await res.text().catch(() => "");
          console.log(`AGENT ${status} ${url.replace("https://beta.sparkpoint.io", "")} :: ${body.slice(0, 400)}`);
        } else {
          console.log(`AGENT ${status} ${url.replace("https://beta.sparkpoint.io", "")}`);
        }
      }
    });

    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);

    await test.step("vault board → deposit CTA", async () => {
      await page.goto("/vault", { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      await page.screenshot({ path: "/tmp/opencode/e2e-vault-board.png", fullPage: true });
      const boardText = (await page.locator("body").innerText()).slice(0, 1500);
      console.log("VAULT BOARD TEXT:\n" + boardText);
      const cta = page.getByRole("button", { name: /^Deposit USDG$/i }).first();
      await expect(cta).toBeVisible({ timeout: 30_000 });
      await cta.click();
      await expect(page.getByText(/Amount to deposit/i)).toBeVisible({ timeout: 30_000 });
    });

    await test.step("amount → review", async () => {
      await page.screenshot({ path: "/tmp/opencode/e2e-amount.png", fullPage: true });
      const input = page.locator('input[placeholder="0.00"]').first();
      await input.fill(AMOUNT);
      await expect(page.getByText(/Review deposit/i)).toBeVisible({ timeout: 15_000 });
      console.log("AMOUNT SCREEN TEXT:\n" + (await page.locator("body").innerText()).slice(0, 1600));
      const review = page.getByRole("button", { name: /Review deposit/i });
      await expect(review).toBeEnabled({ timeout: 30_000 });
      await review.click();
      await expect(page.getByText(/Confirm: Deposit/i)).toBeVisible({ timeout: 30_000 });
    });

    await test.step("sign deposit (approve + deposit broadcast)", async () => {
      await page.screenshot({ path: "/tmp/opencode/e2e-confirm.png", fullPage: true });
      console.log("CONFIRM TEXT:\n" + (await page.locator("body").innerText()).slice(0, 1800));
      const ack = page.locator('input[type="checkbox"]');
      if (await ack.count()) await ack.first().check().catch(() => {});
      const sign = page.getByRole("button", { name: /Sign deposit/i });
      try {
        await expect(sign).toBeEnabled({ timeout: 60_000 });
      } catch (e) {
        console.log("SIGN GATE FAILED — confirm text:\n" + (await page.locator("body").innerText()).slice(0, 2500));
        throw e;
      }
      await sign.click();
      await expect(page.getByText(/Deposit confirmed/i)).toBeVisible({ timeout: 300_000 });
      const href = await page.getByRole("link", { name: /View transaction/i }).first().getAttribute("href");
      console.log("DEPOSIT TX:", href);
      await page.screenshot({ path: "/tmp/opencode/e2e-confirmed.png", fullPage: true });
    });

    await test.step("portfolio shows the wrapper position", async () => {
      await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
      await dismissWhatsNew(page);
      await expect(page.getByText(/Steakhouse/i).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Idle USDG/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/AI vault isn’t in the beta/i)).toHaveCount(0);
      await page.screenshot({ path: "/tmp/opencode/e2e-portfolio.png", fullPage: true });
      console.log("PORTFOLIO TEXT:\n" + (await page.locator("body").innerText()).slice(0, 2500));
    });

    if (consoleErrors.length) {
      console.log("CONSOLE ERRORS (" + consoleErrors.length + "):\n" + consoleErrors.slice(0, 20).join("\n"));
    }
  });
});
