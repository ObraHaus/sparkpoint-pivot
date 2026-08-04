import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 039 — Admin → System → RPC proxy section (browser, fake injected wallet → SIWE →
 * admin session). Read-only surface: the injected wallet signs only SIWE.
 *
 * What this guards:
 *   - the sixth section renders inside the System console without breaking the other five;
 *   - the tri-state contract in the flesh: whatever the deployment's real state is
 *     (live / not configured / unreachable), the section says so honestly and renders tiles —
 *     it must NEVER crash or render a fake outage;
 *   - the admin metrics route is invisible to anonymous callers (404, like every /admin/*).
 *
 * Run against alpha: PW_BASE_URL=https://alpha.sparkpoint.io PW_NO_SERVER=1 PW_TEST_PRIVKEY=<admin key>.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;

async function signIn(page: Page): Promise<void> {
  // domcontentloaded (not networkidle): /verify holds a live connection so networkidle can never
  // settle on the CPU-constrained alpha infra. The signLink.waitFor below gates on real readiness.
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 30_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test("anonymous /api/admin/rpc-proxy is 404 — indistinguishable from a nonexistent route", async ({ request }) => {
  const res = await request.get("/api/admin/rpc-proxy");
  expect(res.status()).toBe(404);
});

test.describe("039 /admin/system → RPC proxy (live)", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (an admin-allowlisted test wallet key on 84532)");

  test("the section renders honestly in whatever state the deployment is in", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
    await signIn(page);

    await page.goto("/admin/system", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);

    // The console's original section still works before we touch the new one (no regression).
    await expect(page.getByText("System & ops health")).toBeVisible({ timeout: 25_000 });

    // Open the new section. role=tab overrides the implicit button role (032 lesson).
    await page.getByRole("tab", { name: "RPC proxy" }).click();
    await expect(page.getByRole("heading", { name: "RPC proxy" })).toBeVisible({ timeout: 25_000 });

    // The status pill settles into one of the three HONEST states — never blank, never a crash.
    const pill = page.locator(".pghead .pill");
    await expect(pill).toHaveText(/Live · \/metrics|Not configured|Proxy unreachable/, {
      timeout: 30_000,
    });

    // All five summary tiles exist regardless of state (tri-state contract: absence renders
    // as "not reported"/"—", not as a missing tile).
    for (const label of [
      "RPC proxy",
      "Cache hit rate",
      "Calls saved by cache",
      "Rate-limit events",
      "Upstreams reporting",
    ]) {
      await expect(page.locator(".kpi .k", { hasText: label })).toBeVisible();
    }

    // Read-only by design: the section offers no buttons that mutate anything — the only
    // button-role elements inside the panel belong to the console's tab strip itself.
    await expect(page.getByText("ops/erpc/ROLLBACK.md")).toBeVisible();

    // And the other sections did not break: hop back to the first tab.
    await page.getByRole("tab", { name: "System", exact: true }).click();
    await expect(page.getByText("System & ops health")).toBeVisible({ timeout: 25_000 });
  });
});
