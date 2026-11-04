import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

import { signSession } from "../../src/lib/auth/session";
import {
  NEAR_TEST_ACCOUNT,
  installInjectedEvmIdentity,
  installNearWalletMock,
  nearMockCalls,
} from "./near-wallet-mock";

/**
 * 075 — NEAR wallet connect (Meteor first), end to end against a MOCKED agent and a MOCKED NEAR
 * wallet. No key exists anywhere, nothing is broadcast, and `/chat` is an SSE body we author.
 *
 * The session cookie is signed locally for a fixed public address (no EVM key needed): the NEAR
 * flow is independent of SIWE, which is exactly the property under test.
 *
 *   SESSION_SECRET                       (required; signs the mocked session)
 *   NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true (build-time; enables the injected mock)
 *   NEXT_PUBLIC_NEAR_PHASE_C_SIGN=true    (optional; exercises the sign-only step)
 */

const SESSION_SECRET = process.env.SESSION_SECRET;
const PHASE_C = process.env.NEXT_PUBLIC_NEAR_PHASE_C_SIGN === "true";
const SESSION_ADDRESS = "0x0000000000000000000000000000000000000001";

const NEAR_CROSSCHAIN = {
  type: "crosschain_quote",
  state: "preview",
  origin: {
    key: "base:USDC",
    chain: "base",
    chainLabel: "Base",
    symbol: "USDC",
    amount: "100",
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    evmChainId: 8453,
  },
  destination: {
    key: "near:wNEAR",
    chain: "near",
    chainLabel: "NEAR",
    symbol: "wNEAR",
    assetId: "nep141:wrap.near",
    addressKind: "near",
  },
  amountOut: "0.55",
  amountOutUsd: "99.12",
  amountInUsd: "100.00",
  minAmountOut: "0.5445",
  timeEstimateSec: 60,
  slippageBps: 100,
  feeNote: "Includes 1Click's 0.25% keyless routing fee.",
  quotedAt: "2026-11-04T00:00:00.000Z",
  expiresHint: "Quote expires in about 30 minutes.",
};

function rheaFirstDeposit(): unknown {
  const path = resolve(
    process.cwd(),
    "../../packages/shared/tests/fixtures/earn/earn-quote-rhea-first-deposit.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function setSessionCookie(page: Page): Promise<void> {
  const token = await signSession({ address: SESSION_ADDRESS, beta: true, admin: false });
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

function sse(blocks: unknown[]): string {
  return (
    blocks.map((block) => `event: block\ndata: ${JSON.stringify(block)}\n\n`).join("") +
    `event: done\ndata: ${JSON.stringify({ conversationId: "cnv_near", blockCount: blocks.length })}\n\n`
  );
}

async function dismissWhatsNew(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "What's new" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Got it" }).click().catch(() => {});
  }
}

async function signIn(page: Page): Promise<void> {
  await installInjectedEvmIdentity(page, SESSION_ADDRESS);
  await setSessionCookie(page);
  await page.goto("/connect", { waitUntil: "domcontentloaded" });
  // Connect the signing-free EVM identity so the agent hooks resolve an account. No SIWE
  // signature is needed: the session cookie was already signed server-side for this test.
  await page.locator(".walletrow").first().click();
  await page.waitForURL("**/verify", { timeout: 15_000 }).catch(() => undefined);
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await dismissWhatsNew(page);
}

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });
}

