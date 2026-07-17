"use client";

/**
 * useWalletTokens — MetaMask-style ERC-20 discovery for the connected wallet.
 *
 * Pure RPC can't ENUMERATE the arbitrary ERC-20s a wallet holds (you'd have to already know each
 * token address), so — exactly like MetaMask/Rabby — we read the holdings from the chain's public
 * block explorer (Blockscout v2 `/addresses/{addr}/token-balances`). This is READ-ONLY public chain
 * data over a CORS-open, keyless endpoint; it holds no custody and signs nothing. Native ETH is NOT
 * here (it isn't an ERC-20) — the card reads that via wagmi `useBalance`.
 *
 * Honest by design: testnet explorers return no `exchange_rate`, so we surface balances + symbols
 * only and never fabricate a USD value. Unsupported chains (no Blockscout mapping) return `[]`.
 */

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

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

export interface WalletTokensResult {
  readonly tokens: WalletToken[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** true when this chain has an explorer we can enumerate from (else the ERC-20 list is unavailable). */
  readonly isSupported: boolean;
  readonly refetch: () => void;
}

export function useWalletTokens(chainId: number | undefined, address: string | undefined): WalletTokensResult {
  const isSupported = chainId !== undefined && chainId in BLOCKSCOUT_BASE;
  const enabled = isSupported && !!address;
  const q = useQuery({
    queryKey: ["wallet-tokens", chainId, address],
    queryFn: () => fetchWalletTokens(chainId as number, address as string),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
  return {
    tokens: q.data ?? [],
    isLoading: enabled && (q.isLoading || q.isFetching) && q.data === undefined,
    isError: q.isError,
    isSupported,
    refetch: () => void q.refetch(),
  };
}
