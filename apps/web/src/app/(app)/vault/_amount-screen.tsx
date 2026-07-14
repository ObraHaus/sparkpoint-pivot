"use client";

/**
 * Shared deposit / withdraw amount panel — the design's `amountScreen(host, mode)`
 * (docs/design-handover/showcase/screens/vault.js), now driven by the LIVE vault.
 *
 * The "You'll receive ≈ / redeem ≈", the beta-cap-after line, and the remaining-position
 * line recompute from the LIVE ERC-4626 previews (`previewDeposit` / `previewRedeem`, read
 * direct-RPC via useVault — rounding favors the vault, agent-service-api.md §3.7) as the
 * typed amount changes. All markup/classes/copy are preserved verbatim; only the numbers
 * and the confirm ACTION go live.
 *
 * GATING (T047 per-user-cap gate). DEPOSIT is a transacting path: its Review button is
 * gated on a connected wallet, a deployed vault, the live per-user cap / idle balance, and
 * `paused()`. The beta WHITELIST gate sits ONE level up (vault/deposit/page.tsx renders
 * <BetaGate/> when `useBeta().canTransact` is false) — so this shared file imports NEITHER
 * `useBeta` nor `BetaGate`, and the WITHDRAW route is NEVER gated by client state (only a
 * connected wallet + an actual position). Non-custody law, N2: withdraw-is-sacred.
 *
 * On confirm, mounts the SHARED confirm gate <ConfirmFlow … mount="route" onchain={…} />
 * with the REAL approve+deposit / redeem execution path.
 */

import { useState } from "react";
import Link from "next/link";
import { parseUnits, formatUnits, type Address } from "viem";
import { Icon } from "@/lib/icons";
import { money, fmt } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { ConfirmFlow, type OnchainConfirm } from "@/components/ui/ConfirmFlow";
import { useVault } from "@/lib/chain/useVault";
import "@/components/screens/vault.css";

const DECIMALS = 6;

/**
 * Aave USDC supply-rate estimate (bps). The Aave rate itself is indexer-sourced (not a
 * pure-RPC vault read); it frames the net-of-fee APY here, where the PERFORMANCE FEE is
 * LIVE from the chain (useVault.netApy → net = gross × (1 − liveFeeBps/10000)).
 */
const AAVE_SUPPLY_APY_BPS = 430;

/** Parse a typed USDC amount ("2,150.00") into 6-dp base units; never throws. */
function parseUnitsSafe(s: string): bigint {
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return 0n;
  try {
    return parseUnits(cleaned, DECIMALS);
  } catch {
    return 0n;
  }
}

