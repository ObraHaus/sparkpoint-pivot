import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveVaultConfirm,
  type VaultConfirmView,
  type VaultConfirmInput,
} from "./vaultConfirmModel.ts";

// ── fixtures ──────────────────────────────────────────────────────────────────
const USDC = "0x0000000000000000000000000000000000000001" as const;
const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;
const LAUNCH_VAULT = "0x00000000000000000000000000000000000000bb" as const;
const WRAPPER = "0x00000000000000000000000000000000000000cc" as const;
const NOT_USDC = "0x00000000000000000000000000000000000000ee" as const;

/** Mirror useVault.netApy: profit-only fee (1000 bps here) reduces only the yield leg. */
const netApy = (grossApyBps: number) => {
  const feeBps = 1000;
  const netApyBps = Math.round((grossApyBps * (10_000 - feeBps)) / 10_000);
  return {
    grossApyBps,
    feeBps,
    feeIsLive: true,
    netApyBps,
    grossApyPct: grossApyBps / 100,
    netApyPct: netApyBps / 100,
  };
};

function makeView(o: Partial<VaultConfirmView> = {}): VaultConfirmView {
  return {
    kind: "aave_launch",
    factoryVerified: undefined,
    label: "Aave Yield Vault",
    chainId: 84532,
    account: ACCOUNT,
    vault: LAUNCH_VAULT,
    usdcAddress: USDC,
    asset: USDC,
    assetDecimals: 6,
    isConnected: true,
    isDeployed: true,
    paused: false,
    shares: 0n,
    underlying: 0n,
    maxDeposit: 1_000_000_000n,
    maxRedeem: 0n,
    usdcBalance: 1_000_000_000n,
    previewDepositShares: 1_000_000n,
    needsApproval: () => true,
    refetch: () => {},
    netApy,
    ...o,
  };
}

const CTX = { grossApyBps: 430, capNoun: "beta cap" } as const;
const DEP: VaultConfirmInput = { mode: "deposit", assets: 1_000_000n };

// ── the LAUNCH vault path stays Aave, signable, with the real net APY (unchanged) ──
test("launch deposit: Aave copy, no Morpho/STACKS, signable, real net APY", () => {
  const m = deriveVaultConfirm(makeView(), DEP, CTX);
  assert.equal(m.isWrapper, false);
  assert.equal(m.vaultName, "Aave Yield Vault");
  assert.equal(m.shareSymbol, "spvUSDC");
  assert.equal(m.depositReady, true);
  assert.equal(m.depositSignable, true);
  assert.equal(m.label, "Review deposit");
  assert.equal(m.feeRow[0], "Performance fee");
  assert.equal(m.feeRow[1], "10% of yield (over HWM)");
  assert.equal(m.venueGuard, "Allowlisted protocol — Aave v3 (Base)");
  assert.equal(m.netApyText, "3.87%");
  assert.equal(m.netApyRow[1], "3.87%");
  assert.deepEqual(m.managementFeeRow, ["Management fee", "0% — none", "--gain"]);
  const blob = [m.feeRow.join(" "), m.venueGuard, m.subYieldNote].join(" ");
  assert.ok(!blob.includes("Morpho"), "launch never mentions Morpho");
  assert.ok(!blob.includes("STACKS"), "launch has no stacked-fee disclosure");
  assert.ok(m.venueGuard.includes("Aave"));
});

// ── an ATTESTED wrapper: honest Morpho framing + the stacked double-fee disclosure (fix 2/7) ──
test("attested wrapper deposit: Morpho-not-Aave framing + stacked double-fee disclosure", () => {
  const m = deriveVaultConfirm(
    makeView({
      kind: "morpho_wrapper",
      factoryVerified: true,
      vault: WRAPPER,
      label: "SparkPoint · Steakhouse USDC",
    }),
    DEP,
    CTX,
  );
  assert.equal(m.isWrapper, true);
  assert.equal(m.showWrapperIdentity, true);
  assert.equal(m.vaultName, "SparkPoint · Steakhouse USDC");
  assert.equal(m.shareSymbol, "shares");
  assert.equal(m.depositReady, true);
  assert.equal(m.depositSignable, true);
  assert.equal(m.feeRow[0], "SparkPoint performance fee");
  assert.ok(m.feeRow[1].includes("STACKS on Morpho's curator fee"));
  assert.ok(!m.feeRow[1].includes("over HWM"));
  assert.ok(m.venueGuard.includes("Morpho"));
  assert.ok(m.subYieldNote.includes("Morpho"));
});

