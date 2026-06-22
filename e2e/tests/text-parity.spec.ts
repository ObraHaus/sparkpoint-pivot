import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCREENS, type Theme } from "../screens";
import { primeTheme, gotoSettled, visibleText, textDelta } from "../lib/parity";

const SHOWCASE_URL = process.env.SHOWCASE_URL || "http://localhost:4123";
const SCAFFOLD_URL = process.env.SCAFFOLD_URL || "http://localhost:3000";
const RESULTS = join(process.cwd(), "parity-results");
mkdirSync(RESULTS, { recursive: true });

const showcaseUrl = (p: string) => `${SHOWCASE_URL}/${encodeURI(p)}`;

// DOM/text parity catches missing or paraphrased copy — the thing a client notices most.
// Run on desktop only (content is identical across breakpoints).
test.describe.configure({ mode: "parallel" });

for (const screen of SCREENS) {
  const theme: Theme = (screen.themes ?? ["dark"])[0];
  test(`text · ${screen.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "content parity runs on desktop only");

    await primeTheme(page, theme);
    await gotoSettled(page, showcaseUrl(screen.showcase), screen.settleMs ?? 700);
    const showcase = await visibleText(page);

    await primeTheme(page, theme);
    await gotoSettled(page, `${SCAFFOLD_URL}${screen.scaffold}`, screen.settleMs ?? 700);
    const scaffold = await visibleText(page);

    const delta = textDelta(showcase, scaffold);
    writeFileSync(
      join(RESULTS, `text-${screen.name}.json`),
      JSON.stringify({ kind: "text", screen: screen.name, showcaseLines: showcase.length, scaffoldLines: scaffold.length, ...delta }, null, 2),
    );
    await testInfo.attach(`text-delta-${screen.name}`, {
      body: JSON.stringify(delta, null, 2),
      contentType: "application/json",
    });

    if (delta.missingInScaffold.length) {
      console.log(`[text] ${screen.name} — ${delta.missingInScaffold.length} design lines missing in scaffold:`);
      delta.missingInScaffold.slice(0, 20).forEach((l) => console.log(`   – "${l}"`));
    }
    // Design copy present in the showcase but absent from the scaffold is a real divergence.
    expect.soft(delta.missingInScaffold, `${screen.name}: design copy missing from scaffold`).toEqual([]);
  });
}
