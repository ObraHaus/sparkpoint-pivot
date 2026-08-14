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
// ⚠️ ONE phrase list, shared with the PR-time guard (`src/lib/copy/copy-audit.test.ts`). Keeping a
// second copy here is how the two drift: a phrase added after a live incident lands in one and not
// the other, and the cheaper check silently stops covering it.
import { appliesTo, RETIRED_PHRASES } from "../../src/lib/copy/retiredPhrases.ts";

/**
 * The session comes from a REAL SIWE handshake done in Node (`e2e/__login.mjs`), not from driving
 * the wallet in the browser. The injected-wallet path stalls at "Waiting for signature…" against the
 * deployed app; the handshake itself is fine, so we do it where it works and hand the browser the
 * resulting cookie. This is the same flow `e2e/auth.e2e.mjs` already proves server-side.
 */
const SESSION = process.env.PW_SP_SESSION;
const SHOTS = process.env.PW_SHOT_DIR ?? "/tmp/shots";

async function authed(page: Page) {
  const host = new URL(process.env.PW_BASE_URL!).hostname;
  await page.context().addCookies([
    { name: "sp_session", value: SESSION!, domain: host, path: "/", httpOnly: true, secure: true },
  ]);
}

test.describe("043 copy audit on the live app", () => {
  test.skip(!SESSION, "PW_SP_SESSION not set (run e2e/__login.mjs)");
  test.setTimeout(240_000);

  // ⚠️ Each route carries a MARKER it must actually render. Asserting only "no bad phrase appears"
  // passes on a 404, a redirect to the holding page, and an empty shell — all of which contain no
  // retired copy precisely because they contain nothing. A guard that cannot fail is not a guard.
  for (const [name, path, marker] of [
    ["premium", "/premium", /premium/i],
    ["brokers", "/brokers", /sparky broker/i],
    ["srk", "/srk", /SRK/],
    ["fees", "/fees", /fee/i],
    ["settings", "/settings", /sparky brokers/i],
    // 044 — the claim screen. Its whole risk is copy: an empty pot must read as a fact, not a
    // teaser, and no projected figure may ever appear next to it.
    ["revenue", "/brokers/revenue", /nothing has been distributed/i],
  ] as const) {
    test(`${name} renders and carries no retired Premium copy`, async ({ page }) => {
      await authed(page);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(9000);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      // If the gate bounced us, say so plainly rather than passing on an empty page.
      expect(page.url(), `${path} bounced to ${page.url()}`).toContain(path);
      // ...and prove the page actually rendered its own content, not a shell that trivially
      // contains none of the banned phrases.
      expect(body, `${path} rendered no recognisable content — audit would be vacuous`).toMatch(
        marker,
      );
      for (const phrase of RETIRED_PHRASES) {
        if (!appliesTo(phrase, path)) continue;
        expect(body, `"${phrase.pattern}" still visible on ${path} — ${phrase.why}`).not.toMatch(
          phrase.pattern,
        );
      }
    });
  }
});
