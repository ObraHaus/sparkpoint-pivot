"use client";

/**
 * Read-only balance seams for the merged `/vault` list.
 *
 * Each protocol keeps its own existing source of truth — Rhea reuses the same read-only NEAR
 * preflight the live Rhea flow uses, Kamino reuses the positions endpoint the live Kamino flow
 * uses, and Morpho is read through the existing ERC-4626 `useWrapperHolding` hook. Nothing here
 * signs, sends or prompts a wallet; a missing wallet simply yields no read.
 *
 * Every hook returns the account its data belongs to. The display layer compares that with the
 * current account, so a disconnect/account switch can never leave the previous wallet's amount on
 * a card while the new read is in flight.
 */

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { getInjectedSolanaProvider } from "@/lib/solana/wallet";

export interface ProtocolBalance {
  /** The account this read is scoped to (`null` when that chain has no wallet). */
  readonly account: string | null;
  /** Human amount when the read SUCCEEDED; `null` also means a genuine zero position. */
  readonly amount: string | null;
  readonly symbol: string;
  readonly loading: boolean;
  readonly error: boolean;
}

interface RheaBalanceResponse {
  ok?: unknown;
  suppliedUsdc?: unknown;
}

/**
 * The connected NEAR account, when the injected Solana wallet already trusts this page.
 * We never call `connect()` here — a preview card must not prompt a signature/connection.
 */
function subscribeSolanaAccount(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const id = window.setInterval(onChange, 1_500);
  const onFocus = () => onChange();
  window.addEventListener("focus", onFocus);
  return () => {
    window.clearInterval(id);
    window.removeEventListener("focus", onFocus);
  };
}

function solanaAccountSnapshot(): string | null {
  const provider = getInjectedSolanaProvider();
  const address = provider?.publicKey?.toBase58?.().trim();
  return address || null;
}

/** The Solana wallet's public address if it is already connected/trusted, else `null`. */
export function useSolanaAccount(): string | null {
  return useSyncExternalStore(subscribeSolanaAccount, solanaAccountSnapshot, () => null);
}

/** Rhea/Burrow supplied USDC for a NEAR account (same read as the Rhea Withdraw Max helper). */
export function useRheaSupplied(accountId: string | null | undefined): ProtocolBalance {
  const account = accountId?.trim() || null;
  const query = useQuery({
    queryKey: ["vault", "rhea-supplied", account],
    enabled: !!account,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const response = await fetch(
        `/api/earn/rhea/live?accountId=${encodeURIComponent(account ?? "")}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Rhea balance unavailable");
      const body = (await response.json().catch(() => ({}))) as RheaBalanceResponse;
      if (body.ok !== true) throw new Error("Rhea balance unavailable");
      return typeof body.suppliedUsdc === "string" ? body.suppliedUsdc : null;
    },
  });

  return {
    account,
    amount: query.data ?? null,
    symbol: "USDC",
    loading: !!account && query.isLoading,
    error: !!account && query.isError,
  };
}

export interface KaminoPosition {
  readonly vaultAddress: string;
  readonly estimatedTokens: string | null;
  readonly assetSymbol: string | null;
}

interface KaminoPositionsResponse {
  positions?: unknown;
}

function parseKaminoPositions(raw: unknown): KaminoPosition[] {
  if (!Array.isArray(raw)) return [];
  const out: KaminoPosition[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    if (typeof value.vaultAddress !== "string") continue;
    out.push({
      vaultAddress: value.vaultAddress,
      estimatedTokens: typeof value.estimatedTokens === "string" ? value.estimatedTokens : null,
      assetSymbol: typeof value.assetSymbol === "string" ? value.assetSymbol : null,
    });
  }
  return out;
}

export interface KaminoPositionsView {
  readonly account: string | null;
  readonly positions: KaminoPosition[];
  readonly loading: boolean;
  readonly error: boolean;
}

/** Kamino positions for a Solana wallet, from the same read-only endpoint the live flow uses. */
export function useKaminoPositions(wallet: string | null | undefined): KaminoPositionsView {
  const account = wallet?.trim() || null;
  const query = useQuery({
    queryKey: ["vault", "kamino-positions", account],
    enabled: !!account,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const response = await fetch(
        `/api/earn/kamino/positions?wallet=${encodeURIComponent(account ?? "")}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Kamino positions unavailable");
      const body = (await response.json().catch(() => ({}))) as KaminoPositionsResponse;
      return parseKaminoPositions(body.positions);
    },
  });

  return {
    account,
    positions: query.data ?? [],
    loading: !!account && query.isLoading,
    error: !!account && query.isError,
  };
}
