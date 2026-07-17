"use client";

/**
 * /portfolio/[positionId] — position detail. LIVE for the only real position today (`vault`):
 * shares + value (convertToAssets) + realizable-now (previewRedeem — the truthful, fee/liquidity-
 * aware amount) are direct-RPC reads via `useVault`. Accrued PnL + the transaction list need an
 * indexer we don't have, so they're honestly labelled, never faked. Non-`vault` ids → not found.
 */

import { use } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { Icon } from "@/lib/icons";
import { money } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { useVault } from "@/lib/chain/useVault";
import { usePortfolioView, usePositionTransactions, type PositionTx } from "@/lib/agent/useAgent";
import { explorerTxUrl } from "@/lib/chain/explorer";
import "@/components/screens/portfolio.css";

const DISPLAY_CHAIN_ID = 84532;
const num = (x: bigint | undefined, d: number) => (x === undefined ? undefined : Number(formatUnits(x, d)));

/** A short "~2d ago" style relative age from an ISO string (the tx timestamp is APPROXIMATE). */
function agoApprox(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `~${Math.round(s / 60)}m ago`;
  if (s < 86400) return `~${Math.round(s / 3600)}h ago`;
  return `~${Math.round(s / 86400)}d ago`;
}

function Tag({ text, title }: { text: string; title: string }) {
  return (
    <span className="pill" title={title} style={{ fontSize: 10, fontWeight: 600, color: "var(--caution)", borderColor: "color-mix(in srgb,var(--caution) 40%,transparent)", background: "var(--caution-subtle)" }}>
      {text}
    </span>
  );
}

