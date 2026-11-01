"use client";

/**
 * 072 — the Portfolio screen's "Across chains" panel.
 *
 * It reuses the chat card's body so the page and Sparky can never disagree about the same read.
 * The read is the session wallet only (the BFF derives the owner from SIWE); the existing
 * SparkPoint vault view above is untouched. Loading and error are honest: a failed read says so
 * and offers Retry rather than showing an invented zero.
 */

import { useMultichainPortfolio } from "@/lib/agent/useAgent";
import { PortfolioOverviewBody } from "@/components/screens/chat/portfolio-overview-card";
import "@/components/screens/confirm.css";

const MUTED = "var(--muted-foreground)";

export function MultichainPanel() {
  const { block, loading, error, online, refetch } = useMultichainPortfolio();

  return (
    <div
      className="card card-pad"
      data-testid="multichain-panel"
      style={{ marginTop: 18 }}
    >
      <div className="card-hd">
        <span className="t">Across chains</span>
        <span className="lbl">Read-only · not signable</span>
      </div>

      {!online ? (
        <div className="muted" style={{ padding: "18px 4px", fontSize: 13 }} data-testid="multichain-offline">
          Connect your wallet to read your multi-chain portfolio. Nothing here moves funds.
        </div>
      ) : loading ? (
        <div className="muted" style={{ padding: "18px 4px", fontSize: 13 }} data-testid="multichain-loading">
          Reading your balances, earn positions and swap history…
        </div>
      ) : error ? (
        <div data-testid="multichain-error" style={{ padding: "14px 4px", fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 600 }}>The multi-chain read didn&apos;t complete</div>
          <div style={{ color: MUTED, marginTop: 4 }}>{error}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={refetch} type="button">
            Retry
          </button>
        </div>
      ) : block ? (
        <div data-state={block.state} data-focus={block.focus}>
          <PortfolioOverviewBody block={block} />
        </div>
      ) : (
        <div className="muted" style={{ padding: "18px 4px", fontSize: 13 }} data-testid="multichain-empty">
          No multi-chain data yet. Nothing here moves funds.
        </div>
      )}
    </div>
  );
}
