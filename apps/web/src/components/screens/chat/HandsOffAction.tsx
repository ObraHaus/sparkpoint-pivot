"use client";

/**
 * HandsOffAction (US6, feature 022) — the optional "Let Sparky do it" CTA on an approved vault action.
 *
 * Renders ONLY when the user has a live, in-scope grant AND the session key is stored on THIS device —
 * otherwise it renders nothing and the card's existing "Review this move" (per-action, user-signed) path
 * stands alone. On click it runs the whole hands-off flow (unlock once → build → session-sign → relay →
 * status) with no per-move wallet signature. Every move is still an explicit human click (Gate C: no
 * autonomy); "hands-off" means no signature, not no human. The on-chain PolicyModule re-enforces scope.
 */

import { useEffect, useState } from "react";

import type { Hex } from "viem";
import type { ProposedAction } from "@sparkpoint/shared/schemas";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";

import { isEligibleForAutoExec } from "@/lib/automation/coverage";
import { hasSessionKey, type KeyScope } from "@/lib/automation/sessionKeyStore";
import { useSessionExecute } from "@/lib/automation/useSessionExecute";
import { useSessionKeys } from "@/lib/automation/useSessionKey";

const VAULT_CHAIN = VAULT_CHAIN_ID;

const BUSY_LABEL: Record<string, string> = {
  unlocking: "Unlock in your wallet…",
  building: "Preparing…",
  signing: "Signing automatically…",
  submitting: "Sending…",
  pending: "Confirming on-chain…",
};

export function HandsOffAction({ action }: { action: ProposedAction }) {
  const { active, account } = useSessionKeys();
  const exec = useSessionExecute();
  // A fixed mount-time clock for the eligibility check (lint: no Date.now() in render body).
  const [now] = useState(() => Date.now());
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);

  const sessionAddress = active?.sessionKey;
  useEffect(() => {
    let alive = true;
    const check = async (): Promise<boolean> => {
      if (!account || !sessionAddress) return false;
      const scope: KeyScope = { chainId: VAULT_CHAIN, account, sessionAddress };
      return hasSessionKey(scope);
    };
    void check().then((p) => {
      if (alive) setKeyPresent(p);
    });
    return () => {
      alive = false;
    };
  }, [account, sessionAddress]);

  const eligible = isEligibleForAutoExec(action, active, now);
  // Offer hands-off ONLY when a live grant covers this move AND the key is on THIS device.
  if (!eligible.ok || keyPresent !== true) return null;

  if (exec.stage === "confirmed") {
    return (
      <div style={{ fontSize: 12.5, color: "var(--gain)", display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <Icon name="check" size={14} /> Executed automatically under your automation.
        {exec.txHash && (
          <a href={explorerTxUrl(VAULT_CHAIN, exec.txHash as Hex)} target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>
            View ↗
          </a>
        )}
      </div>
    );
  }
  if (exec.stage === "failed") {
    return (
      <div style={{ fontSize: 12.5, color: "var(--loss)", marginTop: 8 }}>
        The automated move reverted on-chain — nothing moved. Try “Review this move”.
      </div>
    );
  }
  if (exec.stage === "pending") {
    return (
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>
        Submitted — confirming on-chain. It’ll appear in your outcomes shortly.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-outline btn-md" disabled={exec.isBusy} onClick={() => exec.start(action)}>
        {exec.isBusy ? (BUSY_LABEL[exec.stage] ?? "Working…") : "Let Sparky do it (no signature)"}
      </button>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
        Runs under your on-chain automation limits — no wallet prompt. You can revoke instantly anytime.
      </div>
      {exec.stage === "error" && exec.error && (
        <div style={{ fontSize: 12, color: "var(--loss)", marginTop: 6 }}>{exec.error}</div>
      )}
    </div>
  );
}
