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
      const url = res.url();
      if (url.includes("/api/agent/")) {
        console.log(`HTTP ${res.status()} ${url.replace("https://beta.sparkpoint.io", "")}`);
      }
    });

    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);

    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    // Wait for the live reads to settle (the idle row renders only once the chain reads are in).
    await expect(page.getByText(/Idle USDG/i).first()).toBeVisible({ timeout: 30_000 });
    // PnL + the value history come from the agent read (a separate, slower call) — wait for the
    // agent-driven state before capturing, so the snapshot shows what the page converges to.
    await expect(page.getByText(/unrealized|Real position-value history/i).first())
      .toBeVisible({ timeout: 30_000 })
      .catch(() => {});
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
    // A real positive figure (the wallet holds idle USDG + a wrapper position).
    const net = Number(netWorth.replace(/[^0-9.]/g, ""));
    expect(Number.isFinite(net) && net > 0.1).toBe(true);

    // The wallet-token card lists the chain's known tokens (USDG at minimum).
    await expect(page.getByText("Wallet tokens")).toBeVisible();
    await expect(page.getByText(/USDG/).first()).toBeVisible();

    // 053 follow-up — the held wrapper row routes to its withdraw screen.
    await expect(page.getByRole("link", { name: /^Withdraw$/i }).first()).toBeVisible();

    if (consoleErrors.length) {
      console.log("CONSOLE ERRORS (" + consoleErrors.length + "):\n" + consoleErrors.slice(0, 20).join("\n"));
    }
  });

  test("vault board offers deposit AND withdraw to a holder", async ({ page }) => {
    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);
    await page.goto("/vault", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    // The deposit CTA still works.
    const cta = page.getByRole("button", { name: /^Deposit USDG$/i }).first();
    await expect(cta).toBeVisible({ timeout: 30_000 });

    // 053 follow-up — a holder sees a Withdraw action ON THE CARD (not only via Trust & Exit).
    const withdrawBtn = page.getByRole("button", { name: /^Withdraw/i }).first();
    await expect(withdrawBtn).toBeVisible({ timeout: 30_000 });
    console.log("CARD WITHDRAW BUTTON:", await withdrawBtn.innerText());
    await page.screenshot({ path: "/tmp/opencode/e2e-vault-board-holder.png", fullPage: true });
    await withdrawBtn.click();

    // …which lands on the withdraw screen with the wrapper selected and honest copy.
    await expect(page.getByText(/Amount to withdraw/i)).toBeVisible({ timeout: 30_000 });
    await page.locator('input[placeholder="0.00"]').first().fill("0.05");
    const rows = await page.locator(".preview-row").allInnerTexts();
    console.log("WITHDRAW PREVIEW ROWS:\n" + rows.join("\n"));
    const receive = rows.find((r) => /You'll receive/i.test(r)) ?? "";
    expect(receive).toMatch(/USDG/); // never "USDC" on a USDG chain
    const redeem = rows.find((r) => /You'll redeem/i.test(r)) ?? "";
    expect(redeem).not.toMatch(/0\.0$/); // small amounts must not round to zero
    await page.screenshot({ path: "/tmp/opencode/e2e-withdraw-amount.png", fullPage: true });
  });
});
