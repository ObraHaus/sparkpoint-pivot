/**
 * vaultConfirmModel (011 Phase 4) — the PURE, JSX-free core of {@link useVaultConfirm}.
 *
 * Extracted so the gating + honest-copy DECISIONS (Aave-vs-Morpho framing, the stacked
 * double-fee disclosure, provenance fail-close, the N2 withdraw guarantee) are a plain
 * function over a `VaultConfirmView` — directly unit-testable under `node --test` (the web
 * test runner strips types but cannot resolve `@/…` / `@sparkpoint/…` extensionless ESM,
 * so nothing here imports them). The `.tsx` hook wraps this model's plain-data outputs in
 * the exact same JSX it always rendered, so the LAUNCH Aave vault path is byte-identical.
 *
 * kind ↔ address ↔ provenance contract (fix 5, IV.5)
 * --------------------------------------------------
 * A vault is treated as a WRAPPER when EITHER the caller tagged `kind === 'morpho_wrapper'`
 * OR the factory attested the address (`factoryVerified === true`). Attestation is the
 * trust root, not the free-form `kind`:
 *   • `morpho_wrapper` kind WITHOUT attestation  ⇒ still a wrapper, but DEPOSIT is fail-closed
 *     (`depositSignable === false`, CTA "Unverified vault") and the branded identity is
 *     suppressed — an unattested address is never presented as a SparkPoint vault.
 *   • factory-attested address ⇒ a wrapper regardless of a missing `kind`.
 * (`useVault` only reads `isSparkPointVault` when `kind === 'morpho_wrapper'`, so today
 * `factoryVerified` is populated only in that case; the OR keeps this robust if that widens.)
 *
 * WITHDRAW is NEVER gated on provenance (N2): a user who genuinely holds shares in a
 * not-yet-attested address can always exit — bounded only by live liquidity.
 */

import { formatUnits, type Address } from "viem";
import type { UseVaultResult, VaultKind, NetApyFraming } from "./useVault";
import type { DepositExec, WithdrawExec } from "./useExecuteVaultTx";

/** USDC / launch-share base-unit scale — the display default before a per-vault `decimals()` resolves. */
const DECIMALS = 6;

/** Raw base units → a JS number for the design's `fmt`/`money` display helpers. */
export function toNum(x: bigint | undefined, decimals = DECIMALS): number {
  return x === undefined ? 0 : Number(formatUnits(x, decimals));
}

function clampBig(x: bigint, lo: bigint, hi: bigint): bigint {
  return x < lo ? lo : x > hi ? hi : x;
}

/** What the caller wants to move: USDC assets, and (redeem-by-shares) optional shares. */
export interface VaultConfirmInput {
  readonly mode: "deposit" | "withdraw";
  /** USDC (6-dp base units) to deposit, or to withdraw (drives `redeemShares`). */
  readonly assets?: bigint;
  /** Vault shares to redeem directly (a `vault_redeem` proposedAction); overrides `assets`. */
  readonly shares?: bigint;
  /**
   * The vault to act on (011 multi-vault). OMITTED ⇒ the conservative launch Aave vault (unchanged
   * default). Pass a wrapper address + `kind: 'morpho_wrapper'` to deposit/withdraw a branded wrapper.
   */
  readonly vaultAddress?: Address;
  /** The vault kind — drives the honest copy (Aave vs Morpho) + the stacked double-fee disclosure. */
  readonly kind?: VaultKind;
  /** Registry label override for the branded wrapper (else its on-chain `label()`). */
  readonly label?: string;
}

/**
 * The subset of {@link UseVaultResult} the pure model reads. `UseVaultResult` is structurally
 * assignable to it (the hook passes `v` straight through); a test can fabricate a plain object.
 */
export type VaultConfirmView = Pick<
  UseVaultResult,
  | "kind"
  | "factoryVerified"
  | "label"
  | "chainId"
  | "account"
  | "vault"
  | "usdcAddress"
  | "asset"
  | "assetDecimals"
  | "isConnected"
  | "isDeployed"
  | "paused"
  | "shares"
  | "underlying"
  | "maxDeposit"
  | "maxRedeem"
  | "usdcBalance"
  | "previewDepositShares"
  | "needsApproval"
  | "refetch"
  | "netApy"
