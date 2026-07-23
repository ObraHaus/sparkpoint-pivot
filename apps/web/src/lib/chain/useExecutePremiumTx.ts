"use client";

/**
 * useExecutePremiumTx — the REAL SRK Premium payment flow: a SINGLE plain `transfer` to the
 * disclosed treasury.
 *
 * A `transfer` moves the caller's OWN balance directly, so it needs **no allowance** — there is
 * deliberately **no approve leg**. That keeps the strongest non-custody stance (SC-007): the user is
 * the sole signer, SparkPoint holds no key, and the flow leaves **no standing pull-approval** to the
 * treasury or any contract (an `approve` before a self-`transfer` would be useless AND would grant
 * the treasury a dangling `transferFrom` allowance). The recipient is the DISCLOSED fee-treasury
 * Safe; the leg waits for its receipt and fails closed on `reverted`. INERT when `exec` is
 * `undefined` (Rules-of-Hooks safe).
 */

import { useCallback, useState } from "react";
import { type Address, erc20Abi, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** A resolved premium-payment intent — built by the pay page from live balance + the price. */
export interface PremiumPayExec {
  readonly chainId: number;
  /** The SRK token address on this chain. */
  readonly srk: Address;
  /** The disclosed payment recipient (the fee-treasury Safe). */
  readonly treasury: Address;
  /** The payer == the connecting account (non-custody; the transfer is FROM this account). */
  readonly account: Address;
  /** The price in SRK base units. */
  readonly amount: bigint;
  /** Called after a confirmed payment, with the payment tx hash (drives the server-side verify). */
  readonly onDone?: (txHash: Hex) => void;
}

export type PremiumExecStage = "idle" | "pay" | "done" | "error";

export interface PremiumExecController {
  readonly stage: PremiumExecStage;
  readonly isBusy: boolean;
  readonly isDone: boolean;
  readonly awaitingWallet: boolean;
  readonly txHash: Hex | undefined;
  readonly error: string | undefined;
  readonly start: () => Promise<void>;
}

function shortenWalletError(msg: string): string {
  if (/user rejected|denied|rejected the request/i.test(msg)) return "You cancelled the signature.";
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
}

export function useExecutePremiumTx(exec: PremiumPayExec | undefined): PremiumExecController {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [stage, setStage] = useState<PremiumExecStage>("idle");
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [error, setError] = useState<string | undefined>();

  const start = useCallback(async () => {
    if (!exec || !publicClient) return;
    const e = exec;
    setError(undefined);
    try {
      // Single leg: a plain `transfer` of the caller's own SRK to the disclosed treasury. No
      // approve — a self-transfer needs no allowance, and skipping it leaves NO standing approval.
      setStage("pay");
      setAwaitingWallet(true);
      const tx = await writeContractAsync({
        address: e.srk,
        abi: erc20Abi,
        functionName: "transfer",
        args: [e.treasury, e.amount],
        chainId: e.chainId as WagmiChainId,
      });
      setAwaitingWallet(false);
      setTxHash(tx);
      const r = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (r.status === "reverted") {
        setStage("error");
        setError("Payment reverted on-chain — nothing moved.");
        return;
      }
      setStage("done");
      e.onDone?.(tx);
    } catch (err) {
      setAwaitingWallet(false);
      setStage("error");
      setError(err instanceof Error ? shortenWalletError(err.message) : "Payment failed.");
    }
  }, [exec, publicClient, writeContractAsync]);

  return {
    stage,
    isBusy: stage === "pay",
    isDone: stage === "done",
    awaitingWallet,
    txHash,
    error,
    start,
  };
}
