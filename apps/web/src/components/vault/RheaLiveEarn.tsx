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

import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import {
  AmountField,
  FlowCard,
  FlowDisclaimer,
  FlowModeToggle,
  FlowNextStep,
  FlowNotice,
  FlowPrimary,
  FlowSectionTitle,
  SummaryBox,
  VaultFlowPage,
} from "@/components/vault/VaultFlow";
import type { LiveEarnMode } from "@/lib/earn/liveFlags";
import type { NearTransaction } from "@/lib/near/burrow";
import { firstTransactionHash } from "@/lib/near/burrow";
import {
  amountAfterActionChange,
  confirmBlocker,
  confirmBlockerCopy,
  publicLiveRheaEnabled,
  reviewLines,
  type LiveEarnAction,
  type PreflightReview,
} from "@/lib/near/liveEarn";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { useRheaAccount } from "@/lib/vault/useVaultBalances";
import {
  rheaFlowRows,
  vaultFlowCopy,
  type VaultFlowMode,
  type VaultFlowSummaryRow,
} from "@/lib/vault/vaultFlow";

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

interface AvailableResponse {
  ok?: boolean;
  walletUsdc?: string | null;
  suppliedUsdc?: string | null;
}

export interface RheaLiveEarnProps {
  readonly initialMode?: LiveEarnMode;
  readonly initialAmount?: string | null;
}