>;

/** Extra inputs the hook computes (policy/stage live behind `@sparkpoint`/`@/` — kept out of this pure core). */
export interface VaultConfirmContext {
  /** Gross (pre-fee) yield rate to frame the net APY from (bps). */
  readonly grossApyBps: number;
  /** The stage's cap noun ("beta cap"/…) for the over-cap CTA label. */
  readonly capNoun: string;
}

/** The plain-data derivation — everything the `.tsx` hook needs to assemble the confirm JSX. */
export interface VaultConfirmModel {
  readonly isWrapper: boolean;
  /** A wrapper whose address the factory attests — the ONLY case its branded identity may render. */
  readonly showWrapperIdentity: boolean;
  /** Display name: launch label, attested-wrapper branded label, else a neutral "vault" (never brand unattested). */
  readonly vaultName: string;
  readonly shareSymbol: string;
  readonly dec: number;

  readonly wantUnits: bigint;
  readonly depositShares: bigint;
  readonly redeemShares: bigint;
  readonly redeemAssetsOut: bigint;
  readonly usedAfter: bigint;
  readonly remaining: bigint;

  readonly netPct: number;
  readonly feePctInt: number;
  /** Honest Net-APY display: the launch Aave figure, or "—" for a wrapper (real net-of-both-fees APY is a 010 follow-up). */
  readonly netApyText: string;

  /** Deposit: connected+deployed+within cap/balance+not paused AND (launch OR an attested, USDC-asset wrapper). */
  readonly depositReady: boolean;
  /** Withdraw: connected + a real, redeemable position (NEVER cap/pause/provenance-gated — N2). */
  readonly withdrawReady: boolean;
  readonly ready: boolean;
  /** Whether a deposit exec may be signed at all — fail-closed `false` for an unattested/wrong-asset wrapper. */
  readonly depositSignable: boolean;

  readonly depositLabel: string;
  readonly withdrawLabel: string;
  readonly label: string;

  /** Deposit `sub` suffix — the honest "yield is Morpho, not Aave" note (or ""). */
  readonly subYieldNote: string;
  /** Deposit balance-change row for the performance fee — stacked double-fee disclosure for a wrapper. */
  readonly feeRow: [string, string, string];
  /** Deposit row making the 0% management/AUM fee explicit (SparkPoint never charges management fees). */
  readonly managementFeeRow: [string, string, string];
  /** Withdraw receipt line: profit-only fee, over HWM, already reflected in the returned amount; 0% to exit. */
  readonly withdrawFeeNote: string;
  /** Deposit balance-change row for the net APY — "—" for a wrapper (never a fabricated Aave figure). */
  readonly netApyRow: [string, string, string];
  /** Deposit guardrail: the honest yield venue (Aave for launch, Morpho for a wrapper). */
  readonly venueGuard: string;
  /** Withdraw guardrail: the N2 guarantee — liquidity-bounded wording for a wrapper. */
  readonly withdrawGuardN2: string;

  /** The resolved deposit intent (meaningful only when `ready`); the hook hands this to the confirm gate. */
  readonly depositExec: DepositExec;
  readonly withdrawExec: WithdrawExec;
}

/**
 * Compute the live figures, the ready/label gate, and the honest per-vault copy for `input`.
 * Pure over `v` + `ctx`; no effects, safe with a 0 amount (reads as not-ready until an amount +
 * wallet are present). See the file header for the provenance/N2 contract.
 */
