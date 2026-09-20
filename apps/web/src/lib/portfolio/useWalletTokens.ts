"use client";

/**
 * useWalletTokens — the connected wallet's ERC-20 holdings, from two honest sources.
 *
 * 1. KNOWN + ADDED tokens are read DIRECTLY over RPC (`balanceOf`/`decimals`/`symbol`). This works
 *    on every supported chain — including Robinhood Chain 4663, whose public explorer sits behind a
 *    Cloudflare challenge and therefore cannot be enumerated from the app. The known list is the
 *    chain's stable + wrapped native (address book) plus any curated wrapper share tokens; the added
 *    list is whatever the user pasted in (validated by the probe, persisted per chain+wallet).
 * 2. ARBITRARY ERC-20 DISCOVERY still uses the chain's public Blockscout instance where one is
 *    mapped (Base / Base Sepolia / Robinhood testnet). Pure RPC cannot enumerate unknown tokens.
 *
 * Honest by design: testnet explorers return no `exchange_rate`, so we surface balances + symbols
 * only and never fabricate a USD value. An added token is display-only — never a policy target.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import {
  addedTokensKey,
  parseAddedTokenList,
  readAddedTokens,
  writeAddedTokens,
  type KnownToken,
} from "./knownTokens";

/** Chains with a keyless Blockscout instance we can enumerate token balances from. */
const BLOCKSCOUT_BASE: Record<number, string> = {
  8453: "https://base.blockscout.com", // Base mainnet
  84532: "https://base-sepolia.blockscout.com", // Base Sepolia
  46630: "https://explorer.testnet.chain.robinhood.com", // Robinhood Chain Testnet
};

export interface WalletToken {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly address: `0x${string}`;
  /** Raw on-chain balance (base units). */
  readonly balance: bigint;
  /** Balance as a JS number (display only — never used for signing). */
  readonly amount: number;
}

interface RawTokenBalance {
  value?: string;
  token?: {
    symbol?: string | null;
    name?: string | null;
    decimals?: string | null;
    type?: string | null;
    address?: string | null;
    address_hash?: string | null;
  };
}