/** Raw base units → a JS number for the design's `fmt`/`money` display helpers. */
function toNum(x: bigint | undefined, decimals = DECIMALS): number {
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

export function AmountScreen({ mode }: { mode: "deposit" | "withdraw" }) {
  const isDep = mode === "deposit";
  const [amount, setAmount] = useState("");
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const wantUnits = parseUnitsSafe(amount);

  const v = useVault({
    previewDepositAssets: isDep && wantUnits > 0n ? wantUnits : undefined,
  });

  // Shares a withdraw of `wantUnits` USDC redeems — the linear inverse of convertToAssets
  // (underlying == convertToAssets(shares)), clamped to what's redeemable right now
  // (maxRedeem, i.e. Aave liquidity). Derived during render (no effect); the exact USDC
  // returned is shown as an estimate ("≈") — the tx redeems these shares.
  const redeemShares =
    !isDep && v.shares !== undefined && v.underlying !== undefined && v.underlying > 0n && wantUnits > 0n
      ? clampBig((v.shares * wantUnits) / v.underlying, 0n, v.maxRedeem ?? v.shares)
      : 0n;
  // USDC returned for `redeemShares` at the current share price (convertToAssets-linear).
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
  // Deposit: connected + deployed + within the live per-user cap / idle balance + not paused.
  // (The beta whitelist gate lives at the parent route — see the file header.)
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

  // Withdraw: NEVER gated on beta/whitelist. Only a connected wallet + a real, redeemable
  // position (the on-chain vault re-checks and never pause/cap-gates withdrawals — N2).
  const hasPosition = (v.shares ?? 0n) > 0n;
  const overRedeem = v.maxRedeem !== undefined && redeemShares > v.maxRedeem;
  const withdrawReady =
    v.isConnected && v.isDeployed && hasPosition && wantUnits > 0n && redeemShares > 0n && !overRedeem;
  const withdrawLabel = !v.isConnected
    ? "Connect your wallet"
    : !v.isDeployed
      ? "Switch to Base Sepolia"
      : !hasPosition
        ? "No position to withdraw"
        : wantUnits <= 0n
          ? "Enter an amount"
          : overRedeem
            ? "Above your available liquidity"
            : "Review withdrawal";

  const ready = isDep ? depositReady : withdrawReady;
  const ctaLabel = isDep ? depositLabel : withdrawLabel;

  const onMax = () =>
    setAmount(formatUnits(isDep ? v.usdcBalance ?? 0n : v.underlying ?? 0n, DECIMALS));

  // ── the REAL execution config handed to ConfirmFlow (only reached when `ready`) ──
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
          "Simulation passed — no risks detected",
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
          ["Fee on this deposit", "0% — none", "--gain"],
        ],
        guards: [
          <>Within your beta cap ({money(toNum(capRaw), 0)})</>,
          "Slippage under your max (0.5%)",
          "Allowlisted protocol — Aave v3 (Base)",
          "Simulation passed — no risks detected",
        ],
        okBody: <>{money(toNum(redeemAssetsOut))} is back in your wallet.</>,
      };

  if (confirming) {
    return <ConfirmFlow intent={mode} mount="route" onchain={onchain} />;
  }

  return (
    <div className="page page-narrow">
      <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={toHref("vault")}>
        <Icon name="chevr" size={15} /> Back to vault
      </Link>
      <div className="pagehead">
        <div>
          <h1>{isDep ? "Deposit USDC" : "Withdraw"}</h1>
          <div className="sub">
            {isDep
              ? `Into the Aave Yield Vault · ${netPct.toFixed(2)}% net APY (estimate)`
              : "Withdraw anytime — even if Sparky is offline"}
          </div>
        </div>
        <RiskChip tier={1} />
      </div>
      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 16 }}>
          <label>{isDep ? "Amount to deposit" : "Amount to withdraw"}</label>
          <div className={"amtbox" + (focused ? " focus" : "")} id="amtbox">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                className="input big"
                id="amt"
                inputMode="decimal"
                placeholder="0.00"
                style={{ border: "none", boxShadow: "none", padding: 0, background: "none" }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              />
              <span style={{ fontSize: 18, fontWeight: 600, color: "var(--muted-foreground)" }}>USDC</span>
              <button className="btn btn-ghost btn-sm" id="maxbtn" onClick={onMax}>
                Max
              </button>
            </div>
          </div>
          <div className="hint">
            {isDep
              ? `Max ${money(toNum(v.usdcBalance))} (idle) · ${money(toNum(capRaw), 0)} beta cap`
              : `You hold ${money(toNum(v.underlying))} · withdraw any amount`}
          </div>
        </div>
        <div
          style={{
            background: "var(--background)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius)",
            padding: 14,
            marginBottom: 8,
          }}
        >
          {isDep ? (
            <>
              <div className="preview-row">
                <span className="muted">You&apos;ll receive ≈</span>
                <span className="tnum">{fmt(toNum(depositShares, DECIMALS), 1)} spvUSDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">Net APY</span>
                <span className="tnum">
                  {netPct.toFixed(2)}%{" "}
                  <a className="cite" style={{ cursor: "pointer" }}>
                    breakdown
                  </a>
                </span>
              </div>
              <div className="preview-row">
                <span className="muted">Beta cap after</span>
                <span className="tnum">
                  {money(toNum(usedAfter), 0)} / {money(toNum(capRaw), 0)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="preview-row">
                <span className="muted">You&apos;ll redeem ≈</span>
                <span className="tnum">{fmt(toNum(redeemShares, DECIMALS), 1)} spvUSDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">You&apos;ll receive</span>
                <span className="tnum">≈ {fmt(toNum(redeemAssetsOut))} USDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">Remaining position</span>
                <span className="tnum">{money(toNum(remaining))}</span>
              </div>
            </>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 16 }}>
          {isDep
            ? "Estimates, not guarantees. Shares: your fixed slice of the vault; its USDC value grows as the vault earns."
            : "No fees to exit. Nothing moves until you sign."}
        </div>
        <button
          className="btn btn-primary btn-lg"
          style={{ width: "100%" }}
          disabled={!ready}
          onClick={() => setConfirming(true)}
        >
          {ctaLabel}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
          Next: simulation + guardrail check, then you sign.
        </div>
      </div>
    </div>
  );
}
