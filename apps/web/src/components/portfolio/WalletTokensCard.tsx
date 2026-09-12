"use client";

/**
 * WalletTokensCard — a MetaMask-style holdings list for the connected wallet: native ETH (gas token)
 * + every ERC-20 the wallet holds, on ANY supported network — Base Sepolia, Base, and Robinhood
 * testnet (which has no vault, so this is the portfolio's real content there).
 *
 * Native ETH is a direct-RPC wagmi `useBalance` read; the ERC-20s are enumerated from the chain's
 * public Blockscout explorer via {@link useWalletTokens} (pure RPC can't list unknown tokens).
 * Non-custodial + read-only. Testnet tokens have no market price, so amounts show WITHOUT a USD value
 * rather than a fabricated one.
 */

import { useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useWalletTokens } from "@/lib/portfolio/useWalletTokens";

/** Ethereum brand purple for the native row; ERC-20s get a deterministic color from their symbol. */
const ETH_COLOR = "#627EEA";
const PALETTE = ["#0052FF", "#00C805", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#14b8a6"];

function colorFor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function fmtAmount(n: number): string {
  if (n === 0) return "0";
  if (n > 0 && n < 0.0001) return "<0.0001";
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1 ? 4 : 6 });
}

function Avatar({ symbol, color }: { symbol: string; color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.2,
        flex: "none",
      }}
    >
      {symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?"}
    </span>
  );
}

function TokenRow({ symbol, name, right, color }: { symbol: string; name: string; right: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderTop: "1px solid var(--border-soft)",
      }}
    >
      <Avatar symbol={symbol} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{symbol}</div>
        <div
          className="muted"
          style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {name}
        </div>
      </div>
      <div className="tnum" style={{ fontWeight: 600, fontSize: 13.5, textAlign: "right", flex: "none" }}>
        {right}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{ padding: "14px 0", fontSize: 12.5, borderTop: "1px solid var(--border-soft)", lineHeight: 1.5 }}
    >
      {children}
    </div>
  );
}

export function WalletTokensCard({
  chainId,
  address,
  networkName,
}: {
  chainId?: number;
  address?: `0x${string}`;
  networkName: string;
}) {
  const eth = useBalance({ address, query: { enabled: !!address } });
  const { tokens, isLoading, isError, isSupported, refetch } = useWalletTokens(chainId, address);
  const ethAmount = eth.data ? Number(formatUnits(eth.data.value, eth.data.decimals)) : undefined;

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <div className="card-hd" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="lbl">Wallet tokens</span>
        <span className="muted" style={{ fontSize: 11.5 }}>{networkName}</span>
      </div>

      <div style={{ marginTop: 4 }}>
        {/* Native gas token — always shown, direct-RPC. */}
        <TokenRow
          symbol="ETH"
          name="Ether · native gas token"
          color={ETH_COLOR}
          right={ethAmount !== undefined ? `${fmtAmount(ethAmount)} ETH` : "…"}
        />

        {/* ERC-20s — enumerated from the chain's explorer. */}
        {!isSupported ? (
          <Muted>Token discovery isn&apos;t available on this network yet.</Muted>
        ) : isLoading ? (
          <Muted>Reading your tokens from the {networkName} explorer…</Muted>
        ) : isError ? (
          <Muted>
            Couldn&apos;t load token balances just now.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={refetch}>
              Retry
            </a>
            .
          </Muted>
        ) : tokens.length === 0 ? (
          <Muted>No ERC-20 tokens in this wallet yet — just native ETH.</Muted>
        ) : (
          tokens.map((t) => (
            <TokenRow
              key={t.address}
              symbol={t.symbol}
              name={t.name}
              color={colorFor(t.symbol)}
              right={`${fmtAmount(t.amount)} ${t.symbol}`}
            />
          ))
        )}
      </div>

      <div className="muted" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.5 }}>
        Balances read live from the {networkName} explorer — non-custodial, read-only. Tokens without a price feed are
        shown without a USD value.
      </div>
    </div>
  );
}
