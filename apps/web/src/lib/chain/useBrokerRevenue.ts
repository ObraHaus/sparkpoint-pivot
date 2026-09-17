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
import { holdingsByBroker, nonzeroHoldings, type HoldingRow } from "@/lib/chain/revenueBeta";

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
