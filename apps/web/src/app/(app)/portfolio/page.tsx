"use client";

/**
 * /portfolio — Portfolio Overview. The vault position, wallet USDC, and native ETH are LIVE
 * direct-RPC reads (`useVault` + wagmi `useBalance`) — no agent, no indexer, no custody (N1/N2).
 * Allocation + positions are fully live; the net-worth HISTORY sparkline, the PnL column, and risk
 * drift/score remain honestly labelled (they need an indexer we don't have yet). We never mix a real
 * and a fake number in one card.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useBalance } from "wagmi";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { useVault } from "@/lib/chain/useVault";
import { derivePortfolio } from "@/lib/portfolio/derive";
import "@/components/screens/portfolio.css";

/** Read the deployed vault on Base Sepolia even before a wallet connects (mirrors vault/page). */
const DISPLAY_CHAIN_ID = 84532;
const RANGES = ["1D", "1W", "1M", "1Y", "All"];

function areaPath(vals: number[], W: number, H: number, pad = 6) {
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i): [number, number] => [
    pad + (i / (vals.length - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / rng) * (H - pad * 2),
  ]);
  const d = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  return { line: d, area: d + ` L${(W - pad).toFixed(1)} ${H} L${pad} ${H} Z`, last: pts[pts.length - 1] };
}

/** A small honest label chip (caution-tinted). */
function Tag({ text, title }: { text: string; title: string }) {
  return (
    <span
      className="pill"
      title={title}
      style={{
        fontSize: 10, fontWeight: 600, color: "var(--caution)",
        borderColor: "color-mix(in srgb,var(--caution) 40%,transparent)", background: "var(--caution-subtle)",
      }}
    >
      {text}
    </span>
  );
}

