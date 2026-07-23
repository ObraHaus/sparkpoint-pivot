"use client";

/**
 * useAaveSupplyApyBps — the LIVE Aave v3 USDC supply APY (bps) for a chain, read on-chain via
 * `getReserveData(asset).currentLiquidityRate` (RAY→APY in the pure `aaveApy` module). Keyless
 * view read; `null` when unreadable / where Aave isn't in the address book — never fabricated.
 * Mirrors the inline-ABI direct-read pattern already in useVault.ts.
 */

import { useReadContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { supplyApyBpsFromRay } from "@/lib/chain/aaveApy";

// External Aave v3 read ABI (hand-authored, view-only) — getReserveData(asset) → ReserveData.
const aavePoolReserveAbi = [
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

function aaveFor(chainId: number | undefined): { pool?: `0x${string}`; reserve?: `0x${string}` } | undefined {
  if (chainId === undefined) return undefined;
  try {
    const a = getAddresses(chainId);
    return { pool: a.aavePool, reserve: a.reserveUsdc };
  } catch {
    return undefined;
  }
}

/** LIVE Aave USDC supply APY (bps) for `chainId`, or `null` when unreadable — never fabricated. */
export function useAaveSupplyApyBps(chainId: number | undefined): number | null {
  const aave = aaveFor(chainId);
  const read = useReadContract({
    address: aave?.pool,
    abi: aavePoolReserveAbi,
    chainId: chainId as never,
    functionName: "getReserveData",
    args: aave?.reserve ? [aave.reserve] : undefined,
    query: { enabled: aave?.pool !== undefined && aave?.reserve !== undefined, staleTime: 60_000 },
  });
  const rate = (read.data as { currentLiquidityRate?: bigint } | undefined)?.currentLiquidityRate;
  return rate === undefined ? null : supplyApyBpsFromRay(rate);
}
