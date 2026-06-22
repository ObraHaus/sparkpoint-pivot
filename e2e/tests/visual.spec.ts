import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCREENS, type Theme } from "../screens";
import { primeTheme, gotoSettled, diffPng } from "../lib/parity";

const SHOWCASE_URL = process.env.SHOWCASE_URL || "http://localhost:4123";
const SCAFFOLD_URL = process.env.SCAFFOLD_URL || "http://localhost:3000";
const RESULTS = join(process.cwd(), "parity-results");
mkdirSync(RESULTS, { recursive: true });

// Generous threshold: two different implementations never match to the pixel; this flags
// real layout / content / color divergences while tolerating font hinting & anti-aliasing.
const RATIO_THRESHOLD = 0.06;

const showcaseUrl = (p: string) => `${SHOWCASE_URL}/${encodeURI(p)}`;

for (const screen of SCREENS) {
  const themes: Theme[] = screen.themes ?? ["dark", "light"];
  for (const theme of themes) {
    test(`visual · ${screen.name} · ${theme}`, async ({ page }, testInfo) => {
      const mask = screen.maskCanvas ? [page.locator("canvas#core, canvas")] : [];

      await primeTheme(page, theme);
      await gotoSettled(page, showcaseUrl(screen.showcase), screen.settleMs ?? 700);
      const showcaseShot = await page.screenshot({ fullPage: true, mask, animations: "disabled" });

      await primeTheme(page, theme);
      await gotoSettled(page, `${SCAFFOLD_URL}${screen.scaffold}`, screen.settleMs ?? 700);
      const scaffoldShot = await page.screenshot({ fullPage: true, mask, animations: "disabled" });

      const { width, height, mismatch, ratio, diff } = diffPng(showcaseShot, scaffoldShot);

      await testInfo.attach(`showcase-${screen.name}-${theme}`, { body: showcaseShot, contentType: "image/png" });
      await testInfo.attach(`scaffold-${screen.name}-${theme}`, { body: scaffoldShot, contentType: "image/png" });
      await testInfo.attach(`diff-${screen.name}-${theme}`, { body: diff, contentType: "image/png" });

      const pct = (ratio * 100).toFixed(2);
      writeFileSync(
        join(RESULTS, `visual-${testInfo.project.name}-${screen.name}-${theme}.json`),
        JSON.stringify({ kind: "visual", project: testInfo.project.name, screen: screen.name, theme, width, height, mismatch, ratio, pct, note: screen.note ?? "" }, null, 2),
      );

      console.log(`[visual] ${testInfo.project.name} ${screen.name}/${theme} → ${pct}% pixels differ`);
      expect.soft(ratio, `${screen.name}/${theme} differs by ${pct}% — review diff attachment`).toBeLessThan(RATIO_THRESHOLD);
    });
  }
}
