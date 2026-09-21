"use client";

/**
 * useBrokerRevenue — the read/write surface of the 4663 beta revenue page (W.4).
 *
 * Companion to `useBrokerEngine.ts`: the engine hooks cover the broker verbs, this file covers
 * where the money comes from (the splitter's 90/10 wiring, the settled-round clock) and how a
 * holder takes it out (the BrokerVault's per-broker balances + `withdraw`).
 *
 * ⚠️ Two rules carried over from the engine module, for the same reasons:
 *   1. A read that failed is `undefined`, never zero. A missing balance rendered as "0 ETH" tells a
 *      holder they have nothing; `unread` makes the page say "some balances could not be read".
 *   2. A reverted receipt is NOT a success — the shared `useBrokerTx` is used for `withdraw` too.
 */

import { useCallback, useMemo } from "react";
import { type Address } from "viem";
import { useReadContracts } from "wagmi";
import { brokerEngineAbi, brokerVaultAbi, revenueSplitterAbi } from "@sparkpoint/shared/abis";
import {
  BROKER_ENGINE_CHAIN,
  useBrokerTx,
} from "@/lib/chain/useBrokerEngine";
import {
  holdingsByBroker,
  NATIVE_ASSET,
  nonzeroHoldings,
  type AssetMeta,
  type HoldingRow,
} from "@/lib/chain/revenueBeta";

const ZERO_ASSET = NATIVE_ASSET as Address;

/** The splitter's immutable wiring, read live so the page never quotes a hardcoded split. */
export interface SplitterWiring {
  /** Basis points, as the contract stores them — `9000n` is 90%. */
  readonly holderBps?: bigint;
  readonly treasuryBps?: bigint;
  readonly engine?: Address;
  readonly treasury?: Address;
  readonly isLoading: boolean;
}

export function useSplitterWiring(splitter: Address | undefined): SplitterWiring {
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: splitter
      ? ([
          { address: splitter, abi: revenueSplitterAbi, functionName: "HOLDER_BPS" },
          { address: splitter, abi: revenueSplitterAbi, functionName: "TREASURY_BPS" },
          { address: splitter, abi: revenueSplitterAbi, functionName: "engine" },
          { address: splitter, abi: revenueSplitterAbi, functionName: "treasury" },
        ] as const)
      : [],
    query: { enabled: Boolean(splitter) },
  });

  const value = <T,>(i: number): T | undefined => {
    const r = data?.[i];
    return r?.status === "success" ? (r.result as T) : undefined;
  };

  return {
    holderBps: value<bigint>(0),
    treasuryBps: value<bigint>(1),
    engine: value<Address>(2),
    treasury: value<Address>(3),
    isLoading,
  };
}

/** The engine's clock, read from the engine — nothing here assumes a round length. */
export interface EngineRounds {
  readonly roundSeconds?: bigint;
  readonly settledRound?: bigint;
  readonly currentRound?: bigint;
  readonly isLoading: boolean;
}

export function useEngineRounds(engine: Address | undefined): EngineRounds {
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: engine
      ? ([
          { address: engine, abi: brokerEngineAbi, functionName: "ROUND" },
          { address: engine, abi: brokerEngineAbi, functionName: "settledRound" },
          { address: engine, abi: brokerEngineAbi, functionName: "currentRound" },
        ] as const)
      : [],
    query: { enabled: Boolean(engine) },
  });

  const value = <T,>(i: number): T | undefined => {
    const r = data?.[i];
    return r?.status === "success" ? (r.result as T) : undefined;
  };

  return {
    roundSeconds: value<bigint>(0),
    settledRound: value<bigint>(1),
    currentRound: value<bigint>(2),
    isLoading,
  };
}

/** One asset amount sitting in the engine's pending pot. */
export interface PotRow {
  readonly asset: Address;
  readonly amount: bigint;
}

