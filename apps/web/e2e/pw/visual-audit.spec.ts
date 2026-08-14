/**
 * 043 — visual + copy audit of the live alpha app.
 *
 * Runs against alpha.sparkpoint.io with the injected SIWE wallet, walks the surfaces that mention
 * Premium, screenshots each, and asserts that no page still describes Premium as a monthly
 * subscription. A grep of the source proves the strings were changed; only a real render proves the
 * user actually sees the changed ones.
 *
 *   PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1 PW_TEST_PRIVKEY=0x… \
 *     npx playwright test e2e/pw/visual-audit.spec.ts --project=chromium
 */
import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const SHOTS = process.env.PW_SHOT_DIR ?? "/tmp/shots";

/** Phrases that must no longer appear anywhere a user can read them. */
const RETIRED_PHRASES = [
  /buy a month/i,
  /cancel anytime/i,
  /10,?000 SRK per month/i,
  /Premium subscription/i,
  /payout weight/i,
  /weight in every revenue/i,
];

async function auth(page: Page): Promise<void> {
  await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
  // domcontentloaded, not networkidle: /verify holds a live connection so networkidle never settles
  // on this infra. NOTE the control is an <a>, not a <button> — a getByRole("button") lookup finds
  // nothing and silently times out, which is exactly how this spec failed the first time.
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 40_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 40_000 });
}

test.describe("043 copy audit on the live app", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set");
  test.setTimeout(240_000);

  for (const [name, path] of [
    ["premium", "/premium"],
    ["brokers", "/brokers"],
    ["srk", "/srk"],
    ["fees", "/fees"],
    ["settings", "/settings"],
  ] as const) {
    test(`${name} renders and carries no retired Premium copy`, async ({ page }) => {
      await auth(page);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(9000);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      // If the gate bounced us, say so plainly rather than passing on an empty page.
      expect(page.url(), `${path} bounced to ${page.url()}`).toContain(path);
      for (const phrase of RETIRED_PHRASES) {
        expect(body, `"${phrase}" still visible on ${path}`).not.toMatch(phrase);
      }
    });
  }
});
