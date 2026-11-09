"use client";

/**
 * 078 — Rhea same-chain live earn UI (supply + withdraw).
 *
 * Flow: connect the user's NEAR wallet → request a READ-ONLY preflight of unsigned actions → show a
 * review screen → the user ticks an explicit acknowledgement → the wallet signs/sends. The adapter
 * re-reads the connected account immediately before the send and refuses a wallet switch. After
 * send, the UI polls a read-only receipt route and reports confirmed/failed/pending honestly.
 *
 * This does NOT implement 071's cross-chain MCA/1Click Phase C path. Same-chain NEAR only.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import type { NearTransaction } from "@/lib/near/burrow";
import { firstTransactionHash } from "@/lib/near/burrow";
import {
  RHEA_LIVE_MARKET,
  confirmBlocker,
  confirmBlockerCopy,
  publicLiveRheaEnabled,
  reviewLines,
  type LiveEarnAction,
  type PreflightReview,
} from "@/lib/near/liveEarn";
import { useNearWallet } from "@/lib/near/NearWalletProvider";

const MUTED = "var(--muted-foreground)";

type Phase = "idle" | "review" | "sending" | "polling" | "done";

interface PreflightResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  action?: LiveEarnAction;
  accountId?: string;
  amount?: string;
  amountRaw?: string;
  transactions?: NearTransaction[];
  review?: PreflightReview;
}

interface ReceiptResponse {
  ok?: boolean;
  status?: "confirmed" | "failed" | "pending";
  error?: string | null;
  message?: string;
}

function Panel({ children, tone }: { children: React.ReactNode; tone?: "caution" | "loss" | "gain" }) {
  const color = tone === "caution" ? "var(--caution)" : tone === "loss" ? "var(--loss)" : tone === "gain" ? "var(--gain)" : "var(--info)";
  return (
    <div
      style={{
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
        color,
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

export function RheaLiveEarn() {
  const enabled = publicLiveRheaEnabled();
  const { accountId, status, error: walletError, connect, getConnectedAccount, sendTransactions } = useNearWallet();
  const [action, setAction] = useState<LiveEarnAction>("supply");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [review, setReview] = useState<PreflightReview | null>(null);
  const [transactions, setTransactions] = useState<readonly NearTransaction[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; error: string | null } | null>(null);

  const lines = useMemo(() => (review ? reviewLines(review) : []), [review]);
  const busy = phase === "sending" || phase === "polling";

  useEffect(() => {
    if (phase !== "polling" || !txHash || !review) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const res = await fetch(
          `/api/earn/rhea/receipt?txHash=${encodeURIComponent(txHash)}&accountId=${encodeURIComponent(review.accountId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => ({}))) as ReceiptResponse;
        if (cancelled) return;
        if (res.ok && data.status === "confirmed") {
          setReceipt({ status: "confirmed", error: null });
          setPhase("done");
          return;
        }
        if (res.ok && data.status === "failed") {
          setReceipt({ status: "failed", error: data.error ?? "The transaction failed." });
          setPhase("done");
          return;
        }
        if (res.ok && data.status === "pending") {
          setReceipt({ status: "pending", error: null });
        }
      } catch {
        // Keep polling; a transient read failure is not a success or a failure.
      }
      if (cancelled) return;
      if (attempts < 30) {
        window.setTimeout(() => void tick(), 2_000);
      } else {
        setReceipt({ status: "pending", error: "Still pending after a minute — check the explorer before retrying." });
        setPhase("done");
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [phase, txHash, review]);

  async function prepare() {
    if (!accountId) {
      setError("Connect your NEAR wallet first.");
      return;
    }
    setError(null);
    setReceipt(null);
    setTxHash(null);
    setPhase("idle");
    try {
      const res = await fetch("/api/earn/rhea/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, accountId, amount: max ? undefined : amount, max }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as PreflightResponse;
      if (!res.ok || !data.ok || !data.review || !Array.isArray(data.transactions)) {
        setError(data.message ?? data.error ?? "The preflight didn't complete. Nothing was signed.");
        return;
      }
      setReview(data.review);
      setTransactions(data.transactions);
      setAcknowledged(false);
      setPhase("review");
    } catch {
      setError("The preflight request failed. Nothing was signed.");
    }
  }

  async function confirmSend() {
    if (!review) return;
    setError(null);
    const current = await getConnectedAccount().catch(() => null);
    const blocker = confirmBlocker({
      acknowledged,
      checkedAtMs: review.checkedAtMs,
      expectedAccountId: review.accountId,
      currentAccountId: current?.accountId ?? null,
    });
    if (blocker) {
      setError(confirmBlockerCopy(blocker));
      if (blocker === "stale_plan") setPhase("idle");
      return;
    }

    setPhase("sending");
    try {
      const outcomes = await sendTransactions(transactions, { expectedAccountId: review.accountId });
      const hash = firstTransactionHash(outcomes);
      if (!hash) {
        setError("The wallet returned no transaction hash, so success cannot be verified. Do not assume it went through.");
        setPhase("done");
        return;
      }
      setTxHash(hash);
      setReceipt({ status: "pending", error: null });
      setPhase("polling");
    } catch (sendError) {
      const raw = sendError instanceof Error ? sendError.message : String(sendError);
      if (/account changed|refus/i.test(raw)) {
        setError("The connected NEAR account changed. Refusing to send — nothing was signed. Review again with the intended wallet.");
        setPhase("review");
      } else if (/rejected|denied|cancel/i.test(raw)) {
        setError("You cancelled the wallet request. Nothing was sent.");
        setPhase("review");
      } else {
        setError(raw || "The wallet could not send that transaction.");
        setPhase("review");
      }
    }
  }

  return (
    <div className="page page-wide" data-testid="rhea-live-earn">
      <div className="pagehead">
        <div>
          <h1>Rhea live earn · NEAR</h1>
          <div className="sub">
            Same-chain USDC supply and withdraw through Burrow · signed by your own NEAR wallet
          </div>
        </div>
        <div className="actions">
          <Link className="btn btn-outline btn-md" href={toHref("vault")}>
            <Icon name="door" size={16} /> Back to vault
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Panel tone="caution">
          <b>Same-chain only.</b> This rail supplies/withdraws native USDC on NEAR directly with your
          NEAR account and the Burrow contract ({RHEA_LIVE_MARKET.contract}). It does <b>not</b> satisfy
          the original 071 cross-chain MCA/1Click Phase C requirement — that path remains deferred.
          Mainnet funds: review every step; SparkPoint never holds or moves your funds.
        </Panel>

        {!enabled && (
          <Panel tone="loss">
            Live Rhea is off in this build (<code>NEXT_PUBLIC_EARN_LIVE_RHEA</code> is not
            <code> true</code>). Nothing can be signed here.
          </Panel>
        )}

        <div className="card card-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Your NEAR wallet</div>
              <div style={{ fontSize: 12, color: MUTED }}>
                {accountId ? accountId : "No NEAR wallet connected. Meteor is tried first."}
              </div>
              {walletError && <div style={{ fontSize: 12, color: "var(--loss)" }}>{walletError}</div>}
            </div>
            {!accountId ? (
              <button className="btn btn-primary btn-sm" type="button" disabled={status === "connecting"} onClick={() => void connect()}>
                {status === "connecting" ? "Connecting…" : "Connect NEAR wallet"}
              </button>
            ) : (
              <span className="pill ghosty" style={{ cursor: "default" }}>
                <Icon name="shieldcheck" size={13} /> {status === "connected" ? "Connected" : status}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6 }} data-testid="rhea-live-action">
            {(["supply", "withdraw"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`pill${action === option ? "" : " ghosty"}`}
                aria-pressed={action === option}
                style={{ cursor: "pointer", textTransform: "capitalize" }}
                onClick={() => {
                  setAction(option);
                  setMax(false);
                  setReview(null);
                  setPhase("idle");
                  setError(null);
                }}
              >
                {option}
              </button>
            ))}
          </div>

          <label style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>Amount (USDC)</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={max ? "" : amount}
                disabled={max || busy}
                placeholder={action === "supply" ? "25" : "10"}
                onChange={(event) => setAmount(event.target.value)}
                style={{
                  width: 220,
                  fontSize: 14,
                  padding: "9px 11px",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 9,
                  color: "var(--foreground)",
                  outline: "none",
                }}
              />
              {action === "withdraw" && (
                <button
                  type="button"
                  className={`pill${max ? "" : " ghosty"}`}
                  aria-pressed={max}
                  onClick={() => {
                    setMax((value) => !value);
                    setReview(null);
                    setPhase("idle");
                  }}
                  style={{ cursor: "pointer" }}
                >
                  Max
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!enabled || !accountId || busy || (!max && !amount.trim())}
                onClick={() => void prepare()}
              >
                Review {action}
              </button>
            </div>
            <span style={{ fontSize: 11.5, color: MUTED }}>
              Native NEAR USDC ({RHEA_LIVE_MARKET.token.slice(0, 10)}…). USDC has 6 decimals; the
              preflight refuses unknown assets and out-of-bound amounts.
            </span>
          </label>

          {error && <Panel tone="loss" >{error}</Panel>}

          {review && (
            <div
              data-testid="rhea-live-review"
              style={{ border: "1px solid var(--border-soft)", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 8 }}
            >
              <div style={{ fontWeight: 600 }}>Review before signing</div>
              <div style={{ display: "grid", gap: 5, fontSize: 12.5 }}>
                {lines.map((line) => (
                  <div key={line.key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: MUTED }}>{line.label}</span>
                    <span
                      className="tnum"
                      style={{
                        textAlign: "right",
                        wordBreak: "break-all",
                        color: line.tone === "caution" ? "var(--caution)" : undefined,
                        fontWeight: 500,
                      }}
                    >
                      {line.value}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55 }}>
                {transactions.length} unsigned transaction{transactions.length === 1 ? "" : "s"} prepared.
                {action === "supply"
                  ? " Supply is a documented Burrow ft_transfer_call (1 yoctoNEAR attached; storage_deposit only when registration is missing)."
                  : " Withdraw is Burrow execute → Withdraw with the exact token_id and max_amount."}{" "}
                No slippage applies to exact supply/withdraw, but the amount and bounds are enforced.
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5 }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I reviewed the account, amount, contract, storage/gas reserve and block. I understand
                  this asks my NEAR wallet to sign and send a mainnet transaction.
                </span>
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="rhea-live-confirm"
                  disabled={!acknowledged || busy}
                  onClick={() => void confirmSend()}
                >
                  {phase === "sending" ? "Waiting for your wallet…" : "Confirm in NEAR wallet"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setPhase("idle");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {phase === "polling" && (
            <Panel>
              Sent. Waiting for finality{txHash ? `: ${txHash.slice(0, 12)}…` : ""}. Status is read from
              the chain; success is never assumed.
            </Panel>
          )}

          {phase === "done" && receipt && (
            <Panel tone={receipt.status === "confirmed" ? "gain" : receipt.status === "failed" ? "loss" : "caution"}>
              <b>
                {receipt.status === "confirmed"
                  ? "Confirmed on-chain."
                  : receipt.status === "failed"
                    ? "The transaction failed."
                    : "Still pending."}
              </b>{" "}
              {receipt.error ??
                (receipt.status === "confirmed"
                  ? "The wallet transaction finalized successfully."
                  : "The receipt is not final yet.")}
              {txHash && (
                <div style={{ marginTop: 6, wordBreak: "break-all", fontSize: 11.5 }}>
                  Transaction: {txHash}
                </div>
              )}
            </Panel>
          )}

          {receipt?.status === "confirmed" && review && (
            <div style={{ fontSize: 12, color: MUTED }}>
              Re-open the review or refresh the vault to read your updated Burrow position.{" "}
              <a href={RHEA_LIVE_MARKET.appUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>
                Rhea lending ↗
              </a>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
          What this is not: it is not the 071 cross-chain MCA/1Click deposit (which needs an EVM
          signature and a Rhea 1Click flow), it is not custody, and it never adds an access key. The
          login path remains transaction-free; only this reviewed confirm step can ask the wallet to
          send.
        </div>
      </div>
    </div>
  );
}