export interface BrokerPots {
  /**
   * The native ETH row (always, once read) plus every registered ERC-20 with a non-zero pot.
   * ⚠️ Multi-token is the architecture — an ETH-only pot would hide the fee router's ERC-20 leg.
   */
  readonly rows: readonly PotRow[];
  /** Pot reads that failed — the page must not render them as zero. */
  readonly unread: number;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/**
 * Everything waiting to be settled, per asset.
 *
 * Two phases, because the engine knows its asset registry and we do not: `assets()` first, then a
 * `pendingPot(asset)` for native ETH and every registered ERC-20. The native row is kept even at
 * zero so an empty pot reads as "0 ETH" rather than as a missing reading.
 */
export function useBrokerPots(engine: Address | undefined): BrokerPots {
  const assetsRead = useReadContracts({
    allowFailure: true,
    contracts: engine ? ([{ address: engine, abi: brokerEngineAbi, functionName: "assets" }] as const) : [],
    query: { enabled: Boolean(engine) },
  });

  const assets = useMemo<readonly Address[] | undefined>(() => {
    const r = assetsRead.data?.[0];
    return r?.status === "success" ? (r.result as readonly Address[]) : undefined;
  }, [assetsRead.data]);

  const potAssets = useMemo<readonly Address[]>(
    () => [ZERO_ASSET, ...(assets ?? [])],
    [assets],
  );

  const potsRead = useReadContracts({
    allowFailure: true,
    contracts: engine
      ? potAssets.map(
          (asset) =>
            ({
              address: engine,
              abi: brokerEngineAbi,
              functionName: "pendingPot" as const,
              args: [asset],
            }) as const,
        )
      : [],
    query: { enabled: Boolean(engine) },
  });

  const { rows, unread } = useMemo(() => {
    const out: PotRow[] = [];
    let failed = 0;
    potAssets.forEach((asset, i) => {
      const r = potsRead.data?.[i];
      if (r === undefined) return; // still loading
      if (r.status !== "success") {
        failed += 1;
        return;
      }
      const amount = r.result as bigint;
      if (asset.toLowerCase() === NATIVE_ASSET || amount > 0n) out.push({ asset, amount });
    });
    // A failed `assets()` read means the ERC-20 legs could not even be enumerated — say so.
    if (assetsRead.data !== undefined && assetsRead.data[0]?.status !== "success") failed += 1;
    return { rows: out, unread: failed };
  }, [potAssets, potsRead.data, assetsRead.data]);

  return {
    rows,
    unread,
    isLoading: assetsRead.isLoading || potsRead.isLoading,
    refetch: () => {
      void assetsRead.refetch();
      void potsRead.refetch();
    },
  };
}

/** Minimal ERC-20 metadata reads — the token names its own units. */
const erc20MetaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export interface AssetMetaMap {
  /** Keyed by lowercased asset address; an absent key means the metadata could not be read. */
  readonly byAsset: ReadonlyMap<string, AssetMeta>;
  readonly isLoading: boolean;
}

/**
 * Symbol + decimals for each ERC-20, read from the token itself (batched). Native ETH is implicit
 * and never queried. A token whose reads fail is simply absent — the caller falls back to raw base
 * units + the address rather than guessing a shift.
 */
export function useAssetMeta(assets: readonly Address[]): AssetMetaMap {
  const erc20s = useMemo(() => {
    const seen = new Set<string>();
    const out: Address[] = [];
    for (const asset of assets) {
      const key = asset.toLowerCase();
      if (key === NATIVE_ASSET || seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
    }
    return out;
  }, [assets]);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: erc20s.flatMap((asset) => [
      { address: asset, abi: erc20MetaAbi, functionName: "symbol" as const },
      { address: asset, abi: erc20MetaAbi, functionName: "decimals" as const },
    ]),
    query: { enabled: erc20s.length > 0 },
  });

