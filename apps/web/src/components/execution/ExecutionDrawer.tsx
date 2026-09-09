"use client";

/**
 * ExecutionDrawer (feature 019 US2) — the single signing chokepoint for an AI-proposed vault move.
 *
 * Opened from an APPROVED recommendation/action chat block. It calls `/build-tx` to materialize a
 * server `IntentBundle` (recipient forced to you, signature always null), renders the guardrail
 * checklist + the simulated balance changes + the rationale, and lets you sign the SERVER calldata
 * VERBATIM (the byte-match, SC-005) from your own wallet — SparkPoint holds no key and signs nothing
 * (N1/N3). It never gates an exit (N2): the server only ships a bundle for approved actions, and a
 * withdraw/redeem bundle stays signable even when its advisory sim is unavailable. On any policy
 * failure it shows the reasons and NO sign button (fail-closed). The vault-screen manual flow and the
 * direct `/exit` hatch are untouched.
 */

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Hex } from "viem";
import type { GuardrailCheck, ProposedAction } from "@sparkpoint/shared/schemas";
import { explorerTxUrl } from "@/lib/chain/explorer";

import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { useBuildTx } from "@/lib/execution/useBuildTx";
import { useExecutionSign } from "@/lib/execution/useExecutionSign";
import { formatDelta, isExitKind, kindLabel, signGate } from "@/lib/execution/executionModel";
import type { AgentApiError } from "@/lib/agent/client";
import { useRouter } from "next/navigation";
import "@/components/screens/confirm.css";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <Icon name="shield" size={18} />
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
          You approve &amp; sign — <b>nothing moves until you sign</b>, and funds only ever go to your own wallet.
        </div>
      </div>
      {children}
    </div>
  );
}

// 024 — delegates to the one chain-metadata registry instead of re-listing roots. The previous
// inline version knew only 8453/84532, so Robinhood testnet rendered no link at all.
function explorerTx(chainId: number | undefined, hash: string): string | null {
  return explorerTxUrl(chainId, hash as Hex) ?? null;
}

function GuardRow({ g }: { g: GuardrailCheck }) {
  const color = g.status === "fail" ? "var(--loss)" : g.status === "warn" ? "var(--muted-foreground)" : "var(--gain)";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "4px 0", fontSize: 13 }}>
      <span style={{ color, display: "flex", marginTop: 1 }}>
        <Icon name={g.status === "fail" ? "alert" : "check"} size={14} />
      </span>
      <span style={{ flex: 1 }}>{g.label}</span>
    </div>
  );
}

export function ExecutionDrawer({ action }: { action: ProposedAction }) {
  const { chainId } = useAccount();
  const router = useRouter();
  const { bundle, error, loading, build } = useBuildTx();
  const sign = useExecutionSign(bundle);
  useHoldCriticalOp(sign.isBusy, "locked");
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    void build(action);
  }, [action, build]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <Shell title="Preparing your transaction…">
        <div className="cf-sec" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
          Building a safety-checked transaction from your own wallet…
        </div>
      </Shell>
    );
  }

  if (error) return <ErrorState action={action} error={error} onOpenVault={() => router.push(toHref("vault/deposit"))} />;
  if (!bundle) return <Shell title="Nothing to sign"><div className="cf-sec" style={{ fontSize: 13 }}>No transaction was produced.</div></Shell>;

  const gate = signGate(bundle, chainId, now);
  const deltas = bundle.simulation?.balanceDeltas ?? [];
  const exit = isExitKind(bundle.kind);
  const link = sign.txHash ? explorerTx(chainId, sign.txHash) : null;

  return (
    <Shell title={kindLabel(bundle.kind)}>
      {/* rationale */}
      <div className="cf-sec cf-reveal" style={{ animationDelay: "0ms", fontSize: 13, lineHeight: 1.55, color: "var(--muted-foreground)" }}>
        {bundle.rationale}
      </div>

      {/* guardrail checklist */}
      {bundle.guardrailChecklist.length > 0 && (
        <div className="cf-sec cf-reveal" style={{ animationDelay: "120ms" }}>
          <div className="cf-lbl">Guardrails</div>
          {bundle.guardrailChecklist.map((g, k) => (
            <GuardRow key={k} g={g} />
          ))}
        </div>
      )}

      {/* simulated balance changes */}
      <div className="cf-sec cf-reveal" style={{ animationDelay: "240ms" }}>
        <div className="cf-lbl">Preview</div>
        {bundle.simulation ? (
          deltas.length > 0 ? (
            deltas.map((d, k) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <span style={{ color: "var(--muted-foreground)" }}>Balance change</span>
                <span className="tnum">{formatDelta(d.delta, d.decimals)}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              Dry-run passed (no revert). Exact amounts are confirmed on-chain when you sign.
            </div>
          )
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            {exit
              ? "The preview is advisory here — your exit is never blocked by it (N2)."
              : "No live preview available right now."}
          </div>
        )}
      </div>

      {/* fee/custody disclosure */}
      <div className="cf-sec cf-reveal" style={{ animationDelay: "300ms", fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        The recipient is your own wallet. SparkPoint never holds your keys or signs for you.{" "}
        {exit ? "Withdrawals are never blocked by a check, a pause, or a fee." : "0% fee on your principal — profit-only performance fee."}
      </div>

      {/* sign / receipt */}
      <div className="cf-sec">
        {sign.isDone ? (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--gain)", fontWeight: 600 }}>
              <Icon name="check" size={16} /> Signed &amp; confirmed on-chain.
            </div>
            {sign.txHash && (
              <div style={{ marginTop: 6, color: "var(--muted-foreground)", wordBreak: "break-all" }}>
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>
                    View transaction ↗
                  </a>
                ) : (
                  <>Tx: {sign.txHash}</>
                )}
              </div>
            )}
          </div>
        ) : gate.canSign ? (
          <>
            <button className="btn btn-primary btn-md" disabled={sign.isBusy} onClick={sign.start}>
              {sign.stage === "signing"
                ? "Confirm in your wallet…"
                : sign.stage === "confirming"
                  ? "Confirming on-chain…"
                  : `Sign ${kindLabel(bundle.kind).toLowerCase()}`}
            </button>
            {sign.error && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--loss)" }}>{sign.error}</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{gate.reason}</div>
        )}
      </div>
    </Shell>
  );
}

/** Fail-closed error — special-cases APPROVAL_REQUIRED with an honest path to approve first. */
function ErrorState({
  action,
  error,
  onOpenVault,
}: {
  action: ProposedAction;
  error: AgentApiError;
  onOpenVault: () => void;
}) {
  const approvalNeeded = error.reasons.some((r) => r.code === "APPROVAL_REQUIRED");
  if (approvalNeeded) {
    return (
      <Shell title={kindLabel(action.type)}>
        <div className="cf-sec" style={{ fontSize: 13, lineHeight: 1.55 }}>
          You need to approve USDC to the vault once before your first deposit — then you can deposit from chat.{" "}
          <b>Nothing moves until you sign.</b>
        </div>
        <div className="cf-sec">
          <button className="btn btn-primary btn-md" onClick={onOpenVault}>
            Approve &amp; deposit in the Vault
          </button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell title={kindLabel(action.type)}>
      <div className="cf-sec" style={{ fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ color: "var(--loss)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="alert" size={16} /> This move can’t be signed.
        </div>
        <div style={{ marginTop: 6, color: "var(--muted-foreground)" }}>{error.message}</div>
        {error.reasons.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--muted-foreground)" }}>
            {error.reasons.map((r, k) => (
              <li key={k}>{r.message}</li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
