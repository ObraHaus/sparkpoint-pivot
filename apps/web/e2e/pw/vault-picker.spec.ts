import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 011 vault-picker e2e (browser, fake injected wallet → SIWE → session). Exercises the LIVE
 * deployed picker on `PW_BASE_URL` (run against alpha with PW_BASE_URL=https://alpha.sparkpoint.io +
 * PW_NO_SERVER=1). Read-only: the injected wallet signs only SIWE `personal_sign` — it CANNOT send a
 * transaction (eth_sendTransaction throws), so nothing here deposits/withdraws for real.
 *
 * Needs a beta-allowlisted PW_TEST_PRIVKEY connected on Base Sepolia (84532, where the demo wrapper
 * lives). The deployer key holds spMORPHO shares, so the portfolio row assertion is meaningful.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const WRAPPER = "0xff0a43FA397a90c1277C96A783e1171e1efbE9BB";

/** Complete the SIWE sign-in on /verify; resolves once the wallet is admitted ("You're in."). */
async function signIn(page: Page): Promise<void> {
  // domcontentloaded (not networkidle): /verify holds a live connection so networkidle can never
  // settle on the CPU-constrained alpha infra. The signLink.waitFor below gates on real readiness.
  await page.goto("/verify", { waitUntil: "domcontentloaded" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 30_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("011 vault picker (live)", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (a beta-allowlisted test wallet key on 84532)");

  test.beforeEach(async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
    await signIn(page);
  });

  test("launch default: picker offers both vaults; the launch overview is unchanged", async ({ page }) => {
    await page.goto("/vault", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);

    // The segmented picker shows both options.
    const picker = page.getByRole("tablist", { name: "Select vault" });
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await expect(picker.getByRole("tab", { name: /Aave Yield Vault/ })).toBeVisible();
    await expect(picker.getByRole("tab", { name: /SparkPoint Morpho USDC/ })).toBeVisible();

    // Default selection = the launch Aave vault: its title + its Aave APY breakdown render (honest %,
    // NOT a wrapper "—"/Morpho venue).
    await expect(page.getByRole("heading", { name: /Aave Yield Vault/ })).toBeVisible();
    await expect(page.getByText("Aave supply rate")).toBeVisible();
    await expect(page.getByText("Morpho (external)")).toHaveCount(0);
  });

  test("select the wrapper: honest wrapper overview (no fabricated APY, Morpho venue, ✓ badge)", async ({ page }) => {
    await page.goto("/vault", { waitUntil: "domcontentloaded" });
    const picker = page.getByRole("tablist", { name: "Select vault" });
    await expect(picker).toBeVisible({ timeout: 20_000 });

    // Select the wrapper. The /vault overview re-renders continuously from live on-chain reads, so a
    // coordinate click can't land on a "stable" frame (Playwright hangs / misses). We dispatch the
    // click directly on the tab — the real onClick + router.replace are exercised (verified: it lands
    // the selection in the URL); this only sidesteps the actionability wait on a live-updating page. A
    // real user's browser fires this same onClick normally. Selection lives in the URL (shareable).
    const wrapperTab = picker.getByRole("tab", { name: /SparkPoint Morpho USDC/ });
    await expect(async () => {
      await wrapperTab.dispatchEvent("click");
      await expect(page).toHaveURL(new RegExp(`[?&]vault=${WRAPPER}`, "i"), { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });

    // The overview switches to the wrapper: its label as the title, the honest Morpho venue, and NO
    // fabricated APY (the big Net-APY number is "—", never an Aave rate).
    await expect(page.getByRole("heading", { name: /SparkPoint Morpho USDC/ })).toBeVisible();
    await expect(page.getByText("Morpho (external)")).toBeVisible();
    // Exact copy from vault/page.tsx (`isMorphoVenue ? "net APY · unavailable" : …`). This assertion
    // silently rotted for two weeks when 13cf8b6 shortened the label a day after this spec was last
    // touched — if you change that string, change it here in the same commit.
    await expect(page.getByText("net APY · unavailable")).toBeVisible();
    await expect(page.getByText("Aave supply rate")).toHaveCount(0);

    // 024: the wrapper is RETIRED, so the option is badged RETIRED rather than carrying the live
    // attestation ✓. It stays selectable on purpose — a holder must still be able to reach withdraw.
    await expect(picker.getByRole("tab", { name: /SparkPoint Morpho USDC/ })).toContainText("RETIRED");
  });

  test("024 — retired wrapper: the deposit screen renders but CANNOT be signed", async ({ page }) => {
    await page.goto(`/vault/deposit?vault=${WRAPPER}`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);
    await expect(page.getByRole("heading", { name: /Deposit USDC/ })).toBeVisible({ timeout: 20_000 });
    // Honest wrapper framing is unchanged...
    await expect(page.getByText(/Into SparkPoint Morpho USDC/)).toBeVisible();
    // ...but the CTA is the retirement fail-close, and it is DISABLED. Enter an amount first so the
    // label cannot be the trivial "Enter an amount" state.
    const amount = page.locator('input[inputmode="decimal"]').first();
    await amount.fill("1");
    const cta = page.getByRole("button", { name: /Vault retired — withdrawals only/ });
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await expect(cta).toBeDisabled();
  });

  // The N2 counterpart to the test above: retiring is OUR decision, so it may close deposits but must
  // NEVER close the exit. If this ever fails while the deposit test passes, we have broken N2.
  test("wrapper withdraw screen renders (never provenance/beta/retirement-gated — N2)", async ({ page }) => {
    await page.goto(`/vault/withdraw?vault=${WRAPPER}`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);
    await expect(page.getByRole("heading", { name: /^Withdraw$/ })).toBeVisible({ timeout: 20_000 });
    // The withdraw route is NOT beta-gated (no BetaGate) and is reachable for the wrapper.
    await expect(page.getByText("Withdraw anytime — even if Sparky is offline")).toBeVisible();
  });

  test("portfolio shows the held wrapper as an external Morpho position", async ({ page }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(connect|verify)(\/|$|\?)/);
    // The connected (deployer) wallet holds spMORPHO shares → the wrapper renders as its own row,
    // labelled + tagged Morpho. (If shares ever read 0, this asserts the honest no-row path instead.)
    const row = page.getByText("SparkPoint Morpho USDC");
    await expect(row.first()).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/· Morpho/).first()).toBeVisible();
  });
});