export function RheaLiveEarn({ initialMode = "deposit", initialAmount }: RheaLiveEarnProps = {}) {
  const enabled = publicLiveRheaEnabled();
  const { accountId: nearAccountId, status, error: walletError, connect, getConnectedAccount, sendTransactions } = useNearWallet();
  // 1112 — an EVM-only session reads the SAME MCA the portfolio path reads. It can show the balance
  // and resolve Max, but it cannot sign a NEAR transaction (there is no NEAR wallet here).
  const rheaAccount = useRheaAccount(nearAccountId);
  const accountId = rheaAccount.account;
  const [action, setAction] = useState<LiveEarnAction>(initialMode === "withdraw" ? "withdraw" : "supply");
  const [amount, setAmount] = useState(initialAmount?.replace(/,/g, "") ?? "");
  const [max, setMax] = useState(false);
  const [available, setAvailable] = useState<{ walletUsdc: string | null; suppliedUsdc: string | null } | null>(null);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [review, setReview] = useState<PreflightReview | null>(null);
  const [transactions, setTransactions] = useState<readonly NearTransaction[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; error: string | null } | null>(null);

  const lines = useMemo(() => (review ? reviewLines(review) : []), [review]);
  const busy = phase === "sending" || phase === "polling";
  const availableAmount = accountId
    ? action === "withdraw"
      ? available?.suppliedUsdc
      : available?.walletUsdc
    : null;
  const flowMode: VaultFlowMode = action === "supply" ? "deposit" : "withdraw";
  const copy = vaultFlowCopy({
    mode: flowMode,
    assetSymbol: "USDC",
    vaultName: "Rhea Lending (NEAR)",
    primaryLabel:
      !accountId
        ? "Connect NEAR wallet"
        : !rheaAccount.canSign
          ? "Connect the NEAR wallet to sign"
          : undefined,
  });
  const summaryRows = rheaFlowRows({
    mode: flowMode,
    receive: amount.trim() ? `${amount.trim()} USDC${flowMode === "deposit" ? " supplied" : ""}` : "—",
    netApy: null,
    account: accountId,
    canSign: rheaAccount.canSign,
    accountSource: rheaAccount.source,
  });

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      setAvailableLoading(true);
      try {
        const res = await fetch(`/api/earn/rhea/live?accountId=${encodeURIComponent(accountId)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as AvailableResponse;
        if (cancelled) return;
        if (res.ok && data.ok) {
          setAvailable({ walletUsdc: data.walletUsdc ?? null, suppliedUsdc: data.suppliedUsdc ?? null });
        } else {
          setAvailable(null);
        }
      } catch {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setAvailableLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, receipt?.status]);

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
    if (!rheaAccount.canSign) {
      setError(
        "This Rhea account is linked to your signed-in EVM wallet, so its balance and Max are readable — but a NEAR supply/withdraw needs a NEAR wallet to sign. Connect the NEAR wallet that controls it, or withdraw on Rhea.",
      );
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
        body: JSON.stringify({ action, accountId, amount, max: action === "withdraw" && max }),
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

  function changeMode(next: "deposit" | "withdraw") {
    const nextAction: LiveEarnAction = next === "deposit" ? "supply" : "withdraw";
    if (nextAction === action) return;
    setAction(nextAction);
    setAmount(amountAfterActionChange(action, nextAction, amount));
    setMax(false);
    setReview(null);
    setPhase("idle");
    setError(null);
  }

  const primary =
    !enabled
      ? { label: "Rhea isn't available right now", onClick: undefined, disabled: true }
      : !accountId || !rheaAccount.canSign
        ? { label: copy.primaryLabel, onClick: () => void connect(), disabled: status === "connecting" }
        : {
            label: phase === "review" ? "Review again" : copy.primaryLabel,
            onClick: () => void prepare(),
            disabled: busy || !amount.trim(),
          };

  const reviewRows: VaultFlowSummaryRow[] = lines.map((line) => ({
    key: line.key,
    label: line.label,
    value: line.value,
    tone: line.tone,
  }));

  return (
    <VaultFlowPage
      backHref={toHref("vault")}
      title={copy.title}
      subtitle={copy.subtitle}
      riskTier={2}
      testId="rhea-live-earn"
      footer={
        <>
          {review && (
            <FlowCard testId="rhea-live-review">
              <FlowSectionTitle>Review before signing</FlowSectionTitle>
              <SummaryBox rows={reviewRows} testId="rhea-live-review-summary" />
              {error && <FlowNotice tone="caution">{error}</FlowNotice>}
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55 }}>
                {transactions.length} transaction{transactions.length === 1 ? "" : "s"} ready for your
                wallet to approve. The amount is exact; no price slippage applies.
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5, marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I reviewed the account, amount, network fee and current block. I understand this
                  asks my NEAR wallet to sign and send a mainnet transaction.
                </span>
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  data-testid="rhea-live-confirm"
                  disabled={!acknowledged || busy}
                  onClick={() => void confirmSend()}
                >
                  {phase === "sending" ? "Waiting for your wallet…" : "Confirm in NEAR wallet"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-md"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setPhase("idle");
                  }}
                >
                  Back
                </button>
              </div>
            </FlowCard>
          )}

          {phase === "polling" && (
            <FlowCard>
              <FlowNotice tone="info">
                Sent. Waiting for finality{txHash ? `: ${txHash.slice(0, 12)}…` : ""}. Status is read
                from the chain; success is never assumed.
              </FlowNotice>
            </FlowCard>
          )}

          {phase === "done" && receipt && (
            <FlowCard>
              <FlowNotice tone={receipt.status === "confirmed" ? "gain" : receipt.status === "failed" ? "caution" : "info"}>
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
              </FlowNotice>
            </FlowCard>
          )}
        </>
      }
    >
      {!review && (
        <>
      <FlowModeToggle mode={flowMode} onChange={changeMode} disabled={busy} testId="rhea-live-action" />

      {!enabled && <FlowNotice tone="caution">Rhea deposits and withdrawals aren&apos;t available right now.</FlowNotice>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Your Rhea account</div>
          <div style={{ fontSize: 12, color: MUTED }}>
            {accountId ? accountId : "No NEAR wallet connected. Meteor is tried first."}
          </div>
        </div>
        {!nearAccountId ? (
          <button className="btn btn-outline btn-sm" type="button" disabled={status === "connecting"} onClick={() => void connect()}>
            {status === "connecting" ? "Connecting…" : "Connect NEAR wallet"}
          </button>
        ) : (
          <span className="pill ghosty" style={{ cursor: "default" }}>
            <Icon name="shieldcheck" size={13} /> {status === "connected" ? "Connected" : status}
          </span>
        )}
      </div>

      {rheaAccount.source === "mca" && (
        <FlowNotice tone="caution">
          Reading the balance and Max from your linked Rhea MCA. Signing a NEAR transaction still
          needs a connected NEAR wallet — an EVM wallet cannot sign this Rhea deposit or withdraw.
        </FlowNotice>
      )}
      {walletError && <FlowNotice tone="caution">{walletError}</FlowNotice>}

      <AmountField
        id="rhea-amount"
        label={copy.amountLabel}
        assetSymbol="USDC"
        value={amount}
        onChange={(next) => {
          setAmount(next);
          setMax(false);
        }}
        onMax={() => {
          if (!availableAmount) return;
          setAmount(availableAmount);
          setMax(action === "withdraw");
          setReview(null);
          setPhase("idle");
          setError(null);
        }}
        maxDisabled={!availableAmount || busy}
        disabled={busy}
        helper={
          !accountId
            ? "Connect your NEAR wallet to see your balance"
            : availableLoading
              ? "Reading your balance…"
              : `${action === "withdraw" ? "Available to withdraw" : "Available to supply"}: ${availableAmount ?? "—"}${availableAmount ? " USDC" : ""}`
        }
        extra={
          rheaAccount.source === "mca" ? (
            <div className="hint" style={{ color: "var(--caution)" }}>
              Max uses the Rhea MCA balance. A NEAR wallet is still required to sign.
            </div>
          ) : undefined
        }
      />

      <SummaryBox rows={summaryRows} />
      {error && !review && <FlowNotice tone="caution">{error}</FlowNotice>}
      <FlowDisclaimer>{copy.disclaimer}</FlowDisclaimer>
      <FlowPrimary onClick={primary.onClick} disabled={primary.disabled}>
        {primary.label}
      </FlowPrimary>
      <FlowNextStep>{copy.nextStep}</FlowNextStep>
        </>
      )}
    </VaultFlowPage>
  );
}
