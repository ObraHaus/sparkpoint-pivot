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
import "@/components/screens/portfolio.css";

const DISPLAY_CHAIN_ID = 84532;
const num = (x: bigint | undefined, d: number) => (x === undefined ? undefined : Number(formatUnits(x, d)));

function Tag({ text, title }: { text: string; title: string }) {
  return (
    <span className="pill" title={title} style={{ fontSize: 10, fontWeight: 600, color: "var(--caution)", borderColor: "color-mix(in srgb,var(--caution) 40%,transparent)", background: "var(--caution-subtle)" }}>
      {text}
    </span>
  );
}

export default function Page({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = use(params);
  const { isConnected } = useAccount();
  const base = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID });
  // Second instance parameterized on the loaded shares → previewRedeem(all shares) = realizable now.
  const v = useVault({ chainId: isConnected ? undefined : DISPLAY_CHAIN_ID, previewRedeemShares: base.shares });

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
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", display: "inline-flex", gap: 8, alignItems: "center" }}>
          Accrued yield / PnL <Tag text="pending" title="PnL over time needs a history indexer, not wired yet." />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Transactions</span>
          <Tag text="not indexed yet" title="Deposit/withdraw history needs an indexer; read it on BaseScan for now." />
        </div>
        <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>
          Transaction history isn’t indexed in this build. Your on-chain activity is verifiable directly on{" "}
          <a className="cite" style={{ cursor: "pointer" }} href="https://sepolia.basescan.org" target="_blank" rel="noreferrer">
            BaseScan <Icon name="ext" size={10} />
          </a>.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Link className="btn btn-primary btn-md" href={toHref("vault/deposit")}>Add to position</Link>
        <Link className="btn btn-outline btn-md" href={toHref("vault/withdraw")}>Withdraw</Link>
      </div>
    </div>
  );
}
