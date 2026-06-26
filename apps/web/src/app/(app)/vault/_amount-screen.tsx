"use client";

/**
 * Shared deposit / withdraw amount panel — the design's `amountScreen(host, mode)`
 * (docs/design-handover/showcase/screens/vault.js), with a LIVE shares preview that
 * recomputes as the amount changes (the design showed static figures; here the
 * "You'll receive ≈ / redeem ≈", beta-cap-after, and remaining-position lines update
 * with the typed amount). All copy is preserved verbatim.
 *
 * On confirm, mounts the SHARED confirm gate <ConfirmFlow … mount="route" />.
 */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money, fmt } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { ConfirmFlow } from "@/components/ui/ConfirmFlow";
import "@/components/screens/vault.css";

const v = data.vault;

/** Parse a formatted amount string ("2,150.00") into a number. */
function parseAmt(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * USDC-per-share rates chosen so the design's default amounts reproduce its exact
 * preview figures (2,150 → 2,118.4 spvUSDC on deposit; 5,000 → 4,902.1 on withdraw).
 */
const DEP_RATE = 2150 / 2118.4;
const WD_RATE = 5000 / 4902.1;

export function AmountScreen({ mode }: { mode: "deposit" | "withdraw" }) {
  const isDep = mode === "deposit";
  const [amount, setAmount] = useState(isDep ? "2,150.00" : "5,000.00");
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const amt = parseAmt(amount);

  if (confirming) {
    return <ConfirmFlow intent={mode} mount="route" />;
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
            {isDep ? `Into the Aave Yield Vault · ${v.netApy}% net APY (estimate)` : "Withdraw anytime — even if SparkPoint is offline"}
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
              <button
                className="btn btn-ghost btn-sm"
                id="maxbtn"
                onClick={() => setAmount(isDep ? fmt(data.idleUSDC) : fmt(v.shareValue))}
              >
                Max
              </button>
            </div>
          </div>
          <div className="hint">
            {isDep
              ? `Max ${money(data.idleUSDC)} (idle) · ${money(v.capUser, 0)} beta cap`
              : `You hold ${money(v.shareValue)} · withdraw any amount`}
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
                <span className="tnum">{fmt(amt / DEP_RATE, 1)} spvUSDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">Net APY</span>
                <span className="tnum">
                  {v.netApy}%{" "}
                  <a className="cite" style={{ cursor: "pointer" }}>
                    breakdown
                  </a>
                </span>
              </div>
              <div className="preview-row">
                <span className="muted">Beta cap after</span>
                <span className="tnum">
                  {money(v.capUsed + amt, 0)} / {money(v.capUser, 0)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="preview-row">
                <span className="muted">You&apos;ll redeem ≈</span>
                <span className="tnum">{fmt(amt / WD_RATE, 1)} spvUSDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">You&apos;ll receive</span>
                <span className="tnum">≈ {fmt(amt)} USDC</span>
              </div>
              <div className="preview-row">
                <span className="muted">Remaining position</span>
                <span className="tnum">{money(v.shareValue - amt)}</span>
              </div>
            </>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 16 }}>
          {isDep
            ? "Estimates, not guarantees. Shares: your fixed slice of the vault; its USDC value grows as the vault earns."
            : "No fees to exit. Nothing moves until you sign."}
        </div>
        <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={() => setConfirming(true)}>
          {isDep ? "Review deposit" : "Review withdrawal"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
          Next: simulation + guardrail check, then you sign.
        </div>
      </div>
    </div>
  );
}