export default function Page({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = use(params);
  const { isConnected, chainId } = useAccount();
  const base = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  // Second instance parameterized on the loaded shares → previewRedeem(all shares) = realizable now.
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID, previewRedeemShares: base.shares });
  // §B2/§tx agent-derived PnL + transaction history (called unconditionally — Rules of Hooks).
  const agent = usePortfolioView();
  const txView = usePositionTransactions();

  if (positionId !== "vault") {
    return (
      <div className="page page-narrow">
        <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={toHref("portfolio")}>
          <Icon name="chevr" size={15} /> Back to portfolio
        </Link>
        <div className="card card-pad muted">Position not found. The only live position today is the Aave Yield Vault.</div>
      </div>
    );
  }

  // Modes — a CONNECTED error/loading/wrong-network must NEVER read as "connect your wallet".
  const wrongNetwork = isConnected && base.unavailable?.kind === "vault_not_deployed";
  const loading = isConnected && !wrongNetwork && base.isLoading;
  const error = isConnected && !wrongNetwork && !loading && base.isError;
  const live = isConnected && base.isDeployed && !loading && !error && !wrongNetwork;
  const sharesNum = num(base.shares, 6); // vault share token is 6-dp (== USDC asset)
  const valueUsd = num(base.underlying, 6);
  const realizable = num(v.previewRedeemAssets, 6);

  // §B2 DERIVED (non-custody): real cost basis + unrealized PnL from the on-chain flow index.
  // Trusted only when LIVE and not stale — else the honest "pending" label holds.
  const agentLive = live && !!agent && !agent.stale;
  const costBasisUsd = agentLive ? agent.positionPnl["vault"]?.costBasisUsd : undefined;
  const unrealizedPnlUsd = agentLive ? agent.positionPnl["vault"]?.unrealizedPnlUsd : undefined;
  const hasIndexedPnl = costBasisUsd !== undefined || unrealizedPnlUsd !== undefined;
  // §tx: the indexed Deposit/Withdraw history — trusted only when LIVE + not stale. Distinguish a
  // still-loading / failed fetch from a CONFIRMED-empty history (don't mislabel the former).
  const txLive = live && !!txView && !txView.stale;
  const txs: PositionTx[] = txLive ? txView.txs : [];
  const txLoading = txLive && txView.isLoading;
  const txError = txLive && txView.isError;
  const txEmpty = txLive && txView.loaded && !txView.isError && txs.length === 0;
  const dash = (n: number | undefined, f: (x: number) => string) => (n === undefined ? "…" : f(n));
  // A connected value cell: skeleton while loading, real when live, dash otherwise.
  const cell = (n: number | undefined, f: (x: number) => string) =>
    loading ? "…" : live ? dash(n, f) : "—";

  return (
    <div className="page page-narrow">
      <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={toHref("portfolio")}>
        <Icon name="chevr" size={15} /> Back to portfolio
      </Link>
      <div className="pagehead">
        <div>
          <h1>Aave Yield Vault</h1>
          <div className="sub">
            Position detail ·{" "}
            {live ? <Tag text="Live" title="Read directly on-chain (no agent, no indexer)." />
                  : wrongNetwork ? <Tag text="Vault not on this network" title="Switch to Base Sepolia to see your live position." />
                  : loading ? <Tag text="Reading…" title="Reading your position on-chain." />
                  : error ? <Tag text="Couldn’t read the chain" title="A fresh read failed — retry below." />
                  : <Tag text="Preview" title="Connect your wallet on Base Sepolia to see your live position." />}
          </div>
        </div>
        <RiskChip tier={1} />
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="posstats">
          <div className="stat">
            <span className="k">Shares</span>
            <span className="v tnum">{cell(sharesNum, (x) => x.toLocaleString(undefined, { maximumFractionDigits: 4 }))}</span>
            <span className="muted" style={{ fontSize: 11 }}>spvUSDC</span>
          </div>
          <div className="stat">
            <span className="k">Value</span>
            <span className="v tnum">{cell(valueUsd, (x) => money(x))}</span>
            <span className="muted" style={{ fontSize: 11 }}>convertToAssets</span>
          </div>
          <div className="stat">
            <span className="k">Realizable now</span>
            <span className="v tnum" style={{ color: "var(--gain)" }}>{cell(realizable, (x) => money(x))}</span>
            <span className="muted" style={{ fontSize: 11 }}>previewRedeem (net of fee)</span>
          </div>
        </div>
        {error && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--caution)" }}>
            Couldn’t read the chain just now.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => base.refetch()}>Retry</a>. Your
            funds are safe and withdrawable via{" "}
            <Link style={{ color: "var(--primary)" }} href={toHref("exit")}>/exit</Link>.
          </div>
        )}
        {hasIndexedPnl ? (
          <div style={{ marginTop: 12, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
            <div className="stat">
              <span className="k">Cost basis</span>
              <span className="v tnum">{costBasisUsd !== undefined ? money(costBasisUsd) : "—"}</span>
              <span className="muted" style={{ fontSize: 11 }}>net deposited (indexed on-chain)</span>
            </div>
            <div className="stat">
              <span className="k">Unrealized PnL</span>
              <span
                className={`v tnum ${unrealizedPnlUsd !== undefined ? (unrealizedPnlUsd > 0 ? "delta up" : unrealizedPnlUsd < 0 ? "delta down" : "delta flat") : ""}`}
              >
                {unrealizedPnlUsd !== undefined ? `${unrealizedPnlUsd >= 0 ? "+" : "−"}${money(Math.abs(unrealizedPnlUsd))}` : "—"}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>value − cost basis</span>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", display: "inline-flex", gap: 8, alignItems: "center" }}>
            Accrued yield / PnL <Tag text="pending" title="PnL over time needs a history indexer, not wired yet." />
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Transactions</span>
          {txs.length > 0 && <span className="lbl" title="Times are approximate (from block height)">indexed on-chain</span>}
        </div>
        {txs.length > 0 ? (
          <table className="tbl">
            <tbody>
              {txs.map((t) => {
                const url = explorerTxUrl(chainId, t.txHash);
                const isDep = t.kind === "deposit";
                return (
                  <tr key={t.txHash}>
                    <td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                        <Icon name={isDep ? "down" : "up"} size={14} />
                        {isDep ? "Deposit" : "Withdraw"}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {agoApprox(t.tsApprox)} · block {t.blockNumber.toLocaleString()}
                      </div>
                    </td>
                    <td className="num tnum">{isDep ? "+" : "−"}{money(Number(t.amountUsd))}</td>
                    <td className="num">
                      {url ? (
                        <a className="cite" href={url} target="_blank" rel="noreferrer" title="View on explorer">
                          <Icon name="ext" size={12} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : txLoading ? (
          <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>Loading your transactions…</div>
        ) : txError ? (
          <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>
            Couldn&apos;t load your transactions just now.{" "}
            <a className="cite" style={{ cursor: "pointer" }} onClick={() => txView?.refetch()}>Retry</a>, or verify on{" "}
            <a className="cite" style={{ cursor: "pointer" }} href="https://sepolia.basescan.org" target="_blank" rel="noreferrer">
              BaseScan <Icon name="ext" size={10} />
            </a>.
          </div>
        ) : txEmpty ? (
          <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>
            No deposits or withdrawals recorded for this position yet.
          </div>
        ) : !isConnected ? (
          <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>
            Connect on Base Sepolia to see your indexed transaction history. It&apos;s also verifiable on{" "}
            <a className="cite" style={{ cursor: "pointer" }} href="https://sepolia.basescan.org" target="_blank" rel="noreferrer">
              BaseScan <Icon name="ext" size={10} />
            </a>.
          </div>
        ) : (
          <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>
            {wrongNetwork ? "Switch to Base Sepolia to see your transaction history."
              : loading ? "Reading your position…"
              : "Transaction history is unavailable right now — verifiable on BaseScan."}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Link className="btn btn-primary btn-md" href={toHref("vault/deposit")}>Add to position</Link>
        <Link className="btn btn-outline btn-md" href={toHref("vault/withdraw")}>Withdraw</Link>
      </div>
    </div>
  );
}
