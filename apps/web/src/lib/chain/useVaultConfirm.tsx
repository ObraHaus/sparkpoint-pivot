"use client";

/**
 * useVaultConfirm (P0.1) — the single source of truth that turns a LIVE vault read
 * + an amount into the REAL execution config (`OnchainConfirm`) the shared confirm
 * gate signs. Extracted from the vault amount screen so the chat's inline
 * vault-action cards drive the EXACT same real approve/deposit / redeem path with
 * the live figures — no second, divergent copy of the maths, and never a mock.
 *
 * Every number here comes from `useVault` (direct-RPC ERC-4626 reads; rounding
 * favors the vault, agent-service-api.md §3.7). The returned `onchain.exec` is the
 * real `VaultExec` for `useExecuteVaultTx`; `ready`/`label` gate whether a Sign can
 * even be offered (connected + deployed + within the live cap / balance, not paused;
 * withdraw is NEVER cap/pause-gated — N2). Nothing here signs or holds a key.
 */

import { formatUnits, type Address } from "viem";
import { money, fmt } from "@/lib/utils";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { useVault, type UseVaultResult } from "@/lib/chain/useVault";
import type { OnchainConfirm } from "@/components/ui/ConfirmFlow";

const DECIMALS = 6;

/**
 * Aave USDC supply-rate estimate (bps) — frames the net-of-fee APY. The performance
 * fee applied is LIVE from the chain (`useVault.netApy`); only the gross Aave rate is
 * an off-chain estimate.
 */
const AAVE_SUPPLY_APY_BPS = 430;

/** Raw base units → a JS number for the design's `fmt`/`money` display helpers. */
export function toNum(x: bigint | undefined, decimals = DECIMALS): number {
  return x === undefined ? 0 : Number(formatUnits(x, decimals));
}

