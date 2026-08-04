import { expect, test } from "@playwright/test";
import type { Hex } from "viem";
import { installInjectedWallet } from "./injected-wallet";

/**
 * Feature 042 SC-008 — the withdraw-always escape hatch survives the RPC proxy being DOWN.
 *
 * /exit reads are pinned to public endpoints by construction (exitPublicConfig, N2/FR-016) —
 * this drill proves it at runtime: the operator STOPS the sparkpoint-erpc service, runs this
 * spec against the live deployment, and the page still reads real vault state over public RPC.
 *
 * Gated behind PW_EXIT_DRILL=1 because it is only meaningful while the proxy is deliberately
 * stopped — in CI (no proxy control) it must not run. Wallet: any key holding vault shares
 * on 84532 (the drill asserts EITHER a live position read OR the honest no-shares read —
 * both prove the chain read worked; what it must never show is an RPC error/loading hang).
 */

const PRIV = process.env.PW_TEST_PRIVKEY as Hex | undefined;
const ARMED = process.env.PW_EXIT_DRILL === "1";

test.describe("042 /exit with the RPC proxy stopped (SC-008)", () => {
  test.skip(!ARMED || !PRIV, "set PW_EXIT_DRILL=1 and PW_TEST_PRIVKEY, with sparkpoint-erpc STOPPED");

  test("the escape hatch reads vault state over public RPC while the proxy is down", async ({ page }) => {
    await installInjectedWallet(page, { privateKey: PRIV!, chainId: 84532 });
    await page.goto("/exit", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Exit your position" })).toBeVisible({
      timeout: 30_000,
    });

    // The read completed: either a live position ("Redeemable now") or the honest empty state.
    // "Reading the vault over RPC…" must RESOLVE — a hang here is exactly the failure this
    // drill exists to catch (reads accidentally routed through the stopped proxy).
    await expect(
      page.getByText("Redeemable now").or(page.getByText("This wallet holds no vault shares")),
    ).toBeVisible({ timeout: 45_000 });
  });
});
