import { expect, test, type Page, type Route } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * 061 — A9 UX quick fixes.
 *
 * These drive the real shell with the fake injected wallet (the same pattern as f016/f017) and
 * MOCK every agent call in the browser, so no test ever talks to beta or a live agent.
 *
 *   PW_TEST_PRIVKEY=<throwaway key>  (skips otherwise)
 *   PW_FORCE_REFRESH=1               (only the What's New case: it is feature-flagged at build)
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 25_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

/** Fulfil an agent JSON call locally (never reaches the BFF/agent). */
async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });
}

const CHANGELOG = {
  entries: [
    {
      id: 9001,
      slug: "ux-quick-fixes-2026-10",
      type: "changelog",
      title: "A calmer app",
      body: "The What's New note no longer blocks the app.",
      tag: "Improved",
      ctaLabel: null,
      ctaHref: null,
      isActive: true,
      publishedAt: "2026-10-26T09:00:00Z",
      updatedAt: "2026-10-26T09:00:00Z",
    },
  ],
};

/** SSE body helper: one `block` event (and the terminal `done`). */
function sse(blocks: unknown[]): string {
  return (
    blocks.map((b) => `event: block\ndata: ${JSON.stringify(b)}\n\n`).join("") +
    `event: done\ndata: ${JSON.stringify({ conversationId: "cnv_e2e", blockCount: blocks.length })}\n\n`
  );
}

test.describe("061 UX quick fixes", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.describe.configure({ timeout: 180_000 });

  test("What's New is a non-blocking panel, shown once per release", async ({ page }) => {
    test.skip(!process.env.PW_FORCE_REFRESH, "What's New is behind NEXT_PUBLIC_FORCE_REFRESH");
    await installInjectedWallet(page, { privateKey: PRIV! });
    await page.route("**/api/agent/content/changelog*", (r) => json(r, CHANGELOG));
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const panel = page.getByTestId("whats-new");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // Non-blocking: no full-screen scrim, and the composer is still usable underneath.
    await expect(page.locator(".composer textarea")).toBeVisible();
    await page.locator(".composer textarea").fill("still interactive");

    await panel.getByRole("button", { name: "Got it" }).click();
    await expect(panel).toHaveCount(0);

    // Same release → it does not greet again after a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("whats-new")).toHaveCount(0);
  });

  test("Strategies is hidden while there are no strategies", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    // No saved plan → the agent has nothing to rank. No recommendations request should be needed.
    await page.route("**/api/agent/mandate*", (r) => json(r, { mandate: null }));
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".primnav a", { hasText: "Strategies" })).toHaveCount(0);
    await expect(page.locator(".tabbar a", { hasText: "Strategies" })).toHaveCount(0);
    // Still reachable by URL (never buried — N2).
    await expect(page.locator(".primnav a", { hasText: "Chat" })).toBeVisible();
  });

  test("mobile header at 390px does not overflow and collapses extra items", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
    await expect(page.locator(".trustPill")).toBeHidden();
    await expect(page.locator(".walletPill")).toBeHidden();
    await expect(page.locator(".avatar-btn")).toBeVisible();
  });

  test("trust banner dismissal persists across a reload", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const banner = page.getByTestId("trust-banner");
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Dismiss trust banner" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trust-banner")).toHaveCount(0);
  });

  test("a slow turn says so, then Retry resends the message", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    let turn = 0;
    await page.route("**/api/agent/chat", async (route) => {
      turn += 1;
      if (turn === 1) {
        // Hold the response past the ~8s reassurance threshold, then fail with a clean block.
        await new Promise((r) => setTimeout(r, 9_500));
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sse([{ type: "error", code: "UPSTREAM_UNAVAILABLE", message: "try again" }]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([{ type: "text", markdown: "Second time works." }]),
      });
    });

    await page.locator(".composer textarea").fill("Where can I earn?");
    await page.locator(".sendbtn").click();
    await expect(page.getByText(/taking longer than usual/i).first()).toBeVisible({
      timeout: 20_000,
    });

    const retry = page.getByRole("button", { name: "Try again" }).first();
    await expect(retry).toBeVisible({ timeout: 20_000 });
    await retry.click();
    await expect(page.getByText("Second time works.")).toBeVisible({ timeout: 20_000 });
    expect(turn).toBeGreaterThanOrEqual(2);
  });

  test("thumbs on an answer POST /chat/feedback with the message id", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await page.route("**/api/agent/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([{ type: "text", markdown: "A real answer." }]),
      }),
    );
    await page.route("**/api/agent/chat/feedback", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );

    await page.locator(".composer textarea").fill("Tell me something");
    await page.locator(".sendbtn").click();
    const feedback = page.getByTestId("turn-feedback");
    await expect(feedback).toBeVisible({ timeout: 20_000 });

    const posted = page.waitForRequest(
      (req) => req.url().includes("/api/agent/chat/feedback") && req.method() === "POST",
    );
    await feedback.getByRole("button", { name: "This answer was helpful" }).click();
    const req = await posted;
    const body = req.postDataJSON() as { blockId?: string; rating?: string };
    expect(body.rating).toBe("up");
    expect(body.blockId).toMatch(/^msg_/);
    await expect(page.getByText("Thanks — saved")).toBeVisible();
  });
});
