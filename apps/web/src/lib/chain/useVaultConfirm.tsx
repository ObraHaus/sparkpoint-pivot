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
 *
 * The gating + honest-copy DECISIONS live in the pure, JSX-free {@link deriveVaultConfirm}
 * (vaultConfirmModel.ts) so they are directly unit-testable; this hook only wires the LIVE
 * `useVault` reads into it and wraps its plain-data outputs in the design's JSX. The launch
 * Aave vault path renders byte-identically to before — the wrapper branches (011) are latent
 * until a caller passes a `vaultAddress` + `kind`.
 */

import { money, fmt } from "@/lib/utils";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { useVault, type UseVaultResult } from "@/lib/chain/useVault";
import { capNoun } from "@/lib/stage";
import {
  deriveVaultConfirm,
  toNum,
  type VaultConfirmInput,
  type VaultConfirmModel,
} from "@/lib/chain/vaultConfirmModel";
import type { OnchainConfirm } from "@/components/ui/ConfirmFlow";

// Re-exported for the existing call sites (`_amount-screen.tsx` imports `toNum` from here).
export { toNum };
export type { VaultConfirmInput };

/**
 * Aave USDC supply-rate estimate (bps) — frames the net-of-fee APY for the LAUNCH vault. The
 * performance fee applied is LIVE from the chain (`useVault.netApy`); only the gross Aave rate is
 * an off-chain estimate. A wrapper is NEVER framed with this figure — its Net APY renders "—"
 * (honest; the real net-of-both-fees APY is a 010 market-data follow-up).
 */
const AAVE_SUPPLY_APY_BPS = 430;

/** Per-user beta cap (raw USDC base units) for a chain; fail-closed to 0 on unsupported. */
function perUserCapRaw(chainId: number | undefined): bigint {
  if (chainId === undefined) return 0n;
  try {
    return getPolicyConstants(chainId).caps.perUserTvl.amount;
  } catch {
    return 0n;
  }
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
  /** Honest display name for the selected vault (launch label, an attested wrapper's on-chain label, or generic "vault"). */
  readonly vaultName: string;
  /** Share-token symbol for copy ("spvUSDC" launch; generic "shares" for a wrapper). */
  readonly shareSymbol: string;
  /** Honest Net-APY text: the launch figure, or "—" for a wrapper (no fabricated APY). */
  readonly netApyText: string;
  /** True when the selected vault is a branded Morpho wrapper (drives honest copy). */
  readonly isWrapper: boolean;
  readonly usedAfter: bigint;
  readonly remaining: bigint;
  /** Deposit: connected+deployed+within cap/balance+not paused+(attested wrapper). Withdraw: connected+position+redeemable (never cap/pause/provenance-gated). */
  readonly ready: boolean;
  /** The CTA/blocked label (e.g. "Review deposit" / "Connect your wallet" / "Unverified vault"). */
  readonly label: string;
  /** The REAL execution config for the confirm gate (only meaningful when `ready`). */
  readonly onchain: OnchainConfirm;
}

/**
 * Compute the live figures, the ready/label gate, and the real `OnchainConfirm` for
 * `input`. Reads via `useVault`; the derivation is the pure {@link deriveVaultConfirm}.
 * Safe to call with a 0 amount (everything reads as not-ready until an amount + wallet).
 */
export function useVaultConfirm(input: VaultConfirmInput): VaultConfirmState {
  const isDep = input.mode === "deposit";
  const wantUnits = input.assets ?? 0n;

  const v = useVault({
    previewDepositAssets: isDep && wantUnits > 0n ? wantUnits : undefined,
    vaultAddress: input.vaultAddress,
    kind: input.kind,
    label: input.label,
  });

  const m: VaultConfirmModel = deriveVaultConfirm(v, input, {
    grossApyBps: AAVE_SUPPLY_APY_BPS,
    capNoun,
  });

  const capRaw = perUserCapRaw(v.chainId);
  const { dec, vaultName, shareSymbol } = m;

  // ── the REAL execution config handed to ConfirmFlow (meaningful only when `ready`). The rows/guards
  //    come from the pure model; only the amount-formatted (`fmt`/`money`) cells + the branded JSX
  //    fragments are assembled here — the launch vault renders exactly as before. ──
  const onchain: OnchainConfirm = isDep
    ? {
        exec: m.depositExec,
        sub: (
          <>
            You&rsquo;re depositing {fmt(toNum(wantUnits, dec))} USDC into the {vaultName}. You&rsquo;ll receive ≈{" "}
            {fmt(toNum(m.depositShares, dec), 1)} {shareSymbol}.
            {m.subYieldNote}
          </>
        ),
        bc: [
          ["USDC out", `−${fmt(toNum(wantUnits, dec))} USDC`, "--loss"],
          [`${shareSymbol} in`, `+${fmt(toNum(m.depositShares, dec), 1)} ${shareSymbol}`, "--gain"],
          ["Network fee (gas)", "Paid in ETH at signing", ""],
          ["Fee on this deposit", "0% — none", "--gain"],
          m.feeRow,
          m.netApyRow,
        ],
        guards: [
          <>Within your beta cap ({money(toNum(capRaw), 0)})</>,
          "Slippage under your max (0.5%)",
          m.venueGuard,
        ],
        okBody: (
          <>
            Your USDC is now earning in the {vaultName} — you deposited {fmt(toNum(wantUnits, dec))} USDC for ≈{" "}
            {fmt(toNum(m.depositShares, dec), 1)} {shareSymbol}.
          </>
        ),
      }
    : {
        exec: m.withdrawExec,
        sub: (
          <>
            You&rsquo;re withdrawing {fmt(toNum(m.redeemAssetsOut, dec))} USDC from the {vaultName} to your wallet.
          </>
        ),
        bc: [
          [`${shareSymbol} redeemed`, `−${fmt(toNum(m.redeemShares, dec), 1)} ${shareSymbol}`, "--loss"],
          ["USDC in", `+${fmt(toNum(m.redeemAssetsOut, dec))} USDC`, "--gain"],
          ["Network fee (gas)", "Paid in ETH at signing", ""],
          ["Fee on this withdrawal", "0% — none", "--gain"],
        ],
        guards: ["Redeemed to your own wallet", m.withdrawGuardN2],
        okBody: <>{money(toNum(m.redeemAssetsOut, dec))} is back in your wallet.</>,
      };

  return {
    v,
    wantUnits,
    depositShares: m.depositShares,
    redeemShares: m.redeemShares,
    redeemAssetsOut: m.redeemAssetsOut,
    capRaw,
    netPct: m.netPct,
    feePctInt: m.feePctInt,
    vaultName,
    shareSymbol,
    netApyText: m.netApyText,
    isWrapper: m.isWrapper,
    usedAfter: m.usedAfter,
    remaining: m.remaining,
    ready: m.ready,
    label: m.label,
    onchain,
  };
}
