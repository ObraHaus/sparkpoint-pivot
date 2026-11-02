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
const KAMINO_VAULTS = fixture("earn-vaults-kamino.json");
const KAMINO_QUOTE = fixture("earn-quote-kamino-preview.json");
const KAMINO_SOL_QUOTE = fixture("earn-quote-kamino-preview-sol-origin.json");
const KAMINO_UNAVAILABLE = fixture("earn-quote-kamino-unavailable.json");
const RHEA_VAULTS = fixture("earn-vaults-rhea.json");
const RHEA_FIRST_DEPOSIT = fixture("earn-quote-rhea-first-deposit.json");
const RHEA_POSITIONS = fixture("earn-positions-rhea.json");

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


test.describe("070 Kamino SOL earn chat cards", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000 });

  test("Kamino vault list renders native shares and a Solana recipient step", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });

    let calls = 0;
    await page.route("**/api/agent/chat", (route) => {
      calls += 1;
      const blocks =
        calls === 1
          ? [{ type: "text", markdown: "Here is the Kamino SOL vault." }, KAMINO_VAULTS]
          : [{ type: "text", markdown: "Preview only — nothing is signed or sent." }, KAMINO_QUOTE];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse(blocks),
      });
    });

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Show Kamino vaults");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-vaults"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card.getByTestId("earn-snapshot")).toContainText("data from Kamino API, 3 min ago");
    await expect(card).toContainText("Kamino vaults");

    const rows = card.getByTestId("earn-vault-row");
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText("SOL Balanced");
    await expect(row.getByTestId("earn-protocol")).toHaveText("Kamino");
    await expect(row.getByTestId("earn-protocol")).toHaveAttribute("data-protocol", "kamino");
    await expect(row).toContainText("Solana");
    await expect(row).toContainText("SOL");
    await expect(row).toContainText("$2.4M");
    await expect(row).toContainText("net APY (Kamino)");
    await expect(row).toContainText("4.45%");
    await expect(row.getByTestId("earn-receipt-kind")).toContainText("native vault shares");
    await expect(row.locator('[data-rail="oneclick_earn"]')).toContainText("1Click Earn live");
    await expect(row.getByTestId("earn-vault-link")).toHaveCount(0);

    await row.getByTestId("earn-vault-preview").click();
    await expect(page.locator(".cbubble-user").last()).toHaveText(
      "Deposit 100 SOL into Kamino SOL Balanced on Solana",
    );

    const quote = page.locator('[data-card="earn-quote"]');
    await expect(quote).toBeVisible({ timeout: 20_000 });
    await expect(quote).toHaveAttribute("data-state", "preview");
    await expect(quote).toHaveAttribute("data-protocol", "kamino");
    await expect(quote).toHaveAttribute("data-receipt-kind", "native_shares");
    await expect(quote).toContainText("Kamino earn preview");
    await expect(quote.getByTestId("earn-quote-amount-out")).toContainText("0.9835 kV-gtSOLb");
    await expect(quote.getByTestId("earn-quote-receipt-kind")).toContainText("native Kamino shares");
    await expect(quote).toContainText("under a minute");
    await expect(quote).toContainText("Includes 1Click's 0.25% keyless routing fee.");
    await expect(quote.getByTestId("earn-quote-receipt-note")).toContainText(
      "native Kamino kVault share",
    );

    const recipient = quote.getByTestId("earn-recipient-step");
    await expect(recipient).toBeVisible();
    const input = quote.getByTestId("earn-sol-recipient");

    await input.fill("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    await expect(quote.getByTestId("earn-recipient-error")).toContainText("EVM address");
    await expect(quote.getByTestId("earn-recipient-error")).toContainText("base58 Solana address");

    await input.fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await expect(quote.getByTestId("earn-recipient-valid")).toContainText("Valid Solana address");
    await expect(quote.getByTestId("earn-recipient-error")).toHaveCount(0);

    const evmPath = quote.getByTestId("earn-deposit-evm-wallet");
    await expect(evmPath).toBeVisible();
    await expect(evmPath.getByTestId("earn-deposit-disabled")).toBeDisabled();
    await expect(evmPath).toContainText("Live deposits coming soon (phase C)");
    await expect(quote.getByTestId("earn-quote-not-signable")).toContainText("Not signable");
  });

  test("a SOL-origin Kamino preview shows the copy-address deposit explainer", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Preview only — nothing is signed or sent." },
          KAMINO_SOL_QUOTE,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Deposit 100 USDC into Kamino SOL vault");
    await page.locator(".sendbtn").click();

    const quote = page.locator('[data-card="earn-quote"]');
    await expect(quote).toBeVisible({ timeout: 20_000 });
    await expect(quote.getByTestId("earn-deposit-copy-address")).toContainText(
      "Send from your own Solana wallet (Phantom etc.)",
    );
    await expect(quote.getByTestId("earn-deposit-copy-address")).toContainText(
      "copy-address deposit, phase C",
    );
    await expect(quote.getByTestId("earn-deposit-evm-wallet")).toHaveCount(0);
    await expect(quote.getByTestId("earn-recipient-step")).toBeVisible();
  });

  test("a Kamino no-liquidity preview says to try a smaller amount", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "I can't preview that size right now." },
          KAMINO_UNAVAILABLE,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page
      .locator(".composer textarea")
      .fill("Deposit 10000 USDC into Kamino SOL vault");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-quote"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "unavailable");
    await expect(card.getByTestId("earn-quote-unavailable")).toContainText("No liquidity available");
    await expect(card.getByTestId("earn-quote-unavailable-hint")).toContainText("try a smaller amount");
    await expect(card.getByTestId("earn-recipient-step")).toHaveCount(0);
  });
});


