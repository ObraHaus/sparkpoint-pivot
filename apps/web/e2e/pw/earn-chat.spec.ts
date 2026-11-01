import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signSession } from "../../src/lib/auth/session";
import { installInjectedWallet } from "./injected-wallet";

/**
 * 069 — the Morpho earn cards, end to end against a MOCKED agent.
 *
 * No test here touches beta, the real agent, Morpho or 1Click: `/chat` is an SSE body we author,
 * and the card fixtures are the SAME JSON documents the Python/TS contract tests pin. The real
 * card, BFF, schema validation and React state run.
 *
 *   PW_TEST_PRIVKEY=<throwaway key>   (otherwise the spec skips)
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const SESSION_SECRET = process.env.SESSION_SECRET;

function fixture(name: string): unknown {
  const path = resolve(
    process.cwd(),
    `../../packages/shared/tests/fixtures/earn/${name}`,
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

const VAULTS = fixture("earn-vaults-list.json");
const QUOTE = fixture("earn-quote-preview-oneclick.json");
const UNAVAILABLE = fixture("earn-quote-unavailable.json");

async function setSessionCookie(page: Page): Promise<void> {
  const account = privateKeyToAccount(PRIV!);
  const token = await signSession({ address: account.address, beta: true, admin: false });
  expect(token, "SESSION_SECRET must be set for the mocked session").toBeTruthy();
  await page.context().addCookies([
    {
      name: "sp_session",
      value: token!,
      url: process.env.PW_BASE_URL || "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
}

async function signIn(page: Page): Promise<void> {
  await setSessionCookie(page);
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const body = (await res.json()) as { session?: unknown };
      return body.session != null;
    },
    null,
    { timeout: 20_000 },
  );
  const walletRow = page.locator(".walletrow").first();
  if (await walletRow.isVisible().catch(() => false)) {
    await walletRow.click({ timeout: 3_000 }).catch(() => {});
  }
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

function sse(blocks: unknown[], conversationId = "cnv_earn"): string {
  return (
    blocks.map((block) => `event: block\ndata: ${JSON.stringify(block)}\n\n`).join("") +
    `event: done\ndata: ${JSON.stringify({ conversationId, blockCount: blocks.length })}\n\n`
  );
}

async function dismissWhatsNew(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "What's new" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Got it" }).click().catch(() => {});
  }
}

test.describe("069 Morpho earn chat cards", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000 });

  test("vault list renders rows, rails and a non-signable preview", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });

    let calls = 0;
    await page.route("**/api/agent/chat", (route) => {
      calls += 1;
      const blocks =
        calls === 1
          ? [{ type: "text", markdown: "Here are the top Morpho vaults on Base." }, VAULTS]
          : [
              { type: "text", markdown: "Preview only — nothing is signed or sent." },
              QUOTE,
            ];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse(blocks),
      });
    });

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Show Morpho vaults on Base");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-vaults"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card.getByTestId("earn-snapshot")).toContainText("data from Morpho API, 12 min ago");

    const rows = card.getByTestId("earn-vault-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText("Gauntlet USDC Prime");
    await expect(rows.first()).toContainText("Base");
    await expect(rows.first()).toContainText("USDC");
    await expect(rows.first()).toContainText("$420M");
    await expect(rows.first()).toContainText("net APY (Morpho)");
    await expect(rows.first()).toContainText("4.41%");
    await expect(rows.first().locator('[data-rail="direct"]')).toContainText("Direct");
    await expect(rows.first().locator('[data-rail="oneclick_earn"]')).toContainText("1Click Earn live");
    await expect(rows.first().locator('[data-rail="intents_connect"]')).toContainText("needs key");

    await expect(rows.nth(1).locator('[data-rail="oneclick_earn"]')).toContainText("no liquidity");
    await expect(rows.nth(3)).toContainText("—");

    const link = rows.first().getByTestId("earn-vault-link");
    await expect(link).toHaveAttribute(
      "href",
      "https://app.morpho.org/base/vault/0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const preview = rows.first().getByTestId("earn-vault-preview");
    await expect(preview).toBeVisible();
    await preview.click();
    await expect(page.locator(".cbubble-user").last()).toHaveText(
      "Deposit 100 USDC into Morpho Gauntlet USDC Prime on Base",
    );

    const quote = page.locator('[data-card="earn-quote"]');
    await expect(quote).toBeVisible({ timeout: 20_000 });
    await expect(quote).toHaveAttribute("data-state", "preview");
    await expect(quote).toHaveAttribute("data-rail", "oneclick_earn");
    await expect(quote.getByTestId("earn-quote-amount-out")).toContainText("89.146629 gtUSDCp");
    await expect(quote).toContainText("Includes 1Click's 0.25% keyless routing fee.");
    await expect(quote.getByTestId("earn-quote-receipt-note")).toContainText(
      "not the native Morpho vault share",
    );
    await expect(quote).toContainText("Mainnet funds");
    await expect(quote.getByTestId("earn-quote-not-signable")).toContainText("Not signable");
    await expect(quote.getByRole("button")).toHaveCount(0);
  });

  test("an unavailable preview states the reason and offers no action", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "I can't preview that vault right now." },
          UNAVAILABLE,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page
      .locator(".composer textarea")
      .fill("Deposit 100 USDC into Morpho Gauntlet USDC Prime on Base");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-quote"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "unavailable");
    await expect(card.getByTestId("earn-quote-unavailable")).toContainText("No liquidity available");
    await expect(card.getByRole("button")).toHaveCount(0);
  });
});