export function deriveVaultConfirm(
  v: VaultConfirmView,
  input: VaultConfirmInput,
  ctx: VaultConfirmContext,
): VaultConfirmModel {
  const isDep = input.mode === "deposit";
  const wantUnits = input.assets ?? 0n;

  // ── vault identity → honest copy (011). Attestation (`factoryVerified === true`) is the trust
  //    root; a `morpho_wrapper` kind counts as a wrapper too but is fail-closed on deposit unless
  //    attested. The launch vault (neither) keeps its exact Aave copy. See the file header. ──
  const attested = v.factoryVerified === true;
  const isWrapper = v.kind === "morpho_wrapper" || attested;
  const showWrapperIdentity = isWrapper && attested;
  const vaultName = showWrapperIdentity ? v.label : isWrapper ? "vault" : v.label;
  const shareSymbol = isWrapper ? "shares" : "spvUSDC";
  const dec = v.assetDecimals; // read per vault — never hardcoded 6dp

  // Fix 4: a wrapper's deposit/approve token must be the token it actually pulls. We require the
  // wrapper's on-chain `asset()` to equal the chain USDC (Morpho USDC vaults use USDC) so the
  // approve/allowance (keyed to USDC in useVault) and the displayed 6-dp units agree — else deposit
  // is fail-closed. (Equivalent to deriving the token from `asset()`; here we assert consistency.)
  const assetMatchesUsdc =
    v.asset !== undefined &&
    v.usdcAddress !== undefined &&
    v.asset.toLowerCase() === v.usdcAddress.toLowerCase();
  const wrapperDepositSafe = attested && assetMatchesUsdc;
  /** Launch ⇒ always signable; wrapper ⇒ only when factory-attested AND its asset is the chain USDC. */
  const depositSignable = !isWrapper || wrapperDepositSafe;

  // Shares a withdraw redeems (linear convertToAssets), clamped to what's redeemable now (liquidity).
  const redeemShares = isDep
    ? 0n
    : input.shares !== undefined
      ? clampBig(input.shares, 0n, v.maxRedeem ?? input.shares)
      : v.shares !== undefined && v.underlying !== undefined && v.underlying > 0n && wantUnits > 0n
        ? clampBig((v.shares * wantUnits) / v.underlying, 0n, v.maxRedeem ?? v.shares)
        : 0n;

  const redeemAssetsOut =
    v.shares !== undefined && v.shares > 0n && v.underlying !== undefined
      ? (v.underlying * redeemShares) / v.shares
      : 0n;

  // ── live derived figures ───────────────────────────────────────────────────
  const framing: NetApyFraming = v.netApy(ctx.grossApyBps);
  const netPct = framing.netApyPct;
  const feePctInt = Math.round(framing.feeBps / 100);
  const depositShares = v.previewDepositShares ?? 0n;
  const usedAfter = (v.underlying ?? 0n) + wantUnits;
  const remaining = (v.underlying ?? 0n) - redeemAssetsOut;

  // ── gating ─────────────────────────────────────────────────────────────────
  const paused = v.paused === true;
  const overBalance = v.usdcBalance !== undefined && wantUnits > v.usdcBalance;
  const overCap = v.maxDeposit !== undefined && wantUnits > v.maxDeposit;
  const depositReady =
    v.isConnected &&
    v.isDeployed &&
    wantUnits > 0n &&
    !paused &&
    !overBalance &&
    !overCap &&
    depositSignable;
  const depositLabel = !v.isConnected
    ? "Connect your wallet"
    : !v.isDeployed
      ? "Switch to Base Sepolia"
      : wantUnits <= 0n
        ? "Enter an amount"
        : isWrapper && !attested
          ? "Unverified vault"
          : isWrapper && !assetMatchesUsdc
            ? "Unsupported vault asset"
            : paused
              ? "Deposits are paused"
              : overBalance
                ? "Insufficient USDC balance"
                : overCap
                  ? `Above your ${ctx.capNoun}`
                  : "Review deposit";

  // Withdraw: NEVER gated on beta/whitelist/provenance (N2). Only a connected wallet + a real,
  // redeemable position (the on-chain vault re-checks and never pause/cap-gates exits).
  const hasPosition = (v.shares ?? 0n) > 0n;
  const overRedeem = v.maxRedeem !== undefined && redeemShares > v.maxRedeem;
  const withdrawReady =
    v.isConnected && v.isDeployed && hasPosition && redeemShares > 0n && !overRedeem;
  const withdrawLabel = !v.isConnected
    ? "Connect your wallet"
    : !v.isDeployed
      ? "Switch to Base Sepolia"
      : !hasPosition
        ? "No position to withdraw"
        : redeemShares <= 0n
          ? "Enter an amount"
          : overRedeem
            ? "Above your available liquidity"
            : "Review withdrawal";

  const ready = isDep ? depositReady : withdrawReady;
  const label = isDep ? depositLabel : withdrawLabel;

  // ── honest per-vault copy (plain data; the hook renders identical JSX around it) ──
  const subYieldNote = isWrapper ? " Yield comes from Morpho, not Aave." : "";
  // For a wrapper the SparkPoint performance fee STACKS on TOP of the Morpho vault's own native
  // curator fee — both are disclosed (Constitution III / FR-023).
  const feeRow: [string, string, string] = isWrapper
    ? ["SparkPoint performance fee", `${feePctInt}% of yield — STACKS on Morpho's curator fee`, ""]
    : ["Performance fee", `${feePctInt}% of yield (over HWM)`, ""];
  // Honest APY (III): never frame a wrapper with the hardcoded Aave rate — show "—" until the
  // 010 market-data feed supplies the real net-of-both-fees APY (a separate, not-yet-built follow-up).
  const netApyText = isWrapper ? "—" : `${netPct.toFixed(2)}%`;
  const netApyRow: [string, string, string] = ["Net APY on new shares", netApyText, ""];
  // The 0% management/AUM fee, stated explicitly alongside the profit-only performance fee
  // (§3.7: "0% management, entry, and exit"). Identical launch + wrapper — never an AUM fee.
  const managementFeeRow: [string, string, string] = ["Management fee", "0% — none", "--gain"];
  // Withdraw receipt disclosure: the profit-only fee is taken as share dilution over the
  // high-water mark and is ALREADY reflected in the assets returned — nothing extra is withheld
  // to exit (N2). Keyed to the LIVE fee %, never a fabricated dollar figure.
  const withdrawFeeNote = isWrapper
    ? `Accrued performance fee: ${feePctInt}% of profit over your high-water mark — already reflected in your share price (stacks on Morpho's curator fee). 0% to withdraw, 0% on your principal.`
    : `Accrued performance fee: ${feePctInt}% of profit over your high-water mark — already reflected in your share price. 0% to withdraw, 0% on your principal.`;
  const venueGuard = isWrapper
    ? "Yield source — Morpho (external), not Aave"
    : "Allowlisted protocol — Aave v3 (Base)";
  const withdrawGuardN2 = isWrapper
    ? "SparkPoint never pauses/caps withdrawals; exit is bounded only by live Morpho liquidity (N2)."
    : "Withdrawals are never paused or capped (N2)";

  // ── the resolved intents (meaningful only when `ready`; the confirm gate re-checks + signs) ──
  const depositExec: DepositExec = {
    kind: "deposit",
    chainId: v.chainId as number,
    vault: v.vault as Address,
    // Proven to equal the wrapper's own `asset()` above (or the launch vault's USDC); matches the
    // allowance read in useVault so `needsApprove` stays consistent with what gets pulled.
    usdc: v.usdcAddress as Address,
    account: v.account as Address,
    assets: wantUnits,
    needsApprove: v.needsApproval(wantUnits),
    onDone: v.refetch,
  };
  const withdrawExec: WithdrawExec = {
    kind: "withdraw",
    chainId: v.chainId as number,
    vault: v.vault as Address,
    account: v.account as Address,
    shares: redeemShares,
    onDone: v.refetch,
  };

  return {
    isWrapper,
    showWrapperIdentity,
    vaultName,
    shareSymbol,
    dec,
    wantUnits,
    depositShares,
    redeemShares,
    redeemAssetsOut,
    usedAfter,
    remaining,
    netPct,
    feePctInt,
    netApyText,
    depositReady,
    withdrawReady,
    ready,
    depositSignable,
    depositLabel,
    withdrawLabel,
    label,
    subYieldNote,
    feeRow,
    managementFeeRow,
    withdrawFeeNote,
    netApyRow,
    venueGuard,
    withdrawGuardN2,
    depositExec,
    withdrawExec,
  };
}
