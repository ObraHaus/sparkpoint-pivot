import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { signSession } from "../../src/lib/auth/session";
import { installInjectedWallet } from "./injected-wallet";

/**
 * 059/A2 — the chat renders streamed prose BEFORE the full answer lands, then reconciles.
 *
 * FULLY MOCKED: `AGENT_INTERNAL_URL` points at `e2e/pw/mock-agent-sse.mjs` (a local SSE server),
 * so this never touches the beta agent or the LLM. Auth is a locally-signed session cookie
 * (SESSION_SECRET) + the fake injected wallet from the other e2e specs. The BFF is exercised for
 * real, including its SSE passthrough.
 *
 * The assertion that matters: the first `[data-streaming="true"]` text is visible in under 2.5s,
 * and once the authoritative `text` block arrives the provisional paint is GONE and the final
 * text is exactly the block's text (a guardrail/clamp rewrite would replace it).
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MOCK_AGENT = process.env.PW_MOCK_AGENT === "1";
const STREAM_TEXT = "Hello from the streamed answer.";

async function setSessionCookie(page: Page): Promise<void> {
  const account = privateKeyToAccount(PRIV!);
  const token = await signSession({ address: account.address, beta: true, admin: false });
  expect(token, "SESSION_SECRET must be set for the mocked chat e2e").toBeTruthy();
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

async function dismissWhatsNew(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "What's new" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Got it" }).click().catch(() => {});
    await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}

test.describe("059 chat streaming", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.skip(!SESSION_SECRET, "SESSION_SECRET not set (the mocked session needs it)");
  test.skip(
    !MOCK_AGENT,
    "PW_MOCK_AGENT=1 not set — start e2e/pw/mock-agent-sse.mjs and point AGENT_INTERNAL_URL at it",
  );
  test.describe.configure({ timeout: 120_000 });

  test("first token paints in <2.5s and the final block reconciles", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
    await setSessionCookie(page);

    // Connect the injected wallet (no SIWE — the session cookie above is already valid).
    await page.goto("/connect", { waitUntil: "domcontentloaded" });
    const sessionProbe = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      return { status: res.status, body: await res.json() };
    });
    expect(sessionProbe.body.session, `session probe: ${JSON.stringify(sessionProbe)}`).not.toBeNull();
    // The injected provider auto-connects, which advances /connect → /verify; click only if the
    // row is still there (a race with that redirect is expected and harmless).
    const walletRow = page.locator(".walletrow").first();
    if (await walletRow.isVisible().catch(() => false)) {
      await walletRow.click({ timeout: 3_000 }).catch(() => {});
    }
    await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await dismissWhatsNew(page);
    const composer = page.getByPlaceholder(/Ask about your wallet/i);
    await composer.waitFor({ state: "visible", timeout: 20_000 });
    await composer.fill("hi");

    const started = Date.now();
    await page.locator("button.sendbtn").click();

    const streaming = page.locator('[data-streaming="true"]').last();
    await expect(streaming).toBeVisible({ timeout: 2_500 });
    const firstTokenMs = Date.now() - started;
    expect(firstTokenMs).toBeLessThan(2_500);

    // The final authoritative block replaces the provisional paint.
    await expect(page.locator(".cturn.ai").last()).toContainText(STREAM_TEXT, { timeout: 10_000 });
    await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 10_000 });
  });
});
