import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Universal swap (feature 007) e2e — drives the deployed `/swap` page + in-chat swap with the fake
 * injected wallet (SIWE signed in Node). Validates the token-generic surface end to end WITHOUT
 * broadcasting a transaction (the injected wallet signs `personal_sign`, not `eth_sendTransaction`):
 * on-chain custom-token resolution + the unverified badge, an honest refusal for a non-contract, a
 * live ETH→USDC quote carrying the 0.20% routing fee, and the functional in-chat swap card.
 *
 * Point at a running server with `PW_BASE_URL` + `PW_NO_SERVER=1` (e.g. https://alpha.sparkpoint.io).
 * Skips unless `PW_TEST_PRIVKEY` is a BETA-allowlisted testnet wallet.
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
// A real Base Sepolia ERC-20 that is NOT a recommended/verified token (Aave aUSDC) — resolves on-chain
// (has decimals/symbol) so the picker shows it as "Unverified"; it has no Uniswap pool (honest noRoute).
const CUSTOM_ERC20 = "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC";
// A checksummed-safe all-lowercase address with NO contract code → the resolver must refuse it.
const NON_CONTRACT = "0x000000000000000000000000000000000000dead";

async function signIn(page: Page): Promise<void> {
  await page.goto("/verify", { waitUntil: "networkidle" });
  const signLink = page.locator("a:has-text('Sign in with wallet')");
  await signLink.waitFor({ state: "visible", timeout: 20_000 });
  await signLink.click();
  await expect(page.locator("#vtitle")).toHaveText("You're in.", { timeout: 30_000 });
}

test.describe("universal swap (007) — /swap + chat", () => {
  test.skip(!PRIV, "PW_TEST_PRIVKEY not set (a beta-allowlisted test wallet key)");

  test("/swap resolves a pasted custom token on-chain and flags it unverified", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/swap", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("You pay")).toBeVisible({ timeout: 25_000 });

    // Open the "receive" token picker (the token-generic UI replaced the ETH↔USDC boolean).
    const pills = page.locator("button.pill");
    await expect(pills.first()).toBeVisible({ timeout: 20_000 });
    await pills.nth(1).click();
    const dialog = page.getByRole("dialog", { name: "Select a token" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Recommended")).toBeVisible();

    // A real, non-recommended ERC-20 resolves on-chain and is badged Unverified.
    await dialog.getByPlaceholder(/Paste token address/i).fill(CUSTOM_ERC20);
    await expect(dialog.getByText(/Unverified/i)).toBeVisible({ timeout: 25_000 });

    // A non-contract address is honestly refused (fail-closed — no quote).
    await dialog.getByPlaceholder(/Paste token address/i).fill(NON_CONTRACT);
    await expect(
      dialog.getByText(/isn't an ERC-20 token|doesn't look like a valid|couldn't read/i),
    ).toBeVisible({ timeout: 25_000 });
  });

  test("/swap quotes ETH→USDC with the 0.20% routing fee and a route", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/swap", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("You pay")).toBeVisible({ timeout: 25_000 });

    // Default pair is ETH → USDC; enter a small ETH amount and wait for the live quote.
    const payInput = page.locator(".field", { hasText: "You pay" }).locator("input").first();
    await payInput.fill("0.002");

    await expect(page.getByText(/SparkPoint routing fee/i)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Min received/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Review swap$/i })).toBeEnabled({ timeout: 45_000 });
  });

  test("chat renders a functional inline swap card", async ({ page }) => {
    test.setTimeout(200_000); // the assistant runs on slow, free inference
    await installInjectedWallet(page, { privateKey: PRIV! });
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // A fresh context pops the "What's New" greeting modal (it renders my swap-any-token changelog
    // entry) — dismiss it via "Got it" so it can't intercept clicks on the composer.
    const whatsNew = page.getByRole("dialog", { name: "What's new" });
    await whatsNew.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if (await whatsNew.isVisible().catch(() => false)) {
      await whatsNew.getByRole("button", { name: "Got it" }).click();
      await whatsNew.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    }

    // EVERY assertion below is scoped to the transcript (`.chatstream`), never the page. /chat
    // RESTORES the last conversation, and the thread rail carries conversation TITLES — so an
    // unscoped getByText("swap 0.01 ETH to USDC") matches a sidebar title and an unscoped
    // "Review swap" matches the PREVIOUS turn's card. That is not hypothetical: on 2026-08-14 this
    // test both failed (150s timeout) and then passed (6.8s) against a healthy agent, and Postgres
    // showed no new `conversation_turns` row for either run.
    const stream = page.locator(".chatstream");
    const composer = page.getByPlaceholder(/Ask about your wallet/i);
    const send = page.locator("button.sendbtn");
    await composer.waitFor({ state: "visible", timeout: 20_000 });

    // Start a genuinely empty thread. The click is retried until the restored card is actually gone:
    // this box is CPU-starved, and a click fired before React hydrates is swallowed silently — which
    // looks exactly like a broken "New chat" button.
    await expect(async () => {
      await page.getByRole("button", { name: "New chat" }).click();
      await expect(stream.getByRole("button", { name: /Review swap/i })).toHaveCount(0, {
        timeout: 3_000,
      });
    }).toPass({ timeout: 45_000 });

    // With a wallet connected the assistant must be LIVE; the demo banner means scripted replies,
    // and asserting anything against those would prove nothing.
    await expect(stream.getByText(/Demo mode/i)).toHaveCount(0);

    // Count the user bubbles FIRST: asserting the count grows is what proves a send happened. A
    // visibility check cannot — the restored thread may already hold this exact text, so it would
    // pass without anything being sent (and, matching several bubbles at once, trips strict mode).
    const userTurns = stream.locator(".cturn.user");
    const before = await userTurns.count();

    await composer.click();
    await composer.fill("swap 0.01 ETH to USDC");
    // Use the send button (disabled until the controlled `draft` state updates) — pressing Enter can
    // fire before React re-renders, so the keydown handler would send a stale/empty draft. Waiting
    // for it to ENABLE is also the hydration proof: the click cannot be swallowed once it flips.
    await expect(send).toBeEnabled({ timeout: 20_000 });
    await send.click();

    // The message really left the composer — the transcript GREW, and it grew here rather than in
    // the thread rail. Deliberately "more than before" and not "exactly one more": on 2026-08-14 a
    // full-suite run rendered TWO user bubbles for this send while Postgres recorded exactly one
    // `conversation_turns` row, so the transcript can hold a bubble the server never saw (a
    // duplicate render, or the restored thread returning after "New chat" emptied it). Counting up
    // from a baseline taken AFTER clearing still proves a send happened, which is all this needs.
    await expect.poll(() => userTurns.count(), { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(userTurns.last()).toContainText("swap 0.01 ETH to USDC");

    // The assistant proposes a swap → "Review swap" → the functional inline swap card (with the fee).
    // The agent stamps the action `policy.status: "rejected"` on purpose (_SWAP_ADVISORY_REASON in
    // coordinator/dag.py) — it does not build swaps; the web renders its own Uniswap card.
    // `.last()`, not `.first()`: the card we care about belongs to the turn just sent, and an
    // earlier card would satisfy `.first()` without the live turn ever answering.
    const review = stream.getByRole("button", { name: /Review swap/i }).last();
    await review.waitFor({ state: "visible", timeout: 150_000 });
    await review.click();
    await expect(stream.getByText(/routing fee/i)).toBeVisible({ timeout: 30_000 });
  });
});
