"use client";

/**
 * The compact "Portfolio" card in the chat right-rail. Wires the SAME real data the /portfolio page
 * uses (direct-RPC `useVault` → `derivePortfolio` for net worth; the agent's indexed `usePortfolioView`
 * for unrealized PnL) with the SAME honest modes: real when connected+live, an explicitly-tagged
 * "Preview data" mock only while disconnected, dashes when connected-but-degraded (never a mock
 * number mixed with a real one). Replaces the old hardcoded `data.netWorth`/`data.pnl` widget.
 */

import { useAccount, useBalance } from "wagmi";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { Icon } from "@/lib/icons";
import { StatusTag } from "@/components/ui/status-tag";
import { useVault } from "@/lib/chain/useVault";
import { derivePortfolio } from "@/lib/portfolio/derive";
import { usePortfolioView } from "@/lib/agent/useAgent";

const DISPLAY_CHAIN_ID = 84532;
const DASH = "—";

export function ChatPortfolioCard({ onOpen }: { onOpen: () => void }) {
  const { isConnected } = useAccount();
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  const eth = useBalance({ address: v.account, query: { enabled: isConnected && !!v.account } });
  const d = derivePortfolio({
    underlying: v.underlying,
    usdcBalance: v.usdcBalance,
    shares: v.shares,
    ethWei: eth.data?.value,
  });

  const wrongNetwork = isConnected && v.unavailable?.kind === "vault_not_deployed";
  const loading = isConnected && !wrongNetwork && v.isLoading;
  const error = isConnected && !wrongNetwork && !loading && v.isError;
  const live = isConnected && v.isDeployed && !loading && !error && !wrongNetwork;
  const preview = !isConnected;

  // Indexed unrealized PnL (non-custody, agent) — trusted only when LIVE + not stale.
  const agent = usePortfolioView();
  const agentLive = live && !!agent && !agent.stale;
  const unrealized = agentLive ? agent.unrealizedUsd : undefined;

  const netWorth = loading ? "…" : live ? money(d.totalUsd) : preview ? money(data.netWorth) : DASH;

  return (
    <div className="ctx-card" onClick={onOpen} style={{ cursor: "pointer" }}>
      <div className="ck" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        Portfolio
        {preview && (
          <StatusTag variant="mock" title="Illustrative — connect your wallet for your real position (balances read on-chain)." />
        )}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600 }} className="tnum">
        {netWorth}
      </div>
      {live ? (
        unrealized !== undefined ? (
          <div
            className={`delta ${unrealized > 0 ? "up" : unrealized < 0 ? "down" : "flat"}`}
            style={{ fontSize: 12.5, marginTop: 3 }}
            title="Unrealized PnL vs your net deposited — indexed from on-chain deposits & withdrawals."
          >
            {unrealized >= 0 ? "+" : "−"}
            {money(Math.abs(unrealized))} unrealized
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }} title="PnL needs the on-chain flow index; not available yet.">
            USDC across vault + wallet · PnL pending
          </div>
        )
      ) : preview ? (
        <div className="delta up" style={{ fontSize: 12.5, marginTop: 3 }}>
          <Icon name="up" size={13} />+{money(data.pnl.abs)} ({data.pnl.pct}%, {data.pnl.window})
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
          {loading ? "Reading your balances…" : wrongNetwork ? "Vault is on Base Sepolia." : "Live figures hidden."}
        </div>
      )}
    </div>
  );
}