function clampBig(x: bigint, lo: bigint, hi: bigint): bigint {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Per-user beta cap (raw USDC base units) for a chain; fail-closed to 0 on unsupported. */
function perUserCapRaw(chainId: number | undefined): bigint {
  if (chainId === undefined) return 0n;
  try {
    return getPolicyConstants(chainId).caps.perUserTvl.amount;
  } catch {
    return 0n;
  }
}

/** What the caller wants to move: USDC assets, and (redeem-by-shares) optional shares. */
export interface VaultConfirmInput {
  readonly mode: "deposit" | "withdraw";
  /** USDC (6-dp base units) to deposit, or to withdraw (drives `redeemShares`). */
  readonly assets?: bigint;
  /** Vault shares to redeem directly (a `vault_redeem` proposedAction); overrides `assets`. */
  readonly shares?: bigint;
}

export interface VaultConfirmState {
  readonly v: UseVaultResult;
  readonly wantUnits: bigint;
  readonly depositShares: bigint;
  readonly redeemShares: bigint;
  readonly redeemAssetsOut: bigint;
  readonly capRaw: bigint;
  readonly netPct: number;
  readonly feePctInt: number;
  readonly usedAfter: bigint;
  readonly remaining: bigint;
  /** Deposit: connected+deployed+within cap/balance+not paused. Withdraw: connected+position+redeemable (never cap/pause-gated). */
  readonly ready: boolean;
  /** The CTA/blocked label (e.g. "Review deposit" / "Connect your wallet" / "Above your beta cap"). */
  readonly label: string;
  /** The REAL execution config for the confirm gate (only meaningful when `ready`). */
  readonly onchain: OnchainConfirm;
}

/**
 * Compute the live figures, the ready/label gate, and the real `OnchainConfirm` for
 * `input`. Pure derivation over `useVault` (no effects); safe to call with a 0 amount
 * (everything reads as not-ready until an amount + wallet are present).
 */
export function useVaultConfirm(input: VaultConfirmInput): VaultConfirmState {
  const isDep = input.mode === "deposit";
  const wantUnits = input.assets ?? 0n;

  const v = useVault({
    previewDepositAssets: isDep && wantUnits > 0n ? wantUnits : undefined,
  });

  // Shares a withdraw redeems. Prefer an explicit shares amount (redeem-by-shares);
  // otherwise convert the USDC amount at the current share price (convertToAssets is
  // linear: underlying == convertToAssets(shares)), clamped to what's redeemable now
  // (maxRedeem, i.e. Aave liquidity).
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
  const framing = v.netApy(AAVE_SUPPLY_APY_BPS);
  const netPct = framing.netApyPct;
  const feePctInt = Math.round(framing.feeBps / 100);
  const capRaw = perUserCapRaw(v.chainId);

  const depositShares = v.previewDepositShares ?? 0n;
  const usedAfter = (v.underlying ?? 0n) + wantUnits;
  const remaining = (v.underlying ?? 0n) - redeemAssetsOut;

  // ── gating ─────────────────────────────────────────────────────────────────
  const paused = v.paused === true;
  const overBalance = v.usdcBalance !== undefined && wantUnits > v.usdcBalance;
  const overCap = v.maxDeposit !== undefined && wantUnits > v.maxDeposit;
  const depositReady =
    v.isConnected && v.isDeployed && wantUnits > 0n && !paused && !overBalance && !overCap;
  const depositLabel = !v.isConnected
    ? "Connect your wallet"
    : !v.isDeployed
      ? "Switch to Base Sepolia"
      : wantUnits <= 0n
        ? "Enter an amount"
        : paused
          ? "Deposits are paused"
          : overBalance
            ? "Insufficient USDC balance"
            : overCap
              ? "Above your beta cap"
              : "Review deposit";

  // Withdraw: NEVER gated on beta/whitelist (N2). Only a connected wallet + a real,
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

  // ── the REAL execution config handed to ConfirmFlow (meaningful only when `ready`) ──
  const onchain: OnchainConfirm = isDep
    ? {
        exec: {
          kind: "deposit",
          chainId: v.chainId as number,
          vault: v.vault as Address,
          usdc: v.usdcAddress as Address,
          account: v.account as Address,
          assets: wantUnits,
          needsApprove: v.needsApproval(wantUnits),
          onDone: v.refetch,
        },
        sub: (
          <>
            You&rsquo;re depositing {fmt(toNum(wantUnits))} USDC into the Aave Yield Vault. You&rsquo;ll receive ≈{" "}
            {fmt(toNum(depositShares, DECIMALS), 1)} spvUSDC.
          </>
        ),
        bc: [
          ["USDC out", `−${fmt(toNum(wantUnits))} USDC`, "--loss"],
          ["spvUSDC in", `+${fmt(toNum(depositShares, DECIMALS), 1)} spvUSDC`, "--gain"],
          ["Network fee (gas)", "Paid in ETH at signing", ""],
          ["Fee on this deposit", "0% — none", "--gain"],
          ["Performance fee", `${feePctInt}% of yield (over HWM)`, ""],
          ["Net APY on new shares", `${netPct.toFixed(2)}%`, ""],
        ],
        guards: [
          <>Within your beta cap ({money(toNum(capRaw), 0)})</>,
          "Slippage under your max (0.5%)",
          "Allowlisted protocol — Aave v3 (Base)",
        ],
        okBody: (
          <>
            Your USDC is now earning in the Aave Yield Vault — you deposited {fmt(toNum(wantUnits))} USDC for ≈{" "}
            {fmt(toNum(depositShares, DECIMALS), 1)} spvUSDC.
          </>
        ),
      }
    : {
        exec: {
          kind: "withdraw",
          chainId: v.chainId as number,
          vault: v.vault as Address,
          account: v.account as Address,
          shares: redeemShares,
          onDone: v.refetch,
        },
        sub: <>You&rsquo;re withdrawing {fmt(toNum(redeemAssetsOut))} USDC from the Aave Yield Vault to your wallet.</>,
        bc: [
          ["spvUSDC redeemed", `−${fmt(toNum(redeemShares, DECIMALS), 1)} spvUSDC`, "--loss"],
          ["USDC in", `+${fmt(toNum(redeemAssetsOut))} USDC`, "--gain"],
          ["Network fee (gas)", "Paid in ETH at signing", ""],
          ["Fee on this withdrawal", "0% — none", "--gain"],
        ],
        guards: ["Redeemed to your own wallet", "Withdrawals are never paused or capped (N2)"],
        okBody: <>{money(toNum(redeemAssetsOut))} is back in your wallet.</>,
      };

  return {
    v,
    wantUnits,
    depositShares,
    redeemShares,
    redeemAssetsOut,
    capRaw,
    netPct,
    feePctInt,
    usedAfter,
    remaining,
    ready,
    label,
    onchain,
  };
}