test.describe("071 Rhea (Burrow) NEAR earn chat cards", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000 });

  test("Show Rhea vaults renders the Rhea list with a source link", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Here are the Rhea lending vaults on NEAR." },
          RHEA_VAULTS,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Show Rhea vaults");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-vaults"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card).toContainText("Rhea vaults");
    await expect(card.getByTestId("earn-snapshot")).toContainText("data from Rhea API, 4 min ago");

    const row = card.getByTestId("earn-vault-row").first();
    await expect(row).toContainText("Rhea Lending (NEAR) supply");
    await expect(row.getByTestId("earn-protocol")).toHaveText("Rhea");
    await expect(row.getByTestId("earn-protocol")).toHaveAttribute("data-protocol", "rhea");
    await expect(row).toContainText("NEAR");
    await expect(row).toContainText("USDC");
    await expect(row).toContainText("$12.7M");
    await expect(row).toContainText("net APY (Rhea)");
    await expect(row).toContainText("14.05%");
    await expect(row.locator('[data-rail="oneclick_rhea"]')).toContainText("1Click Rhea live");

    const source = row.getByTestId("earn-vault-source");
    await expect(source).toHaveAttribute("href", "https://app.rhea.finance/lending");
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");

    await row.getByTestId("earn-vault-preview").click();
    await expect(page.locator(".cbubble-user").last()).toHaveText(
      "Deposit 100 USDC into Rhea on NEAR",
    );
  });

  test("Deposit 100 USDC into Rhea renders the first-deposit fee, source and disabled deposit", async ({
    page,
  }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Preview only — nothing is signed or sent." },
          RHEA_FIRST_DEPOSIT,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Deposit 100 USDC into Rhea");
    await page.locator(".sendbtn").click();

    const quote = page.locator('[data-card="earn-quote"]');
    await expect(quote).toBeVisible({ timeout: 20_000 });
    await expect(quote).toHaveAttribute("data-state", "preview");
    await expect(quote).toHaveAttribute("data-rail", "oneclick_rhea");
    await expect(quote).toHaveAttribute("data-protocol", "rhea");
    await expect(quote).toContainText("Rhea earn preview");
    await expect(quote.getByTestId("earn-quote-amount-out")).toContainText("99.9808 USDC");

    await expect(quote.getByTestId("earn-rhea-rate")).toContainText(
      "Supply APY 14.05% (Rhea, variable)",
    );
    await expect(quote.getByTestId("earn-rhea-source")).toContainText(
      "Rhea contract.main.burrow.near get_asset.supply_apr, fetched",
    );
    await expect(quote.getByTestId("earn-rhea-source").locator("a")).toHaveAttribute(
      "href",
      "https://app.rhea.finance/lending",
    );

    await expect(quote.getByTestId("earn-rhea-one-time-fee")).toHaveText(
      "One-time Rhea account setup fee: 0.30 USDC (first deposit only)",
    );
    await expect(quote.getByTestId("earn-rhea-net-supplied")).toHaveText(
      "Net supplied ≈ 99.6808 USDC",
    );

    await expect(quote.getByTestId("earn-rhea-recipient-value")).toHaveText("multica.near");
    await expect(quote.getByTestId("earn-rhea-recipient")).toContainText(
      "derived from your connected wallet",
    );

    const message = quote.getByTestId("earn-rhea-message");
    await expect(message).toContainText(
      "Phase C: you will sign this message in your wallet to create your Rhea account",
    );
    await expect(message).toContainText("Display only");
    await expect(quote.getByTestId("earn-rhea-message-text")).toContainText('"EVM"');

    const deposit = quote.getByTestId("earn-rhea-deposit-disabled");
    await expect(deposit).toBeDisabled();
    await expect(quote.getByTestId("earn-rhea-deposit")).toContainText(
      "Live deposits coming soon (phase C)",
    );

    const withdraw = quote.getByTestId("earn-rhea-withdraw");
    await expect(withdraw).toContainText("Withdraw on Rhea");
    await expect(withdraw).toHaveAttribute("href", "https://app.rhea.finance/lending");
    await expect(withdraw).toHaveAttribute("target", "_blank");
    await expect(withdraw).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("Show my Rhea positions renders the positions card and Withdraw on Rhea link", async ({
    page,
  }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Your Rhea positions on NEAR — read-only." },
          RHEA_POSITIONS,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Show my Rhea positions");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="earn-positions"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card).toContainText("Your Rhea positions");
    await expect(card).toContainText("abc.multica.near");

    const row = card.getByTestId("earn-position-row").first();
    await expect(row).toContainText("USDC");
    await expect(row).toContainText("100 USDC");
    await expect(row).toContainText("14% supply APY");

    await expect(card.getByTestId("earn-positions-total")).toContainText("$100");
    await expect(card.getByTestId("earn-positions-source")).toContainText(
      "Rhea contract.main.burrow.near get_account_all_positions.supplied",
    );

    const withdraw = card.getByTestId("earn-positions-withdraw");
    await expect(withdraw).toContainText("Withdraw on Rhea");
    await expect(withdraw).toHaveAttribute("href", "https://app.rhea.finance/lending");
    await expect(withdraw).toHaveAttribute("target", "_blank");
    await expect(withdraw).toHaveAttribute("rel", "noopener noreferrer");
  });
});