test.describe("075 NEAR wallet connect", () => {
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.describe.configure({ timeout: 120_000 });

  test("connect shows the account in the wallet UI and portfolio; disconnect clears it", async ({
    page,
  }) => {
    await installNearWalletMock(page);
    await signIn(page);

    const connect = page.getByTestId("near-wallet-connect");
    await expect(connect).toBeVisible();
    await connect.click();

    await expect(page.getByTestId("near-wallet-connected")).toContainText(NEAR_TEST_ACCOUNT);

    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("near-portfolio-account-id")).toHaveText(NEAR_TEST_ACCOUNT);
    await expect(page.getByTestId("near-portfolio-note")).toContainText("NEAR balances are coming soon");

    await page.getByTestId("near-wallet-disconnect").click();
    await expect(page.getByTestId("near-wallet-connect")).toBeVisible();
    await expect(page.getByTestId("near-portfolio-not-connected")).toBeVisible();

    const calls = await nearMockCalls(page);
    expect(calls.connect).toBeGreaterThan(0);
    expect(calls.disconnect).toBeGreaterThan(0);
    expect(calls.forbidden).toEqual([]);
  });

  test("a NEAR cross-chain destination prefills the connected account and stays editable", async ({
    page,
  }) => {
    await installNearWalletMock(page);
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Preview only — nothing is signed or sent." },
          NEAR_CROSSCHAIN,
        ]),
      }),
    );
    await signIn(page);
    await page.getByTestId("near-wallet-connect").click();
    await expect(page.getByTestId("near-wallet-connected")).toBeVisible();

    await page.locator(".composer textarea").fill("Swap 100 USDC into wNEAR on NEAR.");
    await page.locator(".sendbtn").click();

    const card = page.locator('[data-card="crosschain"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: "Continue" }).click();

    const recipient = card.getByTestId("cc-recipient");
    await expect(recipient).toHaveValue(NEAR_TEST_ACCOUNT);
    await expect(card.getByTestId("cc-recipient-near")).toContainText("connected NEAR wallet");

    await recipient.fill("someone-else.near");
    await expect(recipient).toHaveValue("someone-else.near");
  });

  test("the Rhea card names the connected NEAR account and sign-in is sign-only", async ({ page }) => {
    await installNearWalletMock(page);
    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "text", markdown: "Preview only — nothing is signed or sent." },
          rheaFirstDeposit(),
        ]),
      }),
    );
    await signIn(page);
    await page.getByTestId("near-wallet-connect").click();
    await expect(page.getByTestId("near-wallet-connected")).toBeVisible();

    await page.locator(".composer textarea").fill("Deposit 100 USDC into Rhea");
    await page.locator(".sendbtn").click();

    const quote = page.locator('[data-card="earn-quote"]');
    await expect(quote).toBeVisible({ timeout: 20_000 });
    await expect(quote.getByTestId("earn-rhea-near-account-value")).toHaveText(NEAR_TEST_ACCOUNT);
    await expect(quote.getByTestId("earn-rhea-near-account-source")).toContainText(
      "Using your connected NEAR wallet",
    );
    await expect(quote.getByTestId("earn-rhea-deposit-disabled")).toBeDisabled();

    if (PHASE_C) {
      await quote.getByTestId("earn-rhea-message").locator("summary").click();
      const sign = quote.getByTestId("earn-rhea-sign");
      await expect(sign).toBeEnabled();
      await sign.click();
      await expect(quote.getByTestId("earn-rhea-signature")).toContainText("not submitted");
      // Deposit stays disabled after signing — the signature authorises nothing on-chain.
      await expect(quote.getByTestId("earn-rhea-deposit-disabled")).toBeDisabled();
    } else {
      await expect(quote.getByTestId("earn-rhea-sign")).toHaveCount(0);
    }

    const calls = await nearMockCalls(page);
    expect(calls.signMessage).toBe(PHASE_C ? 1 : 0);
    expect(calls.forbidden).toEqual([]);
  });

  test("portfolio multichain read is untouched by the NEAR claim (no address is sent)", async ({
    page,
  }) => {
    await installNearWalletMock(page);
    const seen: string[] = [];
    await page.route("**/api/agent/portfolio/multichain*", async (route) => {
      seen.push(route.request().url());
      await json(route, { type: "portfolio_overview", state: "empty" });
    });
    await signIn(page);
    await page.getByTestId("near-wallet-connect").click();
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("near-portfolio-account-id")).toBeVisible();
    // No wallet/address query parameter was added because a NEAR wallet exists.
    for (const url of seen) {
      expect(new URL(url).searchParams.has("wallet")).toBe(false);
      expect(new URL(url).searchParams.has("address")).toBe(false);
      expect(new URL(url).searchParams.has("near")).toBe(false);
    }
  });
});
