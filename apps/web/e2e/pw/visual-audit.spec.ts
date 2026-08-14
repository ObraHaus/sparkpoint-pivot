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

/**
 * The session comes from a REAL SIWE handshake done in Node (`e2e/__login.mjs`), not from driving
 * the wallet in the browser. The injected-wallet path stalls at "Waiting for signature…" against the
 * deployed app; the handshake itself is fine, so we do it where it works and hand the browser the
 * resulting cookie. This is the same flow `e2e/auth.e2e.mjs` already proves server-side.
 */
const SESSION = process.env.PW_SP_SESSION;
const SHOTS = process.env.PW_SHOT_DIR ?? "/tmp/shots";

/** Phrases that must no longer appear anywhere a user can read them. */
const RETIRED_PHRASES = [
  /buy a month/i,
  /cancel anytime/i,
  /10,?000 SRK per month/i,
  /Premium subscription/i,
  /payout weight/i,
  /weight in every revenue/i,
  /comes from a subscription/i,
  /SRK\s*\/mo/i,
  /\/mo\b/,
];

async function authed(page: Page) {
  const host = new URL(process.env.PW_BASE_URL!).hostname;
  await page.context().addCookies([
    { name: "sp_session", value: SESSION!, domain: host, path: "/", httpOnly: true, secure: true },
  ]);
}

test.describe("043 copy audit on the live app", () => {
  test.skip(!SESSION, "PW_SP_SESSION not set (run e2e/__login.mjs)");
  test.setTimeout(240_000);

  for (const [name, path] of [
    ["premium", "/premium"],
    ["brokers", "/brokers"],
    ["srk", "/srk"],
    ["fees", "/fees"],
    ["settings", "/settings"],
  ] as const) {
    test(`${name} renders and carries no retired Premium copy`, async ({ page }) => {
      await authed(page);
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
