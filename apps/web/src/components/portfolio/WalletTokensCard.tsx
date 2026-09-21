"use client";

/**
 * WalletTokensCard — a MetaMask-style holdings list for the connected wallet: native ETH (gas token)
 * + the ERC-20s we can name or discover.
 *
 * 053 — the ERC-20 rows now come from THREE honest sources:
 *   • the chain's KNOWN tokens (stable + wrapped native + curated wrapper shares), read directly
 *     over RPC — this is what makes the card work on Robinhood Chain 4663, whose explorer is behind
 *     a Cloudflare challenge;
 *   • the user's ADDED tokens, pasted by address (validated by a real probe read, persisted per
 *     chain+wallet, removable) — display-only, never a policy target;
 *   • explorer enumeration (Blockscout) where the chain has one.
 *
 * Native ETH is a direct-RPC wagmi `useBalance` read. Non-custodial + read-only. Tokens without a
 * price feed are shown WITHOUT a USD value rather than a fabricated one.
 */

import { useMemo, useState } from "react";
import { useBalance, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { Icon } from "@/lib/icons";
import { useAddedTokens, useWalletTokens } from "@/lib/portfolio/useWalletTokens";
import { mergeTokens, parseTokenAddress, type KnownToken } from "@/lib/portfolio/knownTokens";

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

function TokenRow({
  symbol,
  name,
  right,
  color,
  token,
  chainId,
  onRemove,
}: {
  symbol: string;
  name: string;
  right: string;
  color: string;
  /** 052 — when present, the row shows the token's real logo (local art first; avatar fallback). */
  token?: { symbol: string; address: string; isNative?: boolean; verified?: boolean };
  chainId?: number;
  /** 053 — a user-added token can be removed (it was display-only anyway). */
  onRemove?: () => void;
}) {
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
      {token ? <TokenLogo token={token} chainId={chainId} size={30} /> : <Avatar symbol={symbol} color={color} />}
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
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${symbol}`}
          title="Remove this added token"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--muted-foreground)",
            cursor: "pointer",
            padding: 2,
            flex: "none",
            lineHeight: 1,
          }}
        >
          <Icon name="x" size={13} />
        </button>
      )}
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
  extraKnown,
}: {
  chainId?: number;
  address?: `0x${string}`;
  networkName: string;
  /** 053 — the curated wrapper share tokens for this chain (from the board). */
  extraKnown?: readonly KnownToken[];
}) {
  const eth = useBalance({ address, query: { enabled: !!address } });
  const { added, add, remove } = useAddedTokens(chainId, address);
  const known = useMemo(
    () => mergeTokens(extraKnown ?? [], added.map((a): KnownToken => ({ address: a, symbol: "" }))),
    [extraKnown, added],
  );
  const { tokens, isLoading, isError, isSupported, refetch } = useWalletTokens(chainId, address, known);
  const ethAmount = eth.data ? Number(formatUnits(eth.data.value, eth.data.decimals)) : undefined;
  const addedSet = useMemo(() => new Set(added.map((a) => a.toLowerCase())), [added]);

  // "Add token by address": shape validation is local; the PROBE read decides whether it is an
  // ERC-20 (symbol/decimals/balanceOf). Nothing is persisted until the probe succeeds.
  const [input, setInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const parsed = parseTokenAddress(input);
  const probe = useReadContracts({
    query: { enabled: !!parsed && !!address },
    contracts: parsed
      ? [
          { address: parsed, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] },
          { address: parsed, abi: erc20Abi, functionName: "decimals" },
          { address: parsed, abi: erc20Abi, functionName: "symbol" },
        ]
      : [],
  });

  function onAddToken(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) {
      setAddError("That doesn't look like a token address — it should be 0x followed by 40 hex characters.");
      return;
    }
    if (addedSet.has(parsed.toLowerCase())) {
      setAddError("That token is already in your list.");
      return;
    }
    if (probe.isFetching || probe.data === undefined) {
      setAddError("Still reading that address — try again in a moment.");
      return;
    }
    const failed = probe.isError || probe.data[0]?.status === "failure" || probe.data[0]?.result === undefined;
    if (failed) {
      setAddError("Couldn't read that address as an ERC-20 on this network.");
      return;
    }
    add(parsed);
    setInput("");
    setAddError(null);
  }

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
          token={{ symbol: "ETH", address: "", isNative: true }}
          chainId={chainId}
          right={ethAmount !== undefined ? `${fmtAmount(ethAmount)} ETH` : "…"}
        />

        {/* ERC-20s — known/added read over RPC; explorer discovery where mapped. */}
        {isLoading ? (
          <Muted>Reading your tokens…</Muted>
        ) : isError && tokens.length === 0 ? (
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
              token={{ symbol: t.symbol, address: t.address, verified: false }}
              chainId={chainId}
              right={`${fmtAmount(t.amount)} ${t.symbol}`}
              onRemove={addedSet.has(t.address.toLowerCase()) ? () => remove(t.address) : undefined}
            />
          ))
        )}
      </div>

      {/* 053 — add any ERC-20 by address; the probe read is the authority, not the paste. */}
      <form onSubmit={onAddToken} style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (addError) setAddError(null);
          }}
          placeholder="0x… token address"
          aria-label="Token address"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border-soft)",
            background: "transparent",
            color: "var(--foreground)",
            fontSize: 12.5,
            fontFamily: "var(--font-mono, monospace)",
          }}
        />
        <button
          type="submit"
          className="btn btn-outline btn-sm"
          disabled={!input.trim() || probe.isFetching}
          style={{ flex: "none" }}
        >
          {probe.isFetching ? "Reading…" : "Add token"}
        </button>
      </form>
      {addError && (
        <div role="alert" style={{ marginTop: 6, fontSize: 11.5, color: "var(--loss)" }}>
          {addError}
        </div>
      )}

      <div className="muted" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.5 }}>
        {isSupported ? (
          <>
            Balances read live on-chain and from the {networkName} explorer — non-custodial, read-only. Tokens
            without a price feed are shown without a USD value.
          </>
        ) : (
          <>
            Balances read live on {networkName} — non-custodial, read-only. This network has no explorer
            enumeration, so the list shows the tokens we know plus any you add by address.
          </>
        )}
      </div>
    </div>
  );
}
