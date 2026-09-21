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
    curatedVerified: false,
    retired: false,
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

const CTX = { grossApyBps: 430, testnet: false, capNoun: "beta cap" } as const;
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

// ── 017: honest live-APY labels — "—" when the gross read is null; "≈0% (testnet)" at ~0 ──
test("net APY is '—' when the live Aave read is unavailable (gross null), never fabricated", () => {
  const m = deriveVaultConfirm(makeView(), DEP, { grossApyBps: null, testnet: true, capNoun: "beta cap" });
  assert.equal(m.netApyText, "—");
});

test("net APY reads '≈0% (testnet)' when the live rate is ~0 on testnet", () => {
  const m = deriveVaultConfirm(makeView(), DEP, { grossApyBps: 0, testnet: true, capNoun: "beta cap" });
  assert.equal(m.netApyText, "≈0% (testnet)");
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

// ── 024: a RETIRED vault is deposit-closed but withdraw-open (N2) ─────────────
// The Base-Sepolia demo wrapper is immutably bound to a MockMorphoVault whose simulation hooks have
// no access control, so deposits must fail-close. Retiring is OUR decision, and N2 says a SparkPoint
// decision may NEVER block an exit — so the withdraw path must be provably untouched by it.
test("retired vault: deposit fail-closes even when the wrapper is fully attested (024)", () => {
  const view = makeView({ kind: "morpho_wrapper", factoryVerified: true, vault: WRAPPER });
  const m = deriveVaultConfirm(view, { ...DEP, retired: true }, CTX);
  assert.equal(m.depositSignable, false);
  assert.equal(m.depositReady, false);
  assert.equal(m.label, "Vault retired — withdrawals only");
});

test("retired vault: the retired flag alone flips an otherwise-signable deposit (024)", () => {
  const view = makeView({ kind: "morpho_wrapper", factoryVerified: true, vault: WRAPPER });
  const live = deriveVaultConfirm(view, DEP, CTX);
  const dead = deriveVaultConfirm(view, { ...DEP, retired: true }, CTX);
  assert.equal(live.depositSignable, true); // same view, same amount — only `retired` differs
  assert.equal(dead.depositSignable, false);
});

test("retired vault: withdraw is byte-identical to not-retired — N2 is never our decision (024)", () => {
  const view = makeView({
    kind: "morpho_wrapper",
    factoryVerified: true,
    vault: WRAPPER,
    shares: 1_000_000n,
    underlying: 1_000_000n,
    maxRedeem: 1_000_000n,
  });
  const WD: VaultConfirmInput = { mode: "withdraw", assets: 500_000n };
  const open = deriveVaultConfirm(view, WD, CTX);
  const retired = deriveVaultConfirm(view, { ...WD, retired: true }, CTX);
  assert.equal(retired.withdrawReady, open.withdrawReady);
  assert.equal(retired.redeemShares, open.redeemShares);
  assert.equal(retired.label, open.label);
  assert.equal(retired.withdrawReady, true); // and it is genuinely open, not merely equal
});

test("launch vault is unaffected by the retired flag being absent (no regression, 024)", () => {
  const m = deriveVaultConfirm(makeView(), DEP, CTX);
  assert.equal(m.depositSignable, true);
});

// ── 024 REGRESSION: the fail-close must come from the VIEW, not from the caller ────────────────────
// A review found `/confirm/[intent]` mounts its own useVaultConfirm and renders ConfirmFlow directly,
// and it omitted `retired` — so a fully-attested retired wrapper was still deposit-signable there.
// `useVault` now resolves `retired` from the address book, so these assert the fail-close holds with
// `input.retired` ENTIRELY ABSENT. If someone adds a third mount point, it inherits this for free.
test("retired via the VIEW alone fail-closes deposit — input.retired absent (024 regression)", () => {
  const view = makeView({
    kind: "morpho_wrapper",
    factoryVerified: true, // attested
    vault: WRAPPER,
    retired: true, // resolved by useVault from the address book
  });
  const m = deriveVaultConfirm(view, DEP, CTX); // NOTE: no `retired` in the input
  assert.equal(m.depositSignable, false);
  assert.equal(m.depositReady, false);
  assert.equal(m.label, "Vault retired — withdrawals only");
});

test("retired via the VIEW alone still leaves withdraw fully open (N2, 024 regression)", () => {
  const base = {
    kind: "morpho_wrapper" as const,
    factoryVerified: true,
    vault: WRAPPER,
    shares: 1_000_000n,
    underlying: 1_000_000n,
    maxRedeem: 1_000_000n,
  };
  const WD: VaultConfirmInput = { mode: "withdraw", assets: 500_000n };
  const open = deriveVaultConfirm(makeView({ ...base, retired: false }), WD, CTX);
  const dead = deriveVaultConfirm(makeView({ ...base, retired: true }), WD, CTX);
  assert.equal(dead.withdrawReady, true);
  assert.equal(dead.withdrawReady, open.withdrawReady);
  assert.equal(dead.redeemShares, open.redeemShares);
  assert.equal(dead.label, open.label);
});

// ── 051 · the V3 universal wrapper (curated provenance, not factory attestation) ─────────────────

test("universal wrapper: curated-verified + matching asset is deposit-signable", () => {
  const m = deriveVaultConfirm(
    makeView({ kind: "universal_wrapper", curatedVerified: true, vault: WRAPPER, asset: USDC }),
    DEP,
    CTX,
  );
  assert.equal(m.isWrapper, true);
  assert.equal(m.showWrapperIdentity, true);
  assert.equal(m.depositSignable, true);
  assert.equal(m.depositReady, true);
  assert.equal(m.label, "Review deposit");
});

test("universal wrapper WITHOUT curated provenance fail-closes the deposit", () => {
  const m = deriveVaultConfirm(
    makeView({ kind: "universal_wrapper", curatedVerified: false, vault: WRAPPER, asset: USDC }),
    DEP,
    CTX,
  );
  assert.equal(m.isWrapper, true);
  assert.equal(m.showWrapperIdentity, false);
  assert.equal(m.vaultName, "vault");
  assert.equal(m.depositSignable, false);
  assert.equal(m.label, "Unverified vault");
});

test("universal wrapper over a non-USDG asset fail-closes with the honest label", () => {
  const m = deriveVaultConfirm(
    makeView({ kind: "universal_wrapper", curatedVerified: true, vault: WRAPPER, asset: NOT_USDC }),
    DEP,
    CTX,
  );
  assert.equal(m.depositSignable, false);
  assert.equal(m.label, "Unsupported vault asset");
});

test("universal wrapper shows the STORED curator-scan APY, labeled as such", () => {
  const m = deriveVaultConfirm(
    makeView({ kind: "universal_wrapper", curatedVerified: true, vault: WRAPPER, asset: USDC }),
    { ...DEP, curatedNetApyBps: 362 },
    CTX,
  );
  assert.equal(m.netApyText, "3.62% (curator scan)");
  // No stored figure ⇒ "—", never the Aave framing.
  const bare = deriveVaultConfirm(
    makeView({ kind: "universal_wrapper", curatedVerified: true, vault: WRAPPER, asset: USDC }),
    DEP,
    CTX,
  );
  assert.equal(bare.netApyText, "—");
});

test("universal wrapper withdraw is never provenance-gated (N2)", () => {
  const view = makeView({
    kind: "universal_wrapper",
    curatedVerified: false, // even an unverified wrapper
    vault: WRAPPER,
    asset: USDC,
    shares: 10_000_000_000n,
    underlying: 10_000_000n,
    maxRedeem: 9_999_999_999n, // OZ rounds maxRedeem down 1 wei — still redeemable
  });
  const m = deriveVaultConfirm(view, { mode: "withdraw", assets: 5_000_000n }, CTX);
  assert.equal(m.withdrawReady, true);
  assert.ok(m.redeemShares > 0n);
  assert.equal(m.label, "Review withdrawal");
});

// ── 053: the deposit asset's symbol in the blocked-balance label (USDG on 4663, USDC default) ──

test("053: an over-balance deposit names the vault's real asset (USDG), not USDC", () => {
  const m = deriveVaultConfirm(
    makeView({ usdcBalance: 1_000_000n }),
    { mode: "deposit", assets: 2_000_000n, assetSymbol: "USDG" },
    CTX,
  );
  assert.equal(m.label, "Insufficient USDG balance");
});

test("053: without an assetSymbol the label keeps the launch default (USDC)", () => {
  const m = deriveVaultConfirm(
    makeView({ usdcBalance: 1_000_000n }),
    { mode: "deposit", assets: 2_000_000n },
    CTX,
  );
  assert.equal(m.label, "Insufficient USDC balance");
});