// ── the wrapper NEVER shows the hardcoded Aave APY (Principle III) — it is "—" (fix 2/7) ──
test("wrapper Net APY is unavailable ('—'), never the Aave figure; launch shows the real %", () => {
  const wrap = deriveVaultConfirm(
    makeView({ kind: "morpho_wrapper", factoryVerified: true, vault: WRAPPER }),
    DEP,
    CTX,
  );
  assert.equal(wrap.netApyText, "—");
  assert.equal(wrap.netApyRow[1], "—");
  assert.ok(!wrap.netApyRow[1].includes("%"));

  const launch = deriveVaultConfirm(makeView(), DEP, CTX);
  assert.ok(launch.netApyText.includes("%"));
});

// ── provenance fail-close (fix 1/7): unattested ⇒ deposit blocked + identity suppressed;
//    withdraw ALWAYS works for a genuinely-held position (N2). ──
test("unattested wrapper: deposit fail-closed (no signable exec) + identity suppressed", () => {
  const m = deriveVaultConfirm(
    makeView({
      kind: "morpho_wrapper",
      factoryVerified: undefined, // NOT attested
      vault: WRAPPER,
      label: "SparkPoint · Steakhouse USDC",
    }),
    DEP,
    CTX,
  );
  assert.equal(m.isWrapper, true);
  assert.equal(m.showWrapperIdentity, false);
  assert.notEqual(m.vaultName, "SparkPoint · Steakhouse USDC"); // never brand an unattested address
  assert.equal(m.depositReady, false);
  assert.equal(m.depositSignable, false);
  assert.equal(m.label, "Unverified vault");
});

test("unattested wrapper: withdraw stays open for a held position, liquidity-bounded N2 note (N2)", () => {
  const view = makeView({
    kind: "morpho_wrapper",
    factoryVerified: undefined, // still not attested — must NOT block exit
    vault: WRAPPER,
    shares: 3_000_000n,
    underlying: 3_000_000n,
    maxRedeem: 3_000_000n,
  });
  const wd = deriveVaultConfirm(view, { mode: "withdraw", assets: 1_000_000n }, CTX);
  assert.equal(wd.withdrawReady, true);
  assert.ok(wd.redeemShares > 0n);
  assert.equal(wd.withdrawExec.kind, "withdraw");
  assert.ok(wd.withdrawExec.shares > 0n);
  assert.ok(wd.withdrawGuardN2.includes("bounded only by live Morpho liquidity"));
});

// ── fix 4: display and exec must agree — a wrapper whose asset() ≠ chain USDC is deposit fail-closed ──
test("wrapper with a non-USDC asset is deposit fail-closed", () => {
  const m = deriveVaultConfirm(
    makeView({ kind: "morpho_wrapper", factoryVerified: true, vault: WRAPPER, asset: NOT_USDC }),
    DEP,
    CTX,
  );
  assert.equal(m.depositReady, false);
  assert.equal(m.depositSignable, false);
  assert.equal(m.label, "Unsupported vault asset");
});

// ── the launch withdraw guard is unchanged (no Morpho wording) ──
test("launch withdraw keeps the plain N2 wording", () => {
  const view = makeView({ shares: 3_000_000n, underlying: 3_000_000n, maxRedeem: 3_000_000n });
  const wd = deriveVaultConfirm(view, { mode: "withdraw", assets: 1_000_000n }, CTX);
  assert.equal(wd.withdrawReady, true);
  assert.equal(wd.withdrawGuardN2, "Withdrawals are never paused or capped (N2)");
  assert.ok(!wd.withdrawGuardN2.includes("Morpho"));
});

// ── the launch withdraw receipt discloses the profit-only accrued fee, live %, no Morpho, no $ ──
test("launch withdraw: accrued-fee note is profit-only, live %, no Morpho, no fabricated $", () => {
  const view = makeView({ shares: 3_000_000n, underlying: 3_000_000n, maxRedeem: 3_000_000n });
  const wd = deriveVaultConfirm(view, { mode: "withdraw", assets: 1_000_000n }, CTX);
  assert.match(wd.withdrawFeeNote, /^Accrued performance fee: 10% of profit over your high-water mark/);
  assert.ok(wd.withdrawFeeNote.includes("0% to withdraw"));
  assert.ok(wd.withdrawFeeNote.includes("0% on your principal"));
  assert.ok(!wd.withdrawFeeNote.includes("Morpho"));
  assert.ok(!/\$/.test(wd.withdrawFeeNote), "no fabricated dollar figure");
});

// ── an attested wrapper withdraw note discloses the stacked Morpho curator fee ──
test("attested wrapper withdraw: accrued-fee note discloses the stacked Morpho curator fee", () => {
  const view = makeView({
    kind: "morpho_wrapper",
    factoryVerified: true,
    vault: WRAPPER,
    shares: 3_000_000n,
    underlying: 3_000_000n,
    maxRedeem: 3_000_000n,
  });
  const wd = deriveVaultConfirm(view, { mode: "withdraw", assets: 1_000_000n }, CTX);
  assert.ok(wd.withdrawFeeNote.includes("stacks on Morpho's curator fee"));
});
