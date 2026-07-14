"use client";

/**
 * BetaGate (T047) — the DISPLAY for the "beta — not yet enabled" state on the
 * DEPOSIT / transacting path.
 *
 * Non-custody law: this is a DEPOSIT-ONLY affordance. It gates NOTHING by itself — a
 * parent renders it IN PLACE OF the deposit form when `useBeta().canTransact` is false.
 * It never appears on /exit, /trust, or the withdraw path, and it ALWAYS surfaces the
 * on-chain exit link, because withdrawals stay open to everyone during the beta and even
 * while deposits are paused (N2). The beta limit is on NEW DEPOSITS only.
 *
 * Matches the app's style using only existing global classes/tokens (design parity):
 * `.page.page-narrow`, `.pagehead`, `.card.card-pad`, `.btn`, `.qlink`, `.divider`,
 * `.tnum`, and the CSS custom-property tokens.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T047.
 */

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useBeta, type BetaBlockReason } from "@/lib/auth/whitelist";

export interface BetaGateProps {
  /** Override the block reason (defaults to the connected wallet's live reason). */
  readonly reason?: BetaBlockReason | null;
}

/** Truncated address for a display reference. */
function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function BetaGate({ reason }: BetaGateProps = {}) {
  const beta = useBeta();
  const r = reason ?? beta.reason;
  const isGeo = r?.kind === "geo_blocked";

  return (
    <div className="page page-narrow">
      <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={toHref("vault")}>
        <Icon name="chevr" size={15} /> Back to vault
      </Link>

      <div className="pagehead">
        <div>
          <h1>{isGeo ? "Deposits aren’t available in your region" : "Deposits are in private beta"}</h1>
          <div className="sub">
            {isGeo
              ? "New deposits aren’t available from your location yet — withdrawals are unaffected."
              : "New deposits are gated while we roll out the beta — your wallet isn’t enabled yet."}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <span style={{ color: "var(--primary)", marginTop: 1 }}>
            <Icon name="lock" size={18} />
          </span>
          <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
            {isGeo
              ? "Depositing new funds isn’t available from your region during the private beta. This is a limit on new deposits only — nothing else is restricted."
              : "Depositing new funds is limited to allowlisted wallets during the private beta. This limit applies to new deposits only — nothing else is restricted."}
            {beta.address !== undefined && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Connected wallet <span className="tnum">{shortAddress(beta.address)}</span> isn’t enabled yet.
              </div>
            )}
          </div>
        </div>

        <div className="divider" />

        {/* Non-custody: withdrawals + on-chain exit are ALWAYS open, even in beta. */}
        <div
          style={{
            display: "flex",
            gap: 11,
            alignItems: "flex-start",
            padding: "12px 14px",
            background: "var(--background)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius)",
          }}
        >
          <span style={{ color: "var(--gain)", marginTop: 1 }}>
            <Icon name="shieldcheck" size={18} />
          </span>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
            <b style={{ color: "var(--foreground)" }}>Your funds are never locked.</b> Withdrawals and on-chain exit
            stay open to everyone during the beta — even while deposits are paused. The beta only limits new deposits.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Link className="btn btn-outline btn-md" href={toHref("exit")}>
            <Icon name="door" size={16} /> Withdraw / Exit
          </Link>
          <Link className="btn btn-ghost btn-md" href={toHref("trust")}>
            <Icon name="shieldcheck" size={16} /> Trust Center
          </Link>
        </div>

        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 12 }}>
          You’ll be able to deposit here as soon as your wallet is enabled.
        </div>
      </div>
    </div>
  );
}
