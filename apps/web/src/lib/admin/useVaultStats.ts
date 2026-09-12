"use client";

/**
 * LIVE on-chain vault stats for the admin money-view — the honest replacement for the old
 * hardcoded TVL/cap numbers. Reads the deployed Base-Sepolia `SparkPointVault` directly
 * (same pattern as the Kill-switch page), so the money-view reflects the real chain and can never
 * present a fabricated TVL or safety state. Shared by TVL / Overview / Stakeholder.
 */

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import type { WagmiChainId } from "@/lib/wagmi";
import { capUtilizationPct } from "./vaultStats";

/** The vault lives on Base Sepolia (84532); read there regardless of the connected chain. */
export const VAULT_CHAIN = VAULT_CHAIN_ID as WagmiChainId;

export interface VaultStats {
  /** The deployed vault address, or undefined if this build has no vault configured. */
  vault?: Address;
  /** Whether a vault address is configured AND its chain is registered in this build (drives the
   * honest "not configured / not on this network" state). False on the mainnet-beta (vault is Base-only). */
  configured: boolean;
  /** Whether the vault's chain is registered in THIS build's wagmi config (false on the mainnet-beta). */
  available: boolean;
  /** Reads still in flight. */
  loading: boolean;
  /** `totalAssets()` — assets under management, in USDC base units. */
  tvl?: bigint;
  /** `depositCap()` — the vault-level deposit cap, in USDC base units (0n ⇒ no cap set). */
  cap?: bigint;
  /** cap − tvl (never negative), in USDC base units. */
  headroom?: bigint;
  /** TVL / cap × 100, or null when the cap is unset/unknown. */
  capUtilPct: number | null;
  /** `paused()` — the live pause (kill-switch) state; undefined while reading. */
  paused?: boolean;
  /** `guardian()` — the on-chain guardian (timelock) address. */
  guardian?: string;
}

/** Read the live vault stats. Refetches every 30s, like the Kill-switch page. */
export function useVaultStats(): VaultStats {
  const vault = getAddresses(VAULT_CHAIN).vault as Address | undefined;
  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;
  const reads = useReadContracts({
    // Gate on the vault CHAIN being registered in this build, not just the address existing: on the
    // mainnet-beta (only 4663 registered) a read scoped to Base Sepolia (84532) would throw
    // ChainNotConfiguredError. Disabled ⇒ the panel shows a clean "not configured" state, no error.
    query: { enabled: !!vault && VAULT_CHAIN_AVAILABLE, refetchInterval: 30_000 },
    contracts: [
      { ...vaultC, functionName: "totalAssets" }, // 0
      { ...vaultC, functionName: "depositCap" }, // 1
      { ...vaultC, functionName: "paused" }, // 2
      { ...vaultC, functionName: "guardian" }, // 3
    ],
  });
  const tvl = reads.data?.[0]?.result as bigint | undefined;
  const cap = reads.data?.[1]?.result as bigint | undefined;
  const paused = reads.data?.[2]?.result as boolean | undefined;
  const guardian = reads.data?.[3]?.result as string | undefined;
  const headroom = tvl !== undefined && cap !== undefined ? (cap > tvl ? cap - tvl : 0n) : undefined;
  return {
    vault,
    configured: !!vault && VAULT_CHAIN_AVAILABLE,
    available: VAULT_CHAIN_AVAILABLE,
    loading: reads.isLoading,
    tvl,
    cap,
    headroom,
    capUtilPct: capUtilizationPct(tvl, cap),
    paused,
    guardian,
  };
}
