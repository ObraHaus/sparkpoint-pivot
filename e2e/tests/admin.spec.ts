import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_SCREENS, ADMIN_SHOWCASE, type Theme } from "../screens";
import { primeTheme, gotoSettled, freeze, visibleText, diffPng, textDelta } from "../lib/parity";

const SHOWCASE_URL = process.env.SHOWCASE_URL || "http://localhost:4123";
const SCAFFOLD_URL = process.env.SCAFFOLD_URL || "http://localhost:3000";
const RESULTS = join(process.cwd(), "parity-results");
mkdirSync(RESULTS, { recursive: true });
const RATIO_THRESHOLD = 0.06;

const adminUrl = `${SHOWCASE_URL}/${encodeURI(ADMIN_SHOWCASE)}`;

/** Drive the showcase admin SPA to a given screen by clicking its nav item. */
async function showcaseGoToAdmin(page: Page, navKey: string, theme: Theme) {
  await primeTheme(page, theme);
  await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const item = page.locator(`.navitem[data-s="${navKey}"]`);
  await item.first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await freeze(page);
  await page.waitForTimeout(120);
}

for (const screen of ADMIN_SCREENS) {
  const theme: Theme = (screen.themes ?? ["dark"])[0];

  test(`admin visual · ${screen.name} · ${theme}`, async ({ page }, testInfo) => {
    await showcaseGoToAdmin(page, screen.navKey, theme);
    const showcaseShot = await page.screenshot({ fullPage: true, animations: "disabled" });
    const showcaseTxt = await visibleText(page);

    await primeTheme(page, theme);
    await gotoSettled(page, `${SCAFFOLD_URL}${screen.scaffold}`, 600);
    // Dismiss the scaffold-only "no auth yet" notice so the comparison reflects the
    // actual admin content (the banner is a deliberate, dismissible addition).
    await page.locator(".adscaffold-x").click().catch(() => {});
    await page.waitForTimeout(150);
    const scaffoldShot = await page.screenshot({ fullPage: true, animations: "disabled" });
    const scaffoldTxt = await visibleText(page);

    const { ratio, diff } = diffPng(showcaseShot, scaffoldShot);
    const delta = textDelta(showcaseTxt, scaffoldTxt);

    await testInfo.attach(`showcase-admin-${screen.name}`, { body: showcaseShot, contentType: "image/png" });
    await testInfo.attach(`scaffold-admin-${screen.name}`, { body: scaffoldShot, contentType: "image/png" });
    await testInfo.attach(`diff-admin-${screen.name}`, { body: diff, contentType: "image/png" });

    writeFileSync(
      join(RESULTS, `admin-${testInfo.project.name}-${screen.name}.json`),
      JSON.stringify({ kind: "admin", project: testInfo.project.name, screen: screen.name, ratio, pct: (ratio * 100).toFixed(2), missingInScaffold: delta.missingInScaffold }, null, 2),
    );

    console.log(`[admin] ${testInfo.project.name} ${screen.name} → ${(ratio * 100).toFixed(2)}% pixels differ, ${delta.missingInScaffold.length} lines missing`);
    expect.soft(ratio, `admin/${screen.name} differs by ${(ratio * 100).toFixed(2)}%`).toBeLessThan(RATIO_THRESHOLD);
    if (testInfo.project.name === "desktop") {
      expect.soft(delta.missingInScaffold, `admin/${screen.name}: design copy missing`).toEqual([]);
    }
  });
}

test("admin is observe-only and reachable without auth", async ({ page }, testInfo) => {
  await primeTheme(page, "dark");
  await gotoSettled(page, `${SCAFFOLD_URL}/admin`, 600);
  // The no-auth banner is always shown (until dismissed) at every breakpoint.
  await expect(page.getByText(/no auth|scaffold|authentication/i).first()).toBeVisible();
  // The ops-bar "Observe-only" + "View as" labels collapse to icons on mobile by design.
  if (testInfo.project.name === "desktop") {
    await expect(page.getByText(/Observe-only/i).first()).toBeVisible();
    await expect(page.getByText(/View as/i).first()).toBeVisible();
  }
});
