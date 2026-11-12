"use client";

/**
 * 053 — the wrapper positions a connected wallet actually holds, read DIRECTLY over RPC.
 *
 * The wrapper fleet is dynamic: instances are deployed on demand and served by the curated board
 * (049/050), so a static address-book list can never be the source (that was the beta bug — the
 * portfolio read `sparkPointWrappers`, which is undefined on 4663, and showed nothing).
 *
 * Two-phase batched reads, no per-wrapper hook calls:
 *   1. `balanceOf(account)` for every board wrapper on this chain — one multicall;
 *   2. for the wrappers that returned a non-zero balance: `convertToAssets(shares)`, `asset()` and
 *      the share `decimals()` — a second multicall.
 *
 * Values are only ever read, never derived from a hint: an unreadable field stays `undefined` and
 * the derivation treats it as unknown (never 0-by-default for a position we know is held).
 *
 * Custody note: read-only, keyless, direct RPC. No agent, no indexer, nothing signable.
 */

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useCuratedBoard } from "@/lib/curation/useCuratedBoard";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { wagmiConfig } from "@/lib/wagmi";
import type { WrapperPositionInput } from "./derive";

/** Chain ids wagmi has a configured transport for (matches useVault's / useConfirmPreview's typing). */
type ReadChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** The ERC-4626 reads a position needs beyond ERC-20 shares. */
const ERC4626_ABI = [
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** One board wrapper on the chain being read. */
interface BoardWrapper {
  readonly address: Address;
  readonly label: string;
  readonly assetAddress?: Address;
  readonly assetDecimals: number;
}

export interface HeldWrappersResult {
  /** Positions with a non-zero share balance — the only ones a portfolio should render. */
  readonly positions: WrapperPositionInput[];
  /** True while a read this wallet needs is still in flight (drives the honest "reading…" state). */
  readonly isLoading: boolean;
  /** A read failed; the portfolio still renders wallet balances and says so. */
  readonly isError: boolean;
}

export function useHeldWrappers({
  chainId,
  account,
}: {
  chainId: number | undefined;
  account: `0x${string}` | undefined;
}): HeldWrappersResult {
  const board = useCuratedBoard();

  // The board's wrappers for THIS chain, de-duplicated. A row without a wrapper address is not a
  // wrapper (the board stores candidates too), and a wrapper from another chain must never be read
  // against this one.
  const entries = useMemo<BoardWrapper[]>(() => {
    const seen = new Set<string>();
    const out: BoardWrapper[] = [];
    for (const v of board.board?.vaults ?? []) {
      if (!v.wrapped || !v.wrapperAddress) continue;
      if (chainId !== undefined && v.chainId !== chainId) continue;
      const key = v.wrapperAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        address: v.wrapperAddress as Address,
        label: v.label,
        assetAddress: (v.asset?.address as Address | undefined) ?? undefined,
        assetDecimals: v.asset?.decimals ?? 6,
      });
    }
    return out;
  }, [board.board, chainId]);

  const enabled = !!account && entries.length > 0;

  // Phase 1 — who holds what.
  const sharesQ = useReadContracts({
    query: { enabled },
    contracts: entries.map((e) => ({
      address: e.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account as Address],
    })),
  });

  const holders = useMemo(() => {
    const out: { entry: BoardWrapper; shares: bigint }[] = [];
    entries.forEach((entry, i) => {
      const shares = sharesQ.data?.[i]?.result as bigint | undefined;
      if (shares !== undefined && shares > 0n) out.push({ entry, shares });
    });
    return out;
  }, [entries, sharesQ.data]);

  // Phase 2 — what those shares are worth, in the wrapper's own asset terms.
  const detailQ = useReadContracts({
    query: { enabled: enabled && holders.length > 0 },
    contracts: holders.flatMap((h) => [
      { address: h.entry.address, abi: ERC4626_ABI, functionName: "convertToAssets", args: [h.shares] },
      { address: h.entry.address, abi: ERC4626_ABI, functionName: "asset" },
      { address: h.entry.address, abi: erc20Abi, functionName: "decimals" },
    ]),
  });

  const positions = useMemo<WrapperPositionInput[]>(() => {
    // The chain's stable address decides whether a wrapper's asset is USD-priced (par-eligible).
    let stable: string | undefined;
    try {
      stable = chainId === undefined ? undefined : getAddresses(chainId).usdc.toLowerCase();
    } catch {
      stable = undefined;
    }
    return holders.map((h, i) => {
      const base = i * 3;
      const underlying = detailQ.data?.[base]?.result as bigint | undefined;
      const assetAddr = detailQ.data?.[base + 1]?.result as Address | undefined;
      const shareDecimals = detailQ.data?.[base + 2]?.result as number | undefined;
      return {
        vaultAddress: h.entry.address,
        label: h.entry.label,
        underlying,
        shares: h.shares,
        decimals: h.entry.assetDecimals,
        shareDecimals,
        // Unknown asset address ⇒ not provably the chain stable ⇒ NOT folded into the USD total.
        usdPriced: !!assetAddr && !!stable && assetAddr.toLowerCase() === stable,
      };
    });
  }, [holders, detailQ.data, chainId]);

  const isLoading = enabled && (sharesQ.isLoading || (holders.length > 0 && detailQ.isLoading));

  return { positions, isLoading, isError: sharesQ.isError || detailQ.isError };
}


/**
 * 053 — one wallet's holding in ONE curated wrapper, for a card that already knows its address
 * (the vault board). Two direct-RPC reads: `balanceOf` then `convertToAssets` for holders only.
 *
 * `valueUsd` assumes the wrapper's asset is USD-priced (the curated board is stablecoin vaults, and
 * the deposit rail already requires the chain stable) — callers show it only when readable, and the
 * share count alone is enough to offer Withdraw.
 */
export interface WrapperHolding {
  readonly shares: bigint | undefined;
  /** The position converted to the vault's asset (ERC-4626 `convertToAssets`), raw units. */
  readonly underlying: bigint | undefined;
  readonly valueUsd: number | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export function useWrapperHolding({
  chainId,
  account,
  wrapper,
  assetDecimals = 6,
}: {
  chainId: number | undefined;
  account: `0x${string}` | undefined;
  wrapper: `0x${string}` | undefined;
  assetDecimals?: number;
}): WrapperHolding {
  const enabled = !!account && !!wrapper && chainId !== undefined;
  const sharesRead = useReadContract({
    address: wrapper,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account as Address],
    chainId: chainId as ReadChainId | undefined,
    query: { enabled },
  });
  const shares = sharesRead.data as bigint | undefined;
  const assetsRead = useReadContract({
    address: wrapper,
    abi: ERC4626_ABI,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    chainId: chainId as ReadChainId | undefined,
    query: { enabled: enabled && shares !== undefined && shares > 0n },
  });
  // A successful `balanceOf` of 0 is a genuine zero, not "not read yet" — only then may the card
  // show 0. When shares are held, the value stays unknown until `convertToAssets` succeeds.
  const underlying = shares === 0n ? 0n : (assetsRead.data as bigint | undefined);
  return {
    shares,
    underlying,
    valueUsd: underlying === undefined ? undefined : Number(formatUnits(underlying, assetDecimals)),
    isLoading:
      enabled && (sharesRead.isLoading || (shares !== undefined && shares > 0n && assetsRead.isLoading)),
    isError: sharesRead.isError || assetsRead.isError,
  };
}
