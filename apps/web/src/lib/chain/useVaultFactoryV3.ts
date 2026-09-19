"use client";

/**
 * 049 v4.1.0 — the V3 admission factory on Robinhood Chain 4663: address resolution + the wallet
 * write path the admin panel uses. Pinned to 4663: no read or write follows the wallet's chain.
 */

import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { sparkPointVaultFactoryV3Abi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS } from "@sparkpoint/shared/chains";
import type { Address } from "viem";
import type { WagmiChainId } from "@/lib/wagmi";

/** The chain the V3 admission factory lives on. Pinned: the panel never follows the wallet. */
export const VAULT_FACTORY_V3_CHAIN = CHAIN_IDS.robinhoodMainnet as WagmiChainId;

export function vaultFactoryV3Address(): Address | undefined {
  return getAddresses(CHAIN_IDS.robinhoodMainnet).sparkPointVaultFactoryV3;
}

export function useVaultFactoryV3() {
  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isMining, data: receipt } = useWaitForTransactionReceipt({ hash });

  return {
    factory: vaultFactoryV3Address(),
    abi: sparkPointVaultFactoryV3Abi,
    chainId: VAULT_FACTORY_V3_CHAIN,
    writeContractAsync,
    state: {
      isSigning: isPending,
      isMining,
      isSuccess: receipt?.status === "success",
      hash,
      error,
    },
    reset,
  };
}
