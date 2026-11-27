import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signSession } from "../../src/lib/auth/session";
import { installInjectedWallet } from "./injected-wallet";

/**
 * 072 — the read-only multi-chain portfolio card, end to end against a MOCKED agent.
 *
 * No test here touches beta, the real agent, any RPC or the database: `/chat` is an SSE body we
 * author, and the card fixtures are the SAME JSON documents the Python/TS contract tests pin. The
 * real card, BFF, schema validation and React state run.
 *
 *   PW_TEST_PRIVKEY=<throwaway key>   (otherwise the spec skips)
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const SESSION_SECRET = process.env.SESSION_SECRET;

function fixture(name: string): unknown {
  const path = resolve(
    process.cwd(),
    `../../packages/shared/tests/fixtures/portfolio/${name}`,
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

const READY = fixture("portfolio-overview-ready.json") as Record<string, unknown>;
const DEGRADED = fixture("portfolio-overview-degraded.json");

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

function sse(blocks: unknown[], conversationId = "cnv_portfolio"): string {
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

async function ask(page: Page, prompt: string): Promise<void> {
  await page.locator(".composer textarea").fill(prompt);
  await page.locator(".sendbtn").click();
}

test.describe("072 multi-chain portfolio chat card", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000, retries: 1 });

  test("Show my portfolio renders every section, totals and the read-only footer", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Here is your portfolio across chains — read-only." },
          READY,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    await ask(page, "Show my portfolio");

    const card = page.locator('[data-card="portfolio-overview"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card).toHaveAttribute("data-focus", "all");
    await expect(card).toContainText("Your multi-chain portfolio");

    await expect(card.getByTestId("portfolio-totals")).toContainText("$2,300.00");
    await expect(card.getByTestId("portfolio-breakdown-chain").first()).toContainText("Base");
    await expect(card.getByTestId("portfolio-breakdown-chain").nth(1)).toContainText("NEAR");
    await expect(card.getByTestId("portfolio-breakdown-protocol")).toHaveCount(3);

    const balances = card.getByTestId("portfolio-section-balances");
    await expect(balances).toHaveAttribute("data-status", "ok");
    await expect(balances.getByTestId("portfolio-balance-row")).toHaveCount(2);
    await expect(balances).toContainText("ETH");
    await expect(balances).toContainText("USDC");
    await expect(balances.getByTestId("portfolio-chain-status")).toContainText("not configured");

    const morpho = card.getByTestId("portfolio-section-morpho");
    await expect(morpho).toContainText("Gauntlet USDC Prime");
    await expect(morpho.getByTestId("portfolio-protocol-badge")).toHaveAttribute("data-protocol", "morpho");
    await expect(morpho).toContainText("4.41% net APY");

    const kamino = card.getByTestId("portfolio-section-kamino");
    await expect(kamino).toContainText("SOL Balanced");
    await expect(kamino.getByTestId("portfolio-protocol-badge")).toHaveAttribute("data-protocol", "kamino");
    await expect(kamino).toContainText("Solana");
    await expect(kamino).toContainText("4.45% net APY");

    const rhea = card.getByTestId("portfolio-section-rhea");
    await expect(rhea).toContainText("Rhea Lending supply");
    await expect(rhea).toContainText("14.05% supply APY");
    const withdraw = rhea.getByTestId("portfolio-rhea-withdraw");
    await expect(withdraw).toHaveAttribute("href", "https://app.rhea.finance/lending");
    await expect(withdraw).toHaveAttribute("target", "_blank");
    await expect(withdraw).toHaveAttribute("rel", "noopener noreferrer");

    const swaps = card.getByTestId("portfolio-section-swaps");
    await expect(swaps.getByTestId("portfolio-swap-row")).toHaveCount(2);
    await expect(swaps).toContainText("Base USDC -> Solana USDC");
    await expect(swaps.getByTestId("portfolio-swap-status").first()).toContainText("Completed");
    await expect(swaps.getByTestId("portfolio-deposit-address").first()).toHaveText("0xabab…abab");
    await expect(swaps.getByTestId("portfolio-copy-address").first()).toBeVisible();
    await expect(swaps).toContainText("1 day ago");

    await expect(card.getByTestId("portfolio-source")).toContainText("Sources: rpc");
    await expect(card.getByTestId("portfolio-source")).toContainText("as of");
    await expect(card).toContainText("Read-only — nothing here moves funds.");
    await expect(card.getByRole("button", { name: /^(sign|confirm|deposit)/i })).toHaveCount(0);
  });

  test("a degraded read shows Kamino not_linked and an empty swap history", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Some sources couldn't be read — here is what I have." },
          DEGRADED,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    await ask(page, "Show my portfolio");

    const card = page.locator('[data-card="portfolio-overview"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");

    const morpho = card.getByTestId("portfolio-section-morpho");
    await expect(morpho).toHaveAttribute("data-status", "unavailable");
    await expect(morpho.getByTestId("portfolio-section-morpho-degraded")).toContainText(
      "Morpho API is unreachable.",
    );

    const kamino = card.getByTestId("portfolio-section-kamino");
    await expect(kamino).toHaveAttribute("data-status", "not_linked");
    await expect(kamino.getByTestId("portfolio-section-kamino-degraded")).toContainText(
      "Kamino positions show once a Solana address is linked to your account",
    );

    const rhea = card.getByTestId("portfolio-section-rhea");
    await expect(rhea).toHaveAttribute("data-status", "unavailable");
    await expect(rhea).toContainText("NEAR RPC read is unavailable");

    const swaps = card.getByTestId("portfolio-section-swaps");
    await expect(swaps).toHaveAttribute("data-status", "ok");
    await expect(swaps.getByTestId("portfolio-section-swaps-empty")).toContainText(
      "don't have any cross-chain swaps yet",
    );

    await expect(card.getByTestId("portfolio-totals")).toContainText("$250.00");
    await expect(card).toContainText("Read-only — nothing here moves funds.");
  });

  test("my swap history renders the swaps-focused card", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Here are your most recent cross-chain swaps." },
          { ...READY, focus: "swaps" },
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    await ask(page, "my swap history");

    const card = page.locator('[data-card="portfolio-overview"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-focus", "swaps");
    await expect(card).toContainText("Your swap history");

    const swaps = card.getByTestId("portfolio-section-swaps");
    await expect(swaps.getByTestId("portfolio-swap-row")).toHaveCount(2);
    await expect(swaps).toContainText("Base USDC -> Solana USDC");
    await expect(swaps).toContainText("Base USDC -> NEAR USDC");
    await expect(card.getByTestId("portfolio-source")).toContainText("db");
    await expect(card).toContainText("Read-only — nothing here moves funds.");
  });
});
