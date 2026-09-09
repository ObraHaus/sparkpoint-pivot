"use client";

/**
 * /portfolio — Portfolio Overview. The vault position, wallet USDC, and native ETH are LIVE
 * direct-RPC reads (`useVault` + wagmi `useBalance`) — no agent, no indexer, no custody (N1/N2).
 *
 * HONEST DEGRADED STATES (R5 A7): only the DISCONNECTED preview shows illustrative mock figures, and
 * every mock-fed card carries a "Preview data" tag. Every CONNECTED-but-not-live state — loading,
 * wrong-network, chain-read error — shows DASHES / skeletons and a truthful banner, NEVER the mock
 * numbers. The net-worth HISTORY sparkline, the PnL column, and risk drift/score stay labelled
 * (they need an indexer we don't have yet). We never mix a real and a fake number in one card.
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
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { derivePortfolio } from "@/lib/portfolio/derive";
import { toWrapperPositionInput } from "@/lib/chain/vaultOptions";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { usePortfolioView, useMandate, mandateDrift, driftLabel } from "@/lib/agent/useAgent";
import { goalProgress } from "@/lib/goal/progress";
import { formatUsdc } from "@/lib/strategy/projection";
import { StatusTag } from "@/components/ui/status-tag";
import { WalletTokensCard } from "@/components/portfolio/WalletTokensCard";
import "@/components/screens/portfolio.css";

/** Read the deployed vault on Base Sepolia even before a wallet connects (mirrors vault/page). */
const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;

/** Address book for a chain, or `undefined` on an unsupported chain (getAddresses throws) — fail-closed. */
function safeAddresses(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}
const RANGES = ["1D", "1W", "1M", "1Y", "All"];
const DASH = "—";

function areaPath(vals: number[], W: number, H: number, pad = 6) {
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i): [number, number] => [
    pad + (i / (vals.length - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / rng) * (H - pad * 2),
  ]);
  const d = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  return { line: d, area: d + ` L${(W - pad).toFixed(1)} ${H} L${pad} ${H} Z`, last: pts[pts.length - 1] };
}