async function fetchWalletTokens(chainId: number, address: string): Promise<WalletToken[]> {
  const base = BLOCKSCOUT_BASE[chainId];
  if (!base) return [];
  const res = await fetch(`${base}/api/v2/addresses/${address}/token-balances`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];
  return (raw as RawTokenBalance[])
    .filter((t) => t?.token?.type === "ERC-20" && !!t.value && t.value !== "0")
    .map((t): WalletToken | null => {
      const addr = (t.token?.address_hash ?? t.token?.address ?? "") as string;
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return null;
      const decimals = Number(t.token?.decimals ?? 18) || 18;
      let balance: bigint;
      try {
        balance = BigInt(t.value as string);
      } catch {
        return null;
      }
      if (balance <= 0n) return null;
      return {
        symbol: (t.token?.symbol || "?").slice(0, 12),
        name: t.token?.name || t.token?.symbol || "Token",
        decimals,
        address: addr as `0x${string}`,
        balance,
        amount: Number(formatUnits(balance, decimals)),
      };
    })
    .filter((t): t is WalletToken => t !== null)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ── user-added tokens (localStorage-backed, chain + wallet scoped, live across tabs) ─────────────

const addedListeners = new Set<() => void>();

function emitAddedTokens(): void {
  for (const l of addedListeners) l();
}

function subscribeAddedTokens(cb: () => void): () => void {
  addedListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("sp:added-tokens:")) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    addedListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export interface AddedTokensResult {
  readonly added: Address[];
  readonly add: (a: Address) => void;
  readonly remove: (a: Address) => void;
}

/** The user's added tokens for this wallet, persisted locally. */
export function useAddedTokens(chainId: number | undefined, account: string | undefined): AddedTokensResult {
  const key = chainId !== undefined && account ? addedTokensKey(chainId, account) : null;
  // The stored JSON string IS the snapshot: a primitive, so it is stable across renders and the
  // component re-renders exactly when it changes (this tab via `emitAddedTokens`, others via the
  // browser's `storage` event).
  const raw = useSyncExternalStore(
    subscribeAddedTokens,
    () => (key ? window.localStorage.getItem(key) : null),
    () => null,
  );
  const added = useMemo(() => parseAddedTokenList(raw), [raw]);

  const add = useCallback(
    (a: Address) => {
      if (!key || chainId === undefined || !account) return;
      const current = readAddedTokens(chainId, account);
      if (current.some((x) => x.toLowerCase() === a.toLowerCase())) return;
      writeAddedTokens(chainId, account, [...current, a]);
      emitAddedTokens();
    },
    [key, chainId, account],
  );

  const remove = useCallback(
    (a: Address) => {
      if (!key || chainId === undefined || !account) return;
      writeAddedTokens(
        chainId,
        account,
        readAddedTokens(chainId, account).filter((x) => x.toLowerCase() !== a.toLowerCase()),
      );
      emitAddedTokens();
    },
    [key, chainId, account],
  );

  return { added, add, remove };
}

// ── the merged read ──────────────────────────────────────────────────────────────────────────────

export interface WalletTokensResult {
  readonly tokens: WalletToken[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** true when this chain also has an explorer we can enumerate from (discovery, not the known list). */
  readonly isSupported: boolean;
  readonly refetch: () => void;
}

export function useWalletTokens(
  chainId: number | undefined,
  address: string | undefined,
  known: readonly KnownToken[] = [],
): WalletTokensResult {
  // Known + added tokens: direct RPC reads, one triple (balanceOf/decimals/symbol) per token.
  const rpcEnabled = !!address && known.length > 0;
  const rpc = useReadContracts({
    query: { enabled: rpcEnabled },
    contracts: known.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] },
      { address: t.address, abi: erc20Abi, functionName: "decimals" },
      { address: t.address, abi: erc20Abi, functionName: "symbol" },
    ]),
  });

  const rpcTokens = useMemo<WalletToken[]>(() => {
    if (!rpc.data) return [];
    const out: WalletToken[] = [];
    known.forEach((t, i) => {
      const base = i * 3;
      const balance = rpc.data[base]?.result as bigint | undefined;
      const decimals = rpc.data[base + 1]?.result as number | undefined;
      const symbol = rpc.data[base + 2]?.result as string | undefined;
      if (balance === undefined || balance <= 0n) return;
      const dec = decimals ?? t.decimals ?? 18;
      out.push({
        symbol: (symbol || t.symbol || "?").slice(0, 12),
        name: t.name || symbol || t.symbol || "Token",
        decimals: dec,
        address: t.address,
        balance,
        amount: Number(formatUnits(balance, dec)),
      });
    });
    return out;
  }, [rpc.data, known]);

  // Explorer enumeration — only where a Blockscout instance is mapped.
  const isSupported = chainId !== undefined && chainId in BLOCKSCOUT_BASE;
  const explorerEnabled = isSupported && !!address;
  const explorer = useQuery({
    queryKey: ["wallet-tokens", chainId, address],
    queryFn: () => fetchWalletTokens(chainId as number, address as string),
    enabled: explorerEnabled,
    staleTime: 30_000,
    retry: 1,
  });

  const tokens = useMemo(() => {
    const seen = new Set(rpcTokens.map((t) => t.address.toLowerCase()));
    const extra = (explorer.data ?? []).filter((t) => !seen.has(t.address.toLowerCase()));
    return [...rpcTokens, ...extra].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [rpcTokens, explorer.data]);

  const refetch = () => {
    void rpc.refetch();
    if (explorerEnabled) void explorer.refetch();
  };

  return {
    tokens,
    isLoading: rpcEnabled && (rpc.isLoading || rpc.isFetching) && rpc.data === undefined,
    isError: rpc.isError || (explorerEnabled && explorer.isError),
    isSupported,
    refetch,
  };
}