export default function Page() {
  const router = useRouter();
  const [range, setRange] = useState("1M");

  const { isConnected } = useAccount();
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  // Native ETH on the connected chain (useBalance defaults to the wallet's chain; disabled off-wallet).
  const eth = useBalance({ address: v.account, query: { enabled: isConnected && !!v.account } });
  const d = derivePortfolio({
    underlying: v.underlying, usdcBalance: v.usdcBalance, shares: v.shares, ethWei: eth.data?.value,
  });

  // Mode: what the user's LIVE state actually is.
  const wrongNetwork = isConnected && v.unavailable?.kind === "vault_not_deployed";
  const loading = isConnected && !wrongNetwork && v.isLoading;
  const error = isConnected && !wrongNetwork && !loading && v.isError;
  const live = isConnected && v.isDeployed && !loading && !error;
  const preview = !isConnected; // disconnected → keep illustrative mock + "Preview data"

  const { line, area, last } = areaPath(data.series1M, 560, 150);

  // Allocation split — live when connected, mock otherwise.
  const vaultPct = live ? d.vaultPct : (data.allocation[0].v / data.allocation.reduce((s, x) => s + x.v, 0)) * 100;
  const idlePct = 100 - vaultPct;
  const donut = `conic-gradient(var(--risk-1) 0 ${vaultPct}%, var(--muted-foreground) ${vaultPct}% 100%)`;
  const largest = live ? (d.vaultValue >= d.idleUsdc ? "Aave Yield Vault" : "Idle USDC") : "Aave Yield Vault";

  const positions = live
    ? d.positions
    : [
        { key: "vault", label: "Aave Yield Vault", sub: "9,834.50 spvUSDC", valueUsd: data.allocation[0].v, shares: 9834.5 },
        { key: "idle", label: "Idle USDC", sub: "in your wallet", valueUsd: data.allocation[1].v },
      ];
  const emptyLive = live && !d.hasPositions;

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Portfolio</h1>
          <div className="sub">Your position, performance, and risk — net of everything.</div>
        </div>
        <div className="actions">
          <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("vault"))}>
            <Icon name="vault" size={16} /> Open vault
          </button>
          <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("chat"))}>
            <Icon name="chat" size={16} /> Ask AI
          </button>
        </div>
      </div>

      {wrongNetwork && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)", marginBottom: 14 }}>
          <Icon name="info" size={16} />
          <span>The SparkPoint vault isn’t deployed on your connected network. Switch to <b>Base Sepolia</b> to see your live position. Your funds are safe and withdrawable via <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>/exit</a>.</span>
        </div>
      )}
      {error && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)", marginBottom: 14 }}>
          <Icon name="info" size={16} />
          <span>Couldn’t read the chain just now — showing the last state.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => v.refetch()}>Retry</a></span>
        </div>
      )}

      <div className="pf-hero">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Net worth
              {preview && <Tag text="Preview data" title="Illustrative — connect your wallet for your real position (balances read on-chain)." />}
            </span>
            <div className="seg pf-range">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
          </div>
          <div className="pf-net tnum">{loading ? "…" : money(live ? d.totalUsd : data.netWorth)}</div>
          {live ? (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 12.5 }}>USDC across vault + wallet</span>
              {d.ethBalance > 0 && <span className="pill ghosty" style={{ fontSize: 11 }}>+ {d.ethBalance.toFixed(4)} ETH (not in USD)</span>}
              <Tag text="PnL pending" title="Profit/Loss over time needs a history indexer, which isn't wired yet." />
            </div>
          ) : (
            <div className="delta up" style={{ marginTop: 8 }}>
              <Icon name="up" size={15} />+{money(data.pnl.abs)} (+{data.pnl.pct}%, {data.pnl.window})
            </div>
          )}
          <div className="pf-spark-area" style={{ position: "relative" }}>
            <svg width="100%" height="150" viewBox="0 0 560 150" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--primary)" stopOpacity=".26" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#pfg)" />
              <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" />
              <circle cx={last[0]} cy={last[1]} r="4" fill="var(--primary)" />
              <circle cx={last[0]} cy={last[1]} r="8" fill="var(--primary)" opacity=".2" />
            </svg>
            {live && (
              <span style={{ position: "absolute", top: 6, right: 8 }}>
                <Tag text="Illustrative history" title="The shape is a placeholder — real net-worth history needs an indexer." />
              </span>
            )}
          </div>
        </div>

        <div className="card card-pad riskpanel">
          <div className="card-hd">
            <span className="lbl">Risk panel</span>
            <RiskChip tier={1} />
          </div>
          <div className="rp-row">
            <span className="muted">Portfolio risk</span>
            <span style={{ fontWeight: 600 }}>Lower · 1/5 <Tag text="from vault tier" title="The Aave vault is tier 1; a per-portfolio score needs your mandate + history." /></span>
          </div>
          <div className="rp-row">
            <span className="muted">Drift vs your plan</span>
            <span className="muted" style={{ fontWeight: 600 }}>— <Tag text="needs your plan" title="Drift compares your live mix to your mandate; the mandate link isn't wired here yet." /></span>
          </div>
          <div className="rp-row">
            <span className="muted">Concentration</span>
            <span style={{ fontWeight: 600 }}>{loading ? "…" : `${vaultPct.toFixed(0)}% single vault`}</span>
          </div>
          <div className="rp-row">
            <span className="muted">Largest position</span>
            <span style={{ fontWeight: 600 }}>{largest}</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Capital-preservation-first. The audited Aave vault is the lowest tier on our scale.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("strategies"))}>Improve this</a>
          </div>
        </div>
      </div>

      <div className="pf-grid">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Allocation by risk tier</span>
            {preview && <Tag text="Preview data" title="Connect your wallet to see your real allocation." />}
          </div>
          {emptyLive ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              No positions yet.{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault/deposit"))}>Deposit USDC</a> to get started.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div className="donut" style={{ background: donut, position: "relative" }}>
                <div style={{ position: "absolute", inset: 18, borderRadius: "50%", background: "var(--card)", display: "grid", placeItems: "center", textAlign: "center" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }} className="tnum">{money(live ? d.totalUsd : data.allocation.reduce((s, x) => s + x.v, 0), 0)}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>2 positions</div>
                  </div>
                </div>
              </div>
              <div className="legend" style={{ flex: 1 }}>
                <div className="legrow">
                  <span className="sw" style={{ background: "var(--risk-1)" }} />
                  <span className="lg">Aave Yield Vault · Risk 1</span>
                  <span className="lv tnum">{vaultPct.toFixed(0)}%</span>
                </div>
                <div className="legrow">
                  <span className="sw" style={{ background: "var(--muted-foreground)" }} />
                  <span className="lg">Idle USDC · uninvested</span>
                  <span className="lv tnum">{idlePct.toFixed(0)}%</span>
                </div>
                <div className="divider" />
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Idle USDC earns nothing.{" "}
                  <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault/deposit"))}>Put it to work</a>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Positions</span>
            <span className="lbl">net of fees</span>
          </div>
          {emptyLive ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>No open positions.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="num">Value</th>
                  <th className="num">PnL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.key} style={p.key === "vault" ? { cursor: "pointer" } : undefined}
                      onClick={p.key === "vault" ? () => router.push(toHref("portfolio/vault")) : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{p.sub}</div>
                    </td>
                    <td className="num tnum">{loading ? "…" : money(p.valueUsd)}</td>
                    <td className="num muted" title="PnL needs a history indexer, not wired yet">
                      — <span style={{ fontSize: 10 }}>pending</span>
                    </td>
                    <td>{p.key === "vault" ? <Icon name="chevr" size={15} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
