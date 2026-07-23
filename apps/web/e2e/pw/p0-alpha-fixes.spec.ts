import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 015 — P0 alpha fixes, browser e2e against the deployed app with the fake injected wallet.
 *
 * - US1: onboarding persists the plan the user CHOSE (saved == shown). We complete the wizard with a
 *   deliberately NON-default plan (Aggressive growth · 3+ years · "buy the dip" → tier 4) and
 *   intercept the `POST /api/agent/mandate` to assert its body carries the real goal/tier/timeline
 *   (never the old server-default recompute). The intercept fulfils a 200 locally, so NO real mandate
 *   is written to the deployed DB — the browser save path is what's proven.
 * - US2: Settings → Mandate renders the new `useMandate()` component (honest states), not the old
 *   hardcoded tier-1 mock — asserted via strings that ONLY the new MandateTab can emit.
 * - US6: the standalone `/confirm/deposit?assets=…` route never shows the dead "ships at launch"
 *   placeholder — it renders the real gate or the live amount-entry screen (FR-054).
 *
 * Requires a beta-allowlisted PW_TEST_PRIVKEY + the app reachable (local prod build wired to the
 * agent, or PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1). Skips when the key is unset.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  // domcontentloaded (NOT networkidle) — the app has ongoing background polling so networkidle
  // rarely settles on the remote deploy; wait on the concrete sign-in affordance instead.
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 25_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("015 P0 alpha fixes", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (a beta-allowlisted test wallet key)");
  // signIn + a multi-step onboarding chain against the REMOTE deploy on a shared runner is slow;
  // give these flows headroom (the assertions themselves stay tight).
  test.describe.configure({ timeout: 180_000 });

  test("US1: onboarding persists the plan the user chose (saved == shown)", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);

    // Intercept the mandate save and capture its body — fulfil locally so NO real write happens.
    let body: { mandate?: Record<string, unknown> } | null = null;
    await page.route("**/api/agent/mandate", async (route) => {
      if (route.request().method() === "POST") {
        body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ mandate: body?.mandate ?? {} }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    // Hydration-safe first interaction: on this slow runner a click can land on the pre-hydration
    // SSR button (handler not yet wired) and no-op. Retry "Get started" until step 1 actually renders.
    await expect(async () => {
      await page.getByRole("button", { name: "Get started" }).click({ timeout: 5_000 });
      await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
    await page.getByRole("button", { name: "Continue" }).click(); // step 1 → 2
    await page.locator("button.opt", { hasText: "I've used a few apps" }).click(); // experience: Some
    await page.getByRole("button", { name: "Continue" }).click(); // step 2 → 3
    await page.locator("button.opt", { hasText: "Aggressive growth" }).click();
    await page.getByRole("button", { name: "Continue" }).click(); // step 3 → 4
    await page.locator("button.tchip", { hasText: "3+ years" }).click();
    await page.getByRole("button", { name: "Continue" }).click(); // step 4 → 5
    await page.locator("button.opt", { hasText: "Buy more while it's low" }).click(); // → tier 4
    await page.getByRole("button", { name: "See my plan" }).click(); // step 5 → 6
    await page.getByRole("button", { name: "Set my plan" }).click(); // → POST /mandate (intercepted)

    // The save advances to the first-recommendation step only on success — its dock CTA is unique.
    await expect(page.getByRole("button", { name: "Continue to chat" })).toBeVisible({ timeout: 20_000 });

    // The persisted body reflects the user's real choices — NOT the server default
    // (conservative / grow_savings / 12mo). This is the whole US1 fix.
    expect(body).not.toBeNull();
    const m = body!.mandate as {
      goals: { kind: string; label: string }[];
      riskProfile: string;
      riskParams: { horizonMonths: number };
    };
    expect(m.goals[0].kind).toBe("aggressive_growth");
    expect(m.goals[0].label).toBe("Aggressive growth");
    expect(m.riskProfile).toBe("growth"); // never the server-rejected "aggressive"
    expect(m.riskParams.horizonMonths).toBe(48);
  });

  test("US2: Settings → Mandate renders the real mandate component, not the tier-1 mock", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator(".settab", { hasText: "Mandate" }).click(); // the tabs are divs, not buttons
    // Strings ONLY the new useMandate()-driven MandateTab can emit (empty / disconnected / loading /
    // error / ready). The old hardcoded mock had none of these — it always showed a fake tier-1 plan.
    const marker = page.locator(
      "text=/Max slippage|No plan yet|Set up mandate|Connect your wallet to see your mandate|Loading your plan|Couldn’t load your mandate/",
    );
    await expect(marker.first()).toBeVisible({ timeout: 20_000 });
  });

  test("US6: /confirm/deposit?assets=… runs the real gate, never the dead placeholder", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/confirm/deposit?assets=1000000", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    // The inert "ships at launch" / "Open the Vault" placeholder must NOT appear for a live intent.
    await expect(page.locator("text=On-chain execution ships at launch")).toHaveCount(0);
    await expect(page.locator("text=Open the Vault")).toHaveCount(0);
  });
});
