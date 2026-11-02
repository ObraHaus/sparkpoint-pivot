import { expect, test, type Page, type Route } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signSession } from "../../src/lib/auth/session";
import { installInjectedWallet } from "./injected-wallet";

/**
 * 068 — the cross-chain swap card, end to end against a MOCKED agent.
 *
 * No test here touches beta, the real agent or 1Click: `/chat` is an SSE body we author,
 * `/crosschain/quote` is a mocked live quote, and `/crosschain/status` moves
 * PENDING_DEPOSIT → SUCCESS. The real card, BFF, schema validation and React state machine run.
 *
 *   PW_TEST_PRIVKEY=<throwaway key>   (otherwise the spec skips)
 *
 * The quote fixture is the same document the Python/TS contract tests pin.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const SESSION_SECRET = process.env.SESSION_SECRET;

const PREVIEW = {
  type: "crosschain_quote",
  state: "preview",
  origin: {
    key: "base:USDC",
    chain: "base",
    chainLabel: "Base",
    symbol: "USDC",
    amount: "5000",
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    evmChainId: 8453,
  },
  destination: {
    key: "btc:BTC",
    chain: "btc",
    chainLabel: "Bitcoin",
    symbol: "BTC",
    assetId: "nep141:btc.omft.near",
    addressKind: "btc",
  },
  amountOut: "0.06439596",
  amountOutUsd: "4986.694350",
  amountInUsd: "5000.000000",
  minAmountOut: "0.063752",
  timeEstimateSec: 480,
  slippageBps: 100,
  feeNote: "Includes 1Click's 0.25% keyless routing fee.",
  quotedAt: "2026-11-01T00:19:48.065Z",
  expiresHint: "Quote expires in about 30 minutes.",
};

const UNAVAILABLE = {
  type: "crosschain_quote",
  state: "unavailable",
  origin: {
    key: "eth:USDT",
    chain: "eth",
    chainLabel: "Ethereum",
    symbol: "USDT",
    amount: "3000",
    assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",
    evmChainId: 1,
  },
  destination: {
    key: "tron:USDT",
    chain: "tron",
    chainLabel: "Tron",
    symbol: "USDT",
    assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
    addressKind: "tron",
  },
  slippageBps: 100,
  unavailableReason: "1Click is not quoting Tron payouts right now",
  quotedAt: "2026-11-01T00:19:48.065Z",
};

const DEPOSIT_ADDRESS = "0x1111111111111111111111111111111111111111";

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

/**
 * Establish a real session (signed locally) and let the injected wallet auto-connect. This is the
 * same pattern as `chat-streaming.spec.ts`; it deliberately avoids the SIWE `/verify` round trip so
 * the mocked agent is never needed just to reach `/chat`.
 */
async function signIn(page: Page): Promise<void> {
  await setSessionCookie(page);
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  // Wait until the locally-signed cookie is actually visible to the server session route before
  // judging the page — the gate renders "Verify it's you" for the frame before the hook resolves.
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

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });
}

function sse(blocks: unknown[]): string {
  return (
    blocks.map((block) => `event: block\ndata: ${JSON.stringify(block)}\n\n`).join("") +
    `event: done\ndata: ${JSON.stringify({ conversationId: "cnv_crosschain", blockCount: blocks.length })}\n\n`
  );
}

async function dismissWhatsNew(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "What's new" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Got it" }).click().catch(() => {});
  }
}

test.describe("068 cross-chain chat card", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000 });

  test("preview → recipient → confirm → deposit → live status", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });

    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Preview only — nothing is signed or sent." },
          PREVIEW,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Swap 5,000 USDC into native BTC.");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="crosschain"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("cc-preview")).toBeVisible();
    await expect(card).toContainText("You receive (est.)");
    await expect(card).toContainText("0.06439596 BTC");
    await expect(card).toContainText("Mainnet funds");
    await expect(card.getByRole("button", { name: "Continue" })).toBeVisible();

    await card.getByRole("button", { name: "Continue" }).click();
    await expect(card.getByTestId("cc-recipient-step")).toBeVisible();

    const recipient = card.getByTestId("cc-recipient");
    await recipient.fill("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    await expect(card.getByTestId("cc-refund-readonly")).toBeVisible();
    await card.getByRole("button", { name: "Review" }).click();

    await expect(card.getByTestId("cc-confirm")).toBeVisible();
    await card.getByTestId("cc-ack").check();

    await page.route("**/api/agent/crosschain/quote", async (route) => {
      await json(route, {
        ...PREVIEW,
        state: "live",
        depositAddress: DEPOSIT_ADDRESS,
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
        quoteId: 7,
      });
    });
    let statusCalls = 0;
    await page.route("**/api/agent/crosschain/status**", async (route) => {
      statusCalls += 1;
      await json(route, {
        status: statusCalls === 1 ? "PENDING_DEPOSIT" : "SUCCESS",
        depositAddress: DEPOSIT_ADDRESS,
        swapDetails: {},
      });
    });

    const quoteRequest = page.waitForRequest(
      (req) => req.url().includes("/api/agent/crosschain/quote") && req.method() === "POST",
    );
    await card.getByRole("button", { name: "Get deposit address" }).click();
    const body = (await quoteRequest).postDataJSON() as Record<string, unknown>;

    expect(body).toMatchObject({
      originKey: "base:USDC",
      destinationKey: "btc:BTC",
      amount: "5000",
      recipient: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      dry: false,
    });
    expect(typeof body.refundTo).toBe("string");
    expect(body.refundTo).toMatch(/^0x[0-9a-fA-F]{40}$/);

    await expect(card.getByTestId("cc-deposit")).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("cc-deposit-address")).toHaveText(DEPOSIT_ADDRESS);
    await expect(card.getByTestId("cc-status")).toHaveAttribute("data-status", "SUCCESS", {
      timeout: 20_000,
    });
    await expect(card).toContainText("Complete");
  });

  test("an unavailable route shows the reason and no action", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 8453 });
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "I can't quote that route right now." },
          UNAVAILABLE,
        ]),
      }),
    );

    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);

    await page.locator(".composer textarea").fill("Pay my supplier 3,000 USDT on Tron.");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="crosschain"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-state", "unavailable");
    await expect(card.getByTestId("cc-unavailable")).toContainText("Tron payouts");
    await expect(card.getByRole("button")).toHaveCount(0);
  });
});