/** A small honest FIELD-LEVEL note chip (caution-tinted) — for "PnL pending" / "illustrative" etc. */
function Note({ text, title }: { text: string; title: string }) {
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

  const { isConnected, chainId } = useAccount();
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  // Single curated wrapper (011): ONE fixed top-level read (hooks-safe — a growing list would need a
  // child-component-per-wrapper). A held wrapper renders as an `ext:<addr>` portfolio row; launch-only
  // users (no wrapper shares) yield `wrappers: []` → derivePortfolio is byte-identical to before.
  const wrapper0 = safeAddresses(isConnected ? chainId : DISPLAY_CHAIN_ID)?.sparkPointWrappers?.[0];
  const w0 = useVault({
    chainId: isConnected ? undefined : DISPLAY_CHAIN_ID,
    vaultAddress: wrapper0?.address,
    kind: wrapper0 ? "morpho_wrapper" : "aave_launch",
  });
  // Native ETH on the connected chain (useBalance defaults to the wallet's chain; disabled off-wallet).
  const eth = useBalance({ address: v.account, query: { enabled: isConnected && !!v.account } });
  const wrapperRow = wrapper0
    ? toWrapperPositionInput(wrapper0, {
        underlying: w0.underlying,
        shares: w0.shares,
        decimals: w0.assetDecimals,
        assetIsUsdc:
          w0.asset !== undefined &&
          w0.usdcAddress !== undefined &&
          w0.asset.toLowerCase() === w0.usdcAddress.toLowerCase(),
      })
    : null;
  const d = derivePortfolio({
    underlying: v.underlying, usdcBalance: v.usdcBalance, shares: v.shares, ethWei: eth.data?.value,
    wrappers: wrapperRow ? [wrapperRow] : [],
  });

  // Mode — what the user's LIVE state actually is. A CONNECTED-but-not-live state (loading /
  // wrong-network / error) is DEGRADED → dashes + skeletons, never the mock figures. Only the
  // disconnected PREVIEW shows illustrative mock (labelled on every card).
  const wrongNetwork = isConnected && v.unavailable?.kind === "vault_not_deployed";
  // §B3: Robinhood testnet (46630) is a SUPPORTED chain with no vault (vault is Base-only). It's a
  // "wrong network" for the VAULT, but we acknowledge it honestly and still show the wallet's ETH.
  const robinhood = wrongNetwork && chainId === 46630;
  const loading = isConnected && !wrongNetwork && (v.isLoading || (eth.isLoading && !!v.account));
  const error = isConnected && !wrongNetwork && !loading && v.isError;
  const live = isConnected && v.isDeployed && !loading && !error && !wrongNetwork;
  const preview = !isConnected;
  const degraded = isConnected && !live; // dashes/skeletons — never mock

  // §B2 DERIVED (non-custody) figures — real cost basis + unrealized PnL from the agent's on-chain
  // flow index. Custody balances above stay on direct RPC; this only fills the PnL slots. Trusted
  // ONLY when we're LIVE and the agent's read isn't stale — else the honest "pending" fallback holds.
  const agent = usePortfolioView();
  const agentLive = live && !!agent && !agent.stale;
  const netUnrealizedUsd = agentLive ? agent.unrealizedUsd : undefined;
  const netRealizedUsd = agentLive ? agent.realizedUsd : undefined;
  const vaultPnlUsd = agentLive ? agent.positionPnl["vault"]?.unrealizedPnlUsd : undefined;
  const vaultCostBasisUsd = agentLive ? agent.positionPnl["vault"]?.costBasisUsd : undefined;

  // Drift vs the user's real mandate (GET /agent/mandate). The only live strategy is the tier-1
  // Aave vault, so the realized tier is 1 when invested, else cash (0). A mandate only NARROWS
  // allowed risk, so realized ≤ mandate tier is on-plan; only exceeding it drifts.
  const mandate = useMandate();
  const targetTier = mandate.status === "ready" ? mandate.mandate.tier : undefined;
  const realizedTier = live ? (d.vaultValue > 0 ? 1 : 0) : undefined;
  const drift = mandateDrift(targetTier, realizedTier);

  // 030/US4 — derived from real balances and the plan's stated target. `null` when no target is
  // set, which the row renders as an invitation rather than a fabricated 0%.
  const goalTargetUsdc =
    mandate.status === "ready" ? mandate.mandate.goalTargetUsdc : undefined;
  const goal = goalProgress({
    targetBaseUnits: goalTargetUsdc ? Number(goalTargetUsdc) : null,
    targetDate: mandate.status === "ready" ? mandate.mandate.goalTargetDate : null,
    balanceBaseUnits: live ? Math.round(d.totalUsd * 1_000_000) : null,
    // Kept pure: the render never calls Date.now(). This is the only clock read on the page.
    today: new Date().toISOString().slice(0, 10),
    contribution:
      mandate.status === "ready" && mandate.mandate.contribution
        ? {
            amountBaseUnits: Number(mandate.mandate.contribution.amountUsdc),
            cadence: mandate.mandate.contribution.cadence,
          }
        : null,
  });
  const goalTitle = !goal
    ? ""
    : goal.met
      ? "You have reached the target you set."
      : goal.pace === "short"
        ? `At your stated contribution you would still be $${formatUsdc(goal.paceShortfallBaseUnits)} short by the target date. A projection at today's rate, not a promise.`
        : goal.pace === "on_track"
          ? "Your stated contribution reaches the target by the date, at today's rate. A projection, not a promise."
          : `$${formatUsdc(goal.shortfallBaseUnits)} to go, ${goal.monthsRemaining} month(s) left. Add a contribution plan in Settings to see whether you're on pace.`;

  // §history — REAL position-value series from the agent's on-chain flow index. The range selector
  // filters the time window; if the window has <2 points (sparse testnet data) we fall back to the
  // full real series so the chart isn't empty. Only when there's no real history do we draw the mock
  // shape (labelled "Illustrative"). `realChart` gates that label so a real curve is never mislabeled.
  const RANGE_DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365, All: Infinity };
  const fullHistory = agentLive ? agent.history : [];
  // Window the series relative to its LATEST point (≈ now) — keeps the render pure (no Date.now()).
  const lastT = fullHistory.length ? fullHistory[fullHistory.length - 1].t : 0;
  const cutoff = lastT - (RANGE_DAYS[range] ?? 30) * 86_400_000;
  const windowed = fullHistory.filter((p) => p.t >= cutoff);
  const realPoints = windowed.length >= 2 ? windowed : fullHistory;
  const realChart = realPoints.length >= 2;
  // Draw the REAL series when indexed; the mock shape ONLY in the disconnected preview. In a
  // connected-degraded state (loading / wrong-network / error) draw NOTHING — never a faded,
  // unlabeled mock uptrend that could read as the user's real history.
  const chartVals = realChart ? realPoints.map((p) => p.v) : preview ? data.series1M : null;
  const chart = chartVals && chartVals.length >= 2 ? areaPath(chartVals, 560, 150) : null;

  // Allocation split — live real, preview mock, degraded 0 (rendered as dashes).
  const mockTotal = data.allocation.reduce((s, x) => s + x.v, 0);
  const mockVaultPct = (data.allocation[0].v / mockTotal) * 100;
  const vaultPct = live ? d.vaultPct : preview ? mockVaultPct : 0;
  const idlePct = live ? d.idlePct : preview ? 100 - mockVaultPct : 0;
  const donut = degraded
    ? "conic-gradient(var(--border-soft) 0 100%)"
    : `conic-gradient(var(--risk-1) 0 ${vaultPct}%, var(--muted-foreground) ${vaultPct}% 100%)`;
  const pctText = (p: number) => (live || preview ? `${p.toFixed(0)}%` : DASH);
  const largest = live ? (d.vaultValue >= d.idleUsdc ? "Aave Yield Vault" : "Idle USDC") : preview ? "Aave Yield Vault" : DASH;

  const netWorthText = loading ? "…" : live ? money(d.totalUsd) : preview ? money(data.netWorth) : DASH;
  const donutTotalText = loading ? "…" : live ? money(d.totalUsd, 0) : preview ? money(mockTotal, 0) : DASH;

  const mockPositions = [
    { key: "vault", label: "Aave Yield Vault", sub: "9,834.50 spvUSDC", valueUsd: data.allocation[0].v },
    { key: "idle", label: "Idle USDC", sub: "in your wallet", valueUsd: data.allocation[1].v },
  ];
  const positions = live ? d.positions : preview ? mockPositions : [];
  const emptyLive = live && !d.hasPositions;
  const previewTag = <StatusTag variant="mock" title="Illustrative — connect your wallet for your real position (balances read on-chain)." />;

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
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14, padding: "11px 14px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted-foreground)", background: "var(--caution-subtle)", border: "1px solid color-mix(in srgb,var(--caution) 26%,transparent)" }}>
          <span style={{ color: "var(--caution)", flex: "none", marginTop: 1 }}>
            <Icon name="info" size={16} />
          </span>
          {robinhood ? (
            <span>You’re on <b>Robinhood Testnet</b>. The SparkPoint vault is <b>Base-only</b> — switch to <b>Base Sepolia</b> for your vault position.{eth.data?.value !== undefined && ` Your Robinhood ETH balance: ${d.ethBalance.toFixed(4)} ETH.`} Your vault funds on Base are always withdrawable via <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>/exit</a>.</span>
          ) : (
            <span>The SparkPoint vault isn’t deployed on your connected network. Switch to <b>Base Sepolia</b> to see your live position. Your funds are safe and withdrawable via <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>/exit</a>.</span>
          )}
        </div>
      )}
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14, padding: "11px 14px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted-foreground)", background: "var(--caution-subtle)", border: "1px solid color-mix(in srgb,var(--caution) 26%,transparent)" }}>
          <span style={{ color: "var(--caution)", flex: "none", marginTop: 1 }}>
            <Icon name="info" size={16} />
          </span>
          <span>Couldn’t read the chain just now — figures below are hidden rather than guessed.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => v.refetch()}>Retry</a>. Your funds are safe and withdrawable via <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("exit"))}>/exit</a>.</span>
        </div>
      )}

      <div className="pf-hero">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Net worth
              {preview && previewTag}
            </span>
            <div className="seg pf-range">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
          </div>
          <div className="pf-net tnum">{netWorthText}</div>
          {live ? (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 12.5 }}>USDC across vault + wallet</span>
              {d.ethBalance > 0 && <span className="pill ghosty" style={{ fontSize: 11 }}>+ {d.ethBalance.toFixed(4)} ETH (not in USD)</span>}
              {netUnrealizedUsd !== undefined ? (
                <span
                  className={`delta ${netUnrealizedUsd > 0 ? "up" : netUnrealizedUsd < 0 ? "down" : "flat"}`}
                  style={{ fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
                  title={vaultCostBasisUsd !== undefined
                    ? `Unrealized PnL = current value − the ${money(vaultCostBasisUsd)} avg cost of your held shares (indexed on-chain).`
                    : "Unrealized PnL = current value − the avg cost of your held shares (indexed on-chain)."}
                >
                  {netUnrealizedUsd >= 0 ? "+" : "−"}{money(Math.abs(netUnrealizedUsd))} unrealized
                  <span className="pill" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--muted-foreground)" }}>indexed</span>
                </span>
              ) : (
                <Note text="PnL pending" title="Profit/Loss over time needs a history indexer, which isn't wired yet." />
              )}
              {netRealizedUsd !== undefined && netRealizedUsd !== 0 && (
                <span
                  className={`delta ${netRealizedUsd > 0 ? "up" : "down"}`}
                  style={{ fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
                  title="Realized PnL = gains booked on your past withdrawals (indexed on-chain)."
                >
                  {netRealizedUsd >= 0 ? "+" : "−"}{money(Math.abs(netRealizedUsd))} realized
                </span>
              )}
            </div>
          ) : preview ? (
            <div className="delta up" style={{ marginTop: 8 }}>
              <Icon name="up" size={15} />+{money(data.pnl.abs)} (+{data.pnl.pct}%, {data.pnl.window})
            </div>
          ) : robinhood ? (
            // §B3: no USD oracle on Robinhood testnet, so keep USD net worth honest (dashed) but
            // surface the wallet's native ETH as a REAL figure rather than only a banner sentence.
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="pill ghosty" style={{ fontSize: 11 }}>
                {eth.data?.value !== undefined ? `${d.ethBalance.toFixed(4)} ETH` : "… ETH"} in your wallet
              </span>
              <span>No USD price on Robinhood testnet — read-only here.</span>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              {loading ? "Reading your balances…" : wrongNetwork ? "Switch to Base Sepolia to see your position." : "Live figures hidden — tap Retry above."}
            </div>
          )}
          <div className="pf-spark-area" style={{ position: "relative", minHeight: 150 }}>
            {chart ? (
              <svg width="100%" height="150" viewBox="0 0 560 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--primary)" stopOpacity=".26" />
                    <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={chart.area} fill="url(#pfg)" />
                <path d={chart.line} fill="none" stroke="var(--primary)" strokeWidth="2" />
                <circle cx={chart.last[0]} cy={chart.last[1]} r="4" fill="var(--primary)" />
                <circle cx={chart.last[0]} cy={chart.last[1]} r="8" fill="var(--primary)" opacity=".2" />
              </svg>
            ) : (
              <div className="muted" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 150, fontSize: 12.5 }}>
                {live ? "No history yet — it appears after your first deposit."
                  : loading ? "Reading your history…"
                  : wrongNetwork ? "Switch to Base Sepolia to see your history."
                  : "History hidden."}
              </div>
            )}
            {realChart ? (
              <span style={{ position: "absolute", top: 6, right: 8 }}>
                <StatusTag variant="live" title="Real position-value history, derived from your on-chain deposits/withdrawals (indexed). Times are approximate." />
              </span>
            ) : preview ? (
              <span style={{ position: "absolute", top: 6, right: 8 }}>
                <Note text="Illustrative history" title="A placeholder shape — your real history appears once deposits/withdrawals are indexed." />
              </span>
            ) : null}
          </div>
        </div>

        <div className="card card-pad riskpanel">
          <div className="card-hd">
            <span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Risk panel
              {preview && previewTag}
            </span>
            <RiskChip tier={1} />
          </div>
          <div className="rp-row">
            <span className="muted">Portfolio risk</span>
            <span style={{ fontWeight: 600 }}>Lower · 1/5 <Note text="from vault tier" title="The Aave vault is tier 1; a per-portfolio score needs your mandate + history." /></span>
          </div>
          <div className="rp-row">
            <span className="muted">Drift vs your plan</span>
            {mandate.status === "ready" && live ? (
              drift === "above_plan" ? (
                <span style={{ fontWeight: 600, color: "var(--caution)" }}>
                  Above your plan{" "}
                  <Note text="higher risk" title={`Your live holdings sit above your ${mandate.mandate.riskLabel.toLowerCase()} (${mandate.mandate.tier}/5) mandate ceiling.`} />
                </span>
              ) : drift === "below_plan" ? (
                /* 030 — the case the indicator could never express. A growth mandate holding only
                   the tier-1 vault is not a violation, so this is deliberately NEUTRAL, not a
                   warning colour, and the copy observes rather than urging more risk (029's
                   advice boundary applies here too). */
                <span style={{ fontWeight: 600 }} title={driftLabel("below_plan")}>
                  More conservative than your plan{" "}
                  <Note
                    text="not a problem"
                    title={`Your holdings sit at tier 1 while your plan allows ${mandate.mandate.tier}/5. That is fine — adjust the plan in Settings if it no longer matches you.`}
                  />
                </span>
              ) : (
                <span style={{ fontWeight: 600, color: "var(--gain)" }} title={`Within your ${mandate.mandate.riskLabel.toLowerCase()} (${mandate.mandate.tier}/5) mandate. Risk-tier drift only; idle cash under-earns your yield goal.`}>
                  On plan
                </span>
              )
            ) : mandate.status === "empty" ? (
              <span className="muted" style={{ fontWeight: 600 }}>— <Note text="no plan yet" title="Set a mandate to compare your live mix against it." /></span>
            ) : (
              <span className="muted" style={{ fontWeight: 600 }}>— <Note text={mandate.status === "disconnected" ? "connect to compare" : "needs your position"} title="Drift compares your live mix to your mandate." /></span>
            )}
          </div>
          <div className="rp-row">
            <span className="muted">Concentration</span>
            <span style={{ fontWeight: 600 }}>{loading ? "…" : live || preview ? `${vaultPct.toFixed(0)}% single vault` : DASH}</span>
          </div>
          <div className="rp-row">
            <span className="muted">Largest position</span>
            <span style={{ fontWeight: 600 }}>{loading ? "…" : largest}</span>
          </div>
          {/* 030/US4 — progress toward the thing the user actually said they were saving for.
              Until this feature "Reach a target — hit a specific amount" stored the bare label
              with no amount and no date, so nothing could ever answer "am I on track?". */}
          <div className="rp-row">
            <span className="muted">Goal progress</span>
            {goal ? (
              <span style={{ fontWeight: 600 }} title={goalTitle}>
                {goal.met
                  ? "Target reached"
                  : `${goal.pct}% of $${formatUsdc(Number(goalTargetUsdc))}`}
                {!goal.met && goal.overdue ? " · date passed" : ""}
              </span>
            ) : mandate.status === "ready" ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => router.push(toHref("settings"))}
                title="Set a target and a date in Settings → Mandate to track progress here."
              >
                Set a target
              </button>
            ) : (
              <span className="muted" style={{ fontWeight: 600 }}>{DASH}</span>
            )}
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
            {preview && previewTag}
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
                    <div style={{ fontSize: 18, fontWeight: 600 }} className="tnum">{donutTotalText}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{degraded ? "—" : `${positions.length} positions`}</div>
                  </div>
                </div>
              </div>
              <div className="legend" style={{ flex: 1 }}>
                <div className="legrow">
                  <span className="sw" style={{ background: "var(--risk-1)" }} />
                  <span className="lg">Aave Yield Vault · Risk 1</span>
                  <span className="lv tnum">{pctText(vaultPct)}</span>
                </div>
                <div className="legrow">
                  <span className="sw" style={{ background: "var(--muted-foreground)" }} />
                  <span className="lg">Idle USDC · uninvested</span>
                  <span className="lv tnum">{pctText(idlePct)}</span>
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
            {preview ? previewTag : <span className="lbl">net of fees</span>}
          </div>
          {emptyLive ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>No open positions.</div>
          ) : degraded ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              {loading ? "Reading your positions…" : wrongNetwork ? "Switch to Base Sepolia to see your positions." : "Couldn’t read your positions — tap Retry above."}
            </div>
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
                    <td className="num tnum">{money(p.valueUsd)}</td>
                    {p.key === "vault" && vaultPnlUsd !== undefined ? (
                      <td
                        className="num tnum"
                        title={vaultCostBasisUsd !== undefined ? `Cost basis ${money(vaultCostBasisUsd)} (avg cost of held shares, indexed on-chain)` : "Unrealized PnL, indexed on-chain"}
                      >
                        {/* .delta is display:inline-flex — it must live in an inner <span>, NOT on the
                            <td> (that would override display:table-cell and break the column grid). */}
                        <span className={vaultPnlUsd > 0 ? "delta up" : vaultPnlUsd < 0 ? "delta down" : "delta flat"} style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                          {vaultPnlUsd >= 0 ? "+" : "−"}{money(Math.abs(vaultPnlUsd))}
                        </span>
                      </td>
                    ) : (
                      <td className="num muted" title="PnL needs a history indexer, not wired yet">
                        — <span style={{ fontSize: 10 }}>pending</span>
                      </td>
                    )}
                    <td>{p.key === "vault" ? <Icon name="chevr" size={15} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* MetaMask-style wallet holdings: native ETH + every ERC-20 the wallet holds, on ANY network
          (incl. Robinhood testnet, which has no vault). Non-custodial, read-only. */}
      {isConnected && v.account && (
        <WalletTokensCard
          chainId={chainId}
          address={v.account}
          networkName={
            chainId === 46630
              ? "Robinhood Testnet"
              : chainId === 8453
                ? "Base"
                : chainId === 84532
                  ? "Base Sepolia"
                  : "this network"
          }
        />
      )}
    </div>
  );
}
