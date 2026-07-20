import { test, expect, type Page } from "@playwright/test";

/**
 * Feature 006 — update-banner E2E against a LIVE deployment (default alpha.sparkpoint.io).
 *
 * This is the Playwright form of the DevTools "Option 2" simulation: instead of shipping a new build,
 * we INTERCEPT GET /api/version and return a build id whose trailing base-36 timestamp is far newer
 * than the one baked into the served bundle. `isRealUpdate` (lib/version.ts) compares those suffixes,
 * so the running tab treats it as a genuine new release — exactly what a real deploy produces — and
 * the banner arms after the required TWO corroborating reads (lib/useVersionCheck.ts).
 *
 * Live-only: skipped unless PW_BASE_URL points at a non-localhost origin (the normal localhost suite
 * serves version "dev" / "unknown", which is a deliberate no-op).
 *
 * Run:
 *   cd apps/web
 *   PW_BASE_URL=https://alpha.sparkpoint.io npx playwright test e2e/pw/update-banner-live.spec.ts
 */

const BASE = process.env.PW_BASE_URL || "";
test.skip(!BASE || BASE.includes("localhost"), "live deployment only (set PW_BASE_URL to alpha)");

// Trailing "-zzzzzzzz" parses (base36) to a far-future timestamp — strictly newer than any real build
// id's suffix, so isRealUpdate() returns true regardless of the live commit SHA.
const NEWER_VERSION = "e2e0000000000000000000000000000000000000-zzzzzzzz";
const BANNER_TITLE = "A new version of SparkPoint";

/** Serve a strictly-newer /api/version to THIS page for the rest of its life (persists across reloads). */
async function forceNewerVersion(page: Page): Promise<void> {
  await page.route("**/api/version", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ version: NEWER_VERSION }),
    });
  });
}

/** Nudge react-query's refetchOnWindowFocus so the 2nd corroborating read lands in seconds, not ~60s. */
async function pumpFocus(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => {
      // react-query's focusManager listens on window for a BUBBLING visibilitychange; a plain
      // document-dispatched (non-bubbling) event never reaches it. Make it bubble + also hit window.
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      window.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(1500);
  }
}

test.describe("feature 006 — update banner (live)", () => {
  test.setTimeout(150_000);

  test("banner ARMS on a normal route when a newer build is served", async ({ page }) => {
    await forceNewerVersion(page);
    await page.goto("/connect", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/connect"); // guard: no redirect away
    await page.waitForTimeout(4000); // let the client hydrate + the poller mount

    // Force the two corroborating reads.
    await pumpFocus(page, 10);

    const banner = page.getByText(BANNER_TITLE);
    await expect(banner).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Update ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload now" })).toBeVisible();

    // Countdown is live: the seconds value strictly decreases while un-paused.
    const count = page.locator(".tipcard-count");
    const first = parseInt((await count.textContent()) || "0", 10);
    await page.waitForTimeout(2500);
    const second = parseInt((await count.textContent()) || "0", 10);
    expect(second).toBeLessThan(first);

    await page.screenshot({ path: "test-results/banner-connect.png" }); // gitignored output dir
    console.log(`[banner] armed on /connect; countdown ${first}s -> ${second}s`);
  });

  test("banner does NOT arm when the served build is NOT newer (negative control)", async ({
    page,
  }) => {
    // Suffix "-0" parses (base36) to 0 — OLDER than any real build's timestamp — so isRealUpdate()
    // is false. Proves the positive result above is caused by the newer-version signal specifically,
    // not by something incidental on the page.
    await page.route("**/api/version", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ version: "e2e0000000000000000000000000000000000000-0" }),
      });
    });
    await page.goto("/connect", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await pumpFocus(page, 12);
    await page.waitForTimeout(2000);
    await expect(page.getByText(BANNER_TITLE)).toHaveCount(0);
    console.log("[banner] correctly did NOT arm for a non-newer build");
  });

  for (const route of ["/exit", "/trust"]) {
    test(`banner is SUPPRESSED on ${route} (N2 escape hatch) even with a newer build`, async ({
      page,
    }) => {
      await forceNewerVersion(page);
      await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(page.url()).toContain(route); // guard: actually on the escape hatch, not redirected
      await page.waitForTimeout(4000);

      // Same forced-newer signal + focus pumping that ARMS the banner on /connect...
      await pumpFocus(page, 12);
      await page.waitForTimeout(2000);

      // ...must NOT produce a banner here (isExcluded → show=false), and must never reload.
      await expect(page.getByText(BANNER_TITLE)).toHaveCount(0);
      expect(page.url()).toContain(route);
      console.log(`[banner] correctly suppressed on ${route}`);
    });
  }
});
