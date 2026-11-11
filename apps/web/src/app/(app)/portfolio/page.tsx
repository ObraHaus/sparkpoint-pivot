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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { useVault } from "@/lib/chain/useVault";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import { derivePortfolio } from "@/lib/portfolio/derive";
import { useHeldWrappers } from "@/lib/portfolio/useHeldWrappers";
import { toWrapperPositionInput } from "@/lib/chain/vaultOptions";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { usePortfolioView, useMandate, mandateDrift, driftLabel } from "@/lib/agent/useAgent";
import { goalProgress } from "@/lib/goal/progress";
import { formatUsdc } from "@/lib/strategy/projection";
import { StatusTag } from "@/components/ui/status-tag";
import { WalletTokensCard } from "@/components/portfolio/WalletTokensCard";
import { MultichainPanel } from "@/components/portfolio/MultichainPanel";
import { useNetwork } from "@/lib/network";
import { portfolioConnectCopy } from "@/lib/portfolio/liveState";
import "@/components/screens/portfolio.css";

/** The chain to read before a wallet connects (env-resolved via APP_DEFAULT_CHAIN_ID; mirrors
 *  vault/page). On alpha this is the Base-Sepolia vault chain; on the beta it is 4663, which has no
 *  vault deployed — so the pre-connect preview is illustrative, not a live read, there. */
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
  const { nearSignedIn } = useNetwork();
  // The chain to READ: the connected one, or the display chain before a wallet connects.
  const readChainId = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  // 053 — the curated wrappers this wallet actually HOLDS, read over RPC. The fleet is dynamic
  // (deployed on demand, served by the curated board), so the static `sparkPointWrappers` list can
  // never be the source on 4663 — that was the bug that showed nothing to a wrapper depositor. The
  // static read is kept for alpha parity (baseSepolia) and merged, de-duplicated by address.
  const held = useHeldWrappers({ chainId: readChainId, account: isConnected ? v.account : undefined });
  const wrapper0 = safeAddresses(readChainId)?.sparkPointWrappers?.[0];
  const w0 = useVault({
    chainId: isConnected ? undefined : DISPLAY_CHAIN_ID,
    vaultAddress: wrapper0?.address,
    kind: wrapper0 ? "morpho_wrapper" : "aave_launch",
  });
  const staticWrapperRow = wrapper0
    ? toWrapperPositionInput(wrapper0, {
        underlying: w0.underlying,
        shares: w0.shares,
        decimals: w0.assetDecimals,
        shareDecimals: w0.shareDecimals,
        assetIsUsdc:
          w0.asset !== undefined &&
          w0.usdcAddress !== undefined &&
          w0.asset.toLowerCase() === w0.usdcAddress.toLowerCase(),
      })
    : null;
  const wrapperRows = useMemo(() => {
    const rows = [...held.positions];
    if (
      staticWrapperRow &&
      !rows.some((r) => r.vaultAddress.toLowerCase() === staticWrapperRow.vaultAddress.toLowerCase())
    ) {
      rows.unshift(staticWrapperRow);
    }
    return rows;
  }, [held.positions, staticWrapperRow]);

  // Native ETH on the connected chain (useBalance defaults to the wallet's chain; disabled off-wallet).
  const eth = useBalance({ address: v.account, query: { enabled: isConnected && !!v.account } });
  // The connected chain's stablecoin (USDG on Robinhood Chain 4663, USDC on Base) — read directly via
  // balanceOf/decimals/symbol so a wallet's real idle stable shows even when there's no vault to route
  // it into (the 4663 beta). wagmi v3's useBalance no longer reads ERC-20s, so this is a batched read.
  const stableAddr = safeAddresses(readChainId)?.usdc as Address | undefined;
  const stableEnabled = isConnected && !!v.account && !!stableAddr;
  const stableReads = useReadContracts({
    query: { enabled: stableEnabled },
    contracts:
      stableAddr && v.account
        ? [
            { address: stableAddr, abi: erc20Abi, functionName: "balanceOf", args: [v.account as Address] },
            { address: stableAddr, abi: erc20Abi, functionName: "decimals" },
            { address: stableAddr, abi: erc20Abi, functionName: "symbol" },
          ]
        : [],
  });
  const stableRaw = stableReads.data?.[0]?.result as bigint | undefined;
  const stableDecimals = stableReads.data?.[1]?.result as number | undefined;
  const stableSymbol = stableReads.data?.[2]?.result as string | undefined;
  const stableSymbolText = stableSymbol ?? (readChainId === 4663 ? "USDG" : "USDC");

  // 053 — the derivation composes the wallet's REAL holdings: the idle stable (direct read), the
  // launch vault when present, and every held curated wrapper. Idle is fed straight in, so the
  // portfolio is real BEFORE any deposit and on a chain with no SparkPoint vault at all.
  const d = derivePortfolio({
    underlying: VAULT_CHAIN_AVAILABLE ? v.underlying : undefined,
    usdcBalance: stableRaw ?? v.usdcBalance,
    shares: VAULT_CHAIN_AVAILABLE ? v.shares : undefined,
    ethWei: eth.data?.value,
    wrappers: wrapperRows,
    stableDecimals,
  });

  // Mode — what the user's LIVE state actually is. A CONNECTED-but-not-live state (reads still in
  // flight / a read failed) is DEGRADED → dashes + skeletons, never the mock figures. Only the
  // disconnected PREVIEW shows illustrative mock (labelled on every card) — and only on a build
  // whose chain has the launch vault; the beta shows a connect prompt instead of an Aave mock.
  const wrongNetwork = isConnected && v.unavailable?.kind === "vault_not_deployed";
  // §B3: Robinhood testnet (46630) is a SUPPORTED chain with no vault (vault is Base-only). It's a
  // "wrong network" for the VAULT, but we acknowledge it honestly and still show the wallet's ETH.
  const robinhood = wrongNetwork && chainId === 46630;
  const stableSettling = stableEnabled && stableReads.isLoading && stableRaw === undefined;
  const ethSettling = isConnected && !!v.account && eth.isLoading;
  const loading =
    isConnected &&
    !v.isError &&
    !(stableEnabled && stableReads.isError) &&
    (stableSettling || ethSettling || held.isLoading);
  const error = isConnected && (v.isError || (stableEnabled && stableReads.isError));
  // 053 — LIVE means "connected and this wallet's chain reads have settled", NOT "the launch vault
  // is deployed". On 4663 there is no launch vault, yet the wallet's funds and wrapper positions are
  // real and must be shown.
  const live = isConnected && !loading && !error;
  const preview = !isConnected;
  // A verified NEAR session is signed in but has no EVM wallet: no illustrative EVM preview.
  const previewMock = preview && !nearSignedIn && VAULT_CHAIN_AVAILABLE;

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
  const chartVals = realChart ? realPoints.map((p) => p.v) : previewMock ? data.series1M : null;
  const chart = chartVals && chartVals.length >= 2 ? areaPath(chartVals, 560, 150) : null;

  // Allocation split — built from the SAME derived positions the table shows: every held vault
  // (launch or curated wrapper) plus the idle stable. With no vault at all it is 100% cash, which is
  // exactly what a pre-deposit wallet should see. Preview keeps the labelled illustrative split.
  const POSITION_COLORS = ["var(--risk-1)", "var(--primary)", "var(--gain)", "var(--brand-cyan)"];
  const mockTotal = data.allocation.reduce((s, x) => s + x.v, 0);
  const mockVaultPct = (data.allocation[0].v / mockTotal) * 100;
  const livePositions = live
    ? d.positions.filter(
        (p) => (p.key !== "vault" || VAULT_CHAIN_AVAILABLE) && (p.key === "idle" || p.valueUsd > 0),
      )
    : [];
  const hasFunds = live && d.hasPositions;
  const hasVaultPosition = live && d.positions.some((p) => p.key !== "idle" && p.valueUsd > 0);
  // The table's rows: the live derived positions, or the labelled illustrative pair for a preview.
  const mockPositionRows = [
    { key: "vault" as const, label: "Aave Yield Vault", sub: "9,834.50 spvUSDC", valueUsd: data.allocation[0].v },
    { key: "idle" as const, label: "Idle USDC", sub: "in your wallet", valueUsd: data.allocation[1].v },
  ];
  const tableRows = live ? livePositions : previewMock ? mockPositionRows : [];
  const segments = live
    ? livePositions
        .filter((p) => p.valueUsd > 0)
        .map((p, i) => ({
          key: p.key,
          label:
            p.key === "idle"
              ? `Idle ${stableSymbolText} · uninvested`
              : p.external
                ? p.label
                : `${p.label} · Risk 1`,
          pct: d.totalUsd > 0 ? (p.valueUsd / d.totalUsd) * 100 : 0,
          color: p.key === "idle" ? "var(--muted-foreground)" : POSITION_COLORS[i % POSITION_COLORS.length],
        }))
    : previewMock
      ? [
          { key: "vault", label: "Aave Yield Vault · Risk 1", pct: mockVaultPct, color: "var(--risk-1)" },
          { key: "idle", label: "Idle USDC · uninvested", pct: 100 - mockVaultPct, color: "var(--muted-foreground)" },
        ]
      : [];
  const donut = segments.length
    ? `conic-gradient(${segments
        .map((s, i) => {
          const from = segments.slice(0, i).reduce((a, x) => a + x.pct, 0);
          return `${s.color} ${from.toFixed(2)}% ${(from + s.pct).toFixed(2)}%`;
        })
        .join(", ")})`
    : "conic-gradient(var(--border-soft) 0 100%)";
  const largestPos =
    live && livePositions.length > 0
      ? livePositions.reduce((a, b) => (b.valueUsd > a.valueUsd ? b : a))
      : undefined;
  const largest = live
    ? largestPos
      ? largestPos.key === "idle"
        ? `Idle ${stableSymbolText}`
        : largestPos.label
      : DASH
    : previewMock
      ? "Aave Yield Vault"
      : DASH;
  const concentrationPct =
    live && hasVaultPosition && d.totalUsd > 0
      ? Math.max(
          ...d.positions
            .filter((p) => p.key !== "idle" && p.valueUsd > 0)
            .map((p) => (p.valueUsd / d.totalUsd) * 100),
        )
      : undefined;

  // 053 — wrapper PnL comes from the agent's per-position replay (keyed `wrapper:<addr>`); the
  // web's own key for a held wrapper is `ext:<addr>`. Only trusted when the agent read is live.
  const pnlFor = (key: string): { value: number; costBasis?: number } | undefined => {
    if (!agentLive || !agent) return undefined;
    if (key === "vault") {
      return vaultPnlUsd === undefined ? undefined : { value: vaultPnlUsd, costBasis: vaultCostBasisUsd };
    }
    if (!key.startsWith("ext:")) return undefined;
    const p = agent.positionPnl[`wrapper:${key.slice(4)}`];
    if (!p || p.unrealizedPnlUsd === undefined) return undefined;
    return { value: p.unrealizedPnlUsd, costBasis: p.costBasisUsd };
  };

  const netWorthText = loading ? "…" : live ? money(d.totalUsd) : previewMock ? money(data.netWorth) : DASH;
  const donutTotalText = loading ? "…" : live ? money(d.totalUsd, 0) : previewMock ? money(mockTotal, 0) : DASH;
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

      {wrongNetwork && VAULT_CHAIN_AVAILABLE && (
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
              {previewMock && previewTag}
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
              <span className="muted" style={{ fontSize: 12.5 }}>
                {stableSymbolText} at $1 par{d.wrapperValue > 0 ? " · vault positions at asset value" : ""}
              </span>
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
          ) : previewMock ? (
            <div className="delta up" style={{ marginTop: 8 }}>
              <Icon name="up" size={15} />+{money(data.pnl.abs)} (+{data.pnl.pct}%, {data.pnl.window})
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              {loading ? "Reading your balances…" : error ? "Live figures hidden — tap Retry above." : portfolioConnectCopy({ nearSignedIn, area: "portfolio" })}
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
                  : portfolioConnectCopy({ nearSignedIn, area: "history" })}
              </div>
            )}
            {realChart ? (
              <span style={{ position: "absolute", top: 6, right: 8 }}>
                <StatusTag variant="live" title="Real position-value history, derived from your on-chain deposits/withdrawals (indexed). Times are approximate." />
              </span>
            ) : previewMock ? (
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
              {previewMock && previewTag}
            </span>
            {/* The tier chip + portfolio-risk score describe the vault position (tier 1). When
                degraded (e.g. connected on the beta with no vault) there IS no position, so show
                nothing rather than a fabricated "1/5", matching the DASH'd rows below. */}
            {(hasVaultPosition || previewMock) && <RiskChip tier={1} />}
          </div>
          <div className="rp-row">
            <span className="muted">Portfolio risk</span>
            {hasVaultPosition || previewMock ? (
              <span style={{ fontWeight: 600 }}>Lower · 1/5 <Note text="from vault tier" title="The live vault is tier 1; a per-portfolio score needs your mandate + history." /></span>
            ) : (
              <span className="muted" style={{ fontWeight: 600 }}>{DASH}</span>
            )}
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
            <span style={{ fontWeight: 600 }}>{loading ? "…" : concentrationPct !== undefined ? `${concentrationPct.toFixed(0)}% single vault` : DASH}</span>
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
          {(hasVaultPosition || previewMock) && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              Capital-preservation-first. The live vault is the lowest tier on our scale.{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("strategies"))}>Improve this</a>
            </div>
          )}
        </div>
      </div>

      <div className="pf-grid">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Allocation by risk tier</span>
            {previewMock && previewTag}
          </div>
          {live && !hasFunds ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              No {stableSymbolText} or vault positions yet.{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault/deposit"))}>Deposit {stableSymbolText}</a> to get started.
            </div>
          ) : segments.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div className="donut" style={{ background: donut, position: "relative" }}>
                <div style={{ position: "absolute", inset: 18, borderRadius: "50%", background: "var(--card)", display: "grid", placeItems: "center", textAlign: "center" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }} className="tnum">{donutTotalText}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                      {segments.length} position{segments.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="legend" style={{ flex: 1 }}>
                {segments.map((s) => (
                  <div className="legrow" key={s.key}>
                    <span className="sw" style={{ background: s.color }} />
                    <span className="lg">{s.label}</span>
                    <span className="lv tnum">{`${s.pct.toFixed(0)}%`}</span>
                  </div>
                ))}
                <div className="divider" />
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Idle {stableSymbolText} earns nothing.{" "}
                  <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault/deposit"))}>Put it to work</a>
                </div>
              </div>
            </div>
          ) : (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              {loading ? "Reading your allocation…" : error ? "Couldn’t read your allocation — tap Retry above." : portfolioConnectCopy({ nearSignedIn, area: "allocation" })}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Positions</span>
            {previewMock ? previewTag : <span className="lbl">net of fees</span>}
          </div>
          {live && !hasFunds ? (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              No {stableSymbolText} or vault positions yet — nothing to show until your first deposit.
            </div>
          ) : tableRows.length ? (
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
                {tableRows.map((p) => {
                  const pnl = pnlFor(p.key);
                  // 053 — a held curated wrapper routes to its own withdraw screen (the same one the
                  // vault card and Trust & Exit use); the launch vault keeps its detail page.
                  const isWrapperRow = p.key.startsWith("ext:");
                  const rowHref =
                    p.key === "vault"
                      ? toHref("portfolio/vault")
                      : isWrapperRow
                        ? `${toHref("vault/withdraw")}?vault=${p.key.slice(4)}`
                        : undefined;
                  return (
                    <tr key={p.key} style={rowHref ? { cursor: "pointer" } : undefined}
                        onClick={rowHref ? () => router.push(rowHref) : undefined}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.key === "idle" ? `Idle ${stableSymbolText}` : p.label}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{p.key === "idle" ? "in your wallet · earning nothing" : p.sub}</div>
                      </td>
                      <td className="num tnum">{money(p.valueUsd)}</td>
                      {pnl ? (
                        <td
                          className="num tnum"
                          title={pnl.costBasis !== undefined ? `Cost basis ${money(pnl.costBasis)} (avg cost of held shares, indexed on-chain)` : "Unrealized PnL, indexed on-chain"}
                        >
                          {/* .delta is display:inline-flex — it must live in an inner <span>, NOT on the
                              <td> (that would override display:table-cell and break the column grid). */}
                          <span className={pnl.value > 0 ? "delta up" : pnl.value < 0 ? "delta down" : "delta flat"} style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                            {pnl.value >= 0 ? "+" : "−"}{money(Math.abs(pnl.value))}
                          </span>
                        </td>
                      ) : (
                        <td className="num muted" title="PnL appears once the indexed history reconciles">
                          — <span style={{ fontSize: 10 }}>pending</span>
                        </td>
                      )}
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {p.key === "vault" ? <Icon name="chevr" size={15} /> : null}
                        {p.key === "idle" ? (
                          <a
                            style={{ color: "var(--primary)", cursor: "pointer", fontSize: 12 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(toHref("vault/deposit"));
                            }}
                          >
                            Put it to work
                          </a>
                        ) : null}
                        {isWrapperRow ? (
                          // A real button (not a faux-link): keyboard-focusable, and it stops the
                          // row's own click from firing the navigation twice.
                          <button
                            type="button"
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: "var(--primary)",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(rowHref!);
                            }}
                          >
                            Withdraw
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="muted" style={{ padding: "22px 4px", fontSize: 13 }}>
              {loading ? "Reading your positions…" : error ? "Couldn’t read your positions — tap Retry above." : portfolioConnectCopy({ nearSignedIn, area: "positions" })}
            </div>
          )}
        </div>
      </div>

      {/* 072 — the read-only multi-chain overview (session wallet only). The SparkPoint vault view
          above is untouched; this is a separate, independently-degradable read. */}
      <MultichainPanel />

      {/* MetaMask-style wallet holdings: native ETH + the tokens we know or discover, on ANY network
          (incl. Robinhood Chain, which has no SparkPoint vault). Non-custodial, read-only. */}
      {isConnected && v.account && (
        <WalletTokensCard
          chainId={chainId}
          address={v.account}
          networkName={
            chainId === 4663
              ? "Robinhood Chain"
              : chainId === 46630
                ? "Robinhood Testnet"
                : chainId === 8453
                  ? "Base"
                  : chainId === 84532
                    ? "Base Sepolia"
                    : "this network"
          }
          extraKnown={wrapperRows.map((w) => ({
            address: w.vaultAddress,
            symbol: w.label,
            name: w.label,
            shares: true,
          }))}
        />
      )}
    </div>
  );
}
