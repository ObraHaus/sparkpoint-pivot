"use client";

/**
 * Admin → Revenue — the treasury multisig balances card (feature 013 US5 / 014 N5), per network.
 *
 * Live-reads the fee-treasury Safe's holdings on a GIVEN chain — native (`getBalance`) + relevant
 * ERC-20 `balanceOf` — on render, at a single block, consistent with a block explorer. PERSISTS
 * NOTHING (no indexer, no migration, no snapshot). The Safe is deployed at the SAME address on every
 * network, but holds different balances per chain, so this renders once per network. Honest-degrades
 * to "unavailable" when no Safe is configured for the chain. States the Safe's ACTUAL on-chain power
 * — a plain recipient with nil authority over user funds (N5) — proving it, not asserting it.
 */

import { useEffect, useState } from "react";
import { type Address, erc20Abi, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { getPublicClient } from "@/lib/chain/clients";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { Icon } from "@/lib/icons";

const DEFAULT_CHAIN = APP_DEFAULT_CHAIN_ID;

type Tok = { symbol: string; address: Address; decimals: number };
type Bal = { symbol: string; decimals: number; balance: bigint };

function addressBookFor(chainId: number) {
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}

function BalRow({ symbol, text }: { symbol: string; text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
      <span style={{ color: "var(--muted-foreground)" }}>{symbol}</span>
      <span className="tnum">{text}</span>
    </div>
  );
}

export function RevenueMultisig({ chainId: chainIdProp }: { chainId?: number } = {}) {
  const { chainId: connectedChainId } = useAccount();
  const cid = chainIdProp ?? connectedChainId ?? DEFAULT_CHAIN;
  const addrs = addressBookFor(cid);
  const safe = addrs?.feeTreasury as Address | undefined;
  const explorerUrl = explorerAddressUrl(cid, safe);

  const [native, setNative] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<Bal[]>([]);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!safe || !addrs) return;
    let alive = true;
    const toks: Tok[] = [];
    if (addrs.usdc) toks.push({ symbol: "USDC", address: addrs.usdc as Address, decimals: cid === 46630 ? 18 : 6 });
    if (addrs.srk) toks.push({ symbol: "SRK", address: addrs.srk as Address, decimals: 18 });
    void (async () => {
      try {
        const client = getPublicClient(cid);
        const nat = await client.getBalance({ address: safe });
        const bals = await Promise.all(
          toks.map((t) =>
            client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
          ),
        );
        if (!alive) return;
        setNative(nat);
        setTokens(toks.map((t, i) => ({ symbol: t.symbol, decimals: t.decimals, balance: bals[i] as bigint })));
        setLoaded(true);
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [safe, cid, addrs]);

  if (!safe) {
    return (
      <div className="chartcard">
        <div className="ch">
          <span className="ct">Fee treasury (multisig)</span>
          <span className="pill">unavailable</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>
          No treasury Safe is configured on this network yet — nothing to show (we never invent a balance).
        </div>
      </div>
    );
  }

  const fmt = (v: bigint, d: number, max: number) =>
    Number(formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: max });
  const shortAddr = `${safe.slice(0, 6)}…${safe.slice(-4)}`;

  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">Fee treasury (multisig)</span>
        {explorerUrl ? (
          <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontSize: 11 }}>
            {shortAddr} ↗
          </a>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "var(--muted-foreground)" }} title={safe}>
            {shortAddr}
          </span>
        )}
      </div>
      {err ? (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>
          Couldn&apos;t read balances right now — they&apos;re live on-chain; reload to retry.
        </div>
      ) : !loaded ? (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>Reading balances…</div>
      ) : (
        <div style={{ marginTop: 6 }}>
          <BalRow symbol="Native" text={native != null ? fmt(native, 18, 5) : "—"} />
          {tokens.map((t) => (
            <BalRow key={t.symbol} symbol={t.symbol} text={fmt(t.balance, t.decimals, 2)} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10, display: "flex", gap: 6 }}>
        <Icon name="info" size={12} />
        <span>
          A 2-of-3 Safe (same address on every network) that only <b style={{ color: "var(--foreground)" }}>receives</b>{" "}
          fees. It has no power over user funds — it can&apos;t pause or move the vault, and can&apos;t withdraw
          anyone&apos;s deposit (N5).
        </span>
      </div>
    </div>
  );
}