  const byAsset = useMemo(() => {
    const out = new Map<string, AssetMeta>();
    erc20s.forEach((asset, i) => {
      const symbol = reads.data?.[i * 2];
      const decimals = reads.data?.[i * 2 + 1];
      if (symbol?.status !== "success" || decimals?.status !== "success") return;
      if (typeof symbol.result !== "string" || typeof decimals.result !== "number") return;
      out.set(asset.toLowerCase(), { symbol: symbol.result, decimals: decimals.result });
    });
    return out;
  }, [erc20s, reads.data]);

  return { byAsset, isLoading: reads.isLoading };
}

export interface VaultHoldings {
  /** One row per non-zero asset amount a listed broker holds. */
  readonly rows: readonly HoldingRow[];
  /** The rows grouped by broker id, for the per-broker withdraw rows. */
  readonly byBroker: ReadonlyMap<bigint, HoldingRow[]>;
  /** Balance reads that failed — the page must say so rather than render them as 0. */
  readonly unread: number;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/**
 * What each listed broker holds in the vault.
 *
 * Two phases, because the vault knows the asset list and we do not: `assetsOf(id)` first, then a
 * `balanceOf(id, asset)` for every pair. ⚠️ The vault's per-token asset bitmap never clears on a
 * withdrawal, so `assetsOf` keeps naming assets at a zero balance — those are dropped by
 * `nonzeroHoldings` rather than rendered as empty positions.
 */
export function useBrokerVaultHoldings(
  ids: readonly bigint[],
  vault: Address | undefined,
): VaultHoldings {
  const assetsRead = useReadContracts({
    allowFailure: true,
    contracts:
      vault && ids.length > 0
        ? ids.map(
            (id) =>
              ({
                address: vault,
                abi: brokerVaultAbi,
                functionName: "assetsOf" as const,
                args: [id],
              }) as const,
          )
        : [],
    query: { enabled: Boolean(vault) && ids.length > 0 },
  });

  const pairs = useMemo(() => {
    const out: { id: bigint; asset: Address }[] = [];
    ids.forEach((id, i) => {
      const r = assetsRead.data?.[i];
      if (r?.status !== "success") return;
      for (const asset of r.result as readonly Address[]) out.push({ id, asset });
    });
    return out;
  }, [ids, assetsRead.data]);

  const balancesRead = useReadContracts({
    allowFailure: true,
    contracts:
      vault && pairs.length > 0
        ? pairs.map(
            (p) =>
              ({
                address: vault,
                abi: brokerVaultAbi,
                functionName: "balanceOf" as const,
                args: [p.id, p.asset],
              }) as const,
          )
        : [],
    query: { enabled: Boolean(vault) && pairs.length > 0 },
  });

  const { rows, unread } = useMemo(() => {
    const loaded: HoldingRow[] = [];
    let failed = 0;
    pairs.forEach((p, i) => {
      const r = balancesRead.data?.[i];
      if (r?.status !== "success") {
        failed += 1;
        return;
      }
      loaded.push({ tokenId: p.id, asset: p.asset, amount: r.result as bigint });
    });
    return { rows: nonzeroHoldings(loaded), unread: failed };
  }, [pairs, balancesRead.data]);

  const byBroker = useMemo(() => holdingsByBroker(rows), [rows]);

  return {
    rows,
    byBroker,
    unread,
    isLoading: assetsRead.isLoading || balancesRead.isLoading,
    refetch: () => {
      void assetsRead.refetch();
      void balancesRead.refetch();
    },
  };
}

/**
 * Withdraw everything a broker holds. Callable only by the broker's current owner — the vault
 * checks `ownerOf` itself, so there is no address to pass and nothing to get wrong here.
 */
export function useBrokerWithdraw(vault: Address | undefined) {
  const { writeContract, state } = useBrokerTx();

  const withdraw = useCallback(
    (tokenId: bigint, assets: readonly Address[]) => {
      if (!vault) return;
      writeContract({
        address: vault,
        abi: brokerVaultAbi,
        functionName: "withdraw",
        args: [tokenId, assets],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [vault, writeContract],
  );

  return { withdraw, ...state };
}
