import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installBroadcastingWallet } from "./broadcasting-wallet";

/**
 * REAL beta chat e2e — drives the live assistant with a spread of questions and captures every
 * answer, so routing/quality regressions are visible. Read-only (no broadcasts). Gated:
 * PW_REAL_CHAT=1 + PW_TEST_PRIVKEY (a beta-allowlisted wallet).
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const RPC = process.env.PW_ROBINHOOD_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";

const QUESTIONS: string[] = process.env.PW_CHAT_QUESTIONS
  ? process.env.PW_CHAT_QUESTIONS.split("|").map((q) => q.trim()).filter(Boolean)
  : [
  "what are the vaults available right now?",
  "what's the best vault?",
  "what's in my wallet?",
  "show my portfolio",
  "explain vault shares",
  "how do you keep my funds safe?",
  "what's the vault paying now?",
  "what changed recently?",
  "can you withdraw my funds?",
  "swap 0.0005 ETH to USDG",
];

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

/**
 * Send one message and wait for THAT turn's answer, scoped to its own assistant turn (the thread
 * accumulates, so a thread-wide "last text" would read the previous answer).
 */
async function ask(page: Page, message: string): Promise<string> {
  const before = await page.locator(".cturn.ai").count();
  const composer = page.getByPlaceholder(/Ask about your wallet/i);
  await composer.click();
  await composer.fill(message);
  await page.locator("button.sendbtn").click();

  // A new assistant turn exists, and its thinking state has cleared.
  await expect
    .poll(async () => (await page.locator(".cturn.ai").count()) > before, { timeout: 300_000 })
    .toBe(true);
  const turn = page.locator(".cturn.ai").last();
  await turn.locator(".think").waitFor({ state: "hidden", timeout: 300_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const texts = await turn.locator(".ctext").allInnerTexts();
  const cards = await turn.locator(".ccard").allInnerTexts();
  return [...texts, ...cards.map((c) => `[CARD] ${c}`)].join("\n").slice(0, 1500);
}

test.describe("REAL beta chat e2e · chain 4663", () => {
  test.skip(!PRIV || process.env.PW_REAL_CHAT !== "1", "gated (PW_REAL_CHAT=1 + PW_TEST_PRIVKEY)");
  test.setTimeout(3_600_000);

  test("answers a spread of questions without losing the plot", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    await installBroadcastingWallet(page, { privateKey: PRIV!, chainId: 4663, rpcUrl: RPC });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    await expect(page.getByPlaceholder(/Ask about your wallet/i)).toBeVisible({ timeout: 30_000 });

    const answers = new Map<string, string>();
    for (const q of QUESTIONS) {
      const answer = await ask(page, q);
      answers.set(q, answer);
      console.log(`\n===== Q: ${q}\n${answer}\n`);
    }

    // The two bugs this suite was written for must stay fixed (when those questions ran).
    const vaultList = answers.get("what are the vaults available right now?");
    if (vaultList !== undefined) {
      expect(vaultList).toMatch(/Steakhouse/i);
      expect(vaultList).not.toMatch(/couldn't find a strategy/i);
    }
    const wallet = answers.get("what's in my wallet?");
    if (wallet !== undefined) {
      expect(wallet).toMatch(/USDG/);
      expect(wallet).not.toMatch(/idle USDC/i);
    }
    await page.screenshot({ path: "/tmp/opencode/e2e-chat-thread.png", fullPage: true });

    if (consoleErrors.length) {
      console.log("CONSOLE ERRORS (" + consoleErrors.length + "):\n" + consoleErrors.slice(0, 15).join("\n"));
    }
  });
});
