"use client";

/**
 * useExecutePremiumTx — the REAL SRK Premium payment flow (approve → transfer to the treasury).
 *
 * A user-signed, two-leg ERC-20 payment mirroring `useExecuteSwapTx`'s approve→action pattern. The
 * user is the SOLE signer (`writeContractAsync`); SparkPoint holds no key and takes no custody. The
 * terminal leg is a plain `transfer` to the DISCLOSED premium treasury — never a `transferFrom` /
 * standing pull-approval to a SparkPoint contract (SC-007). Each leg waits for its receipt and fails
 * closed on `reverted`. INERT when `exec` is `undefined` (Rules-of-Hooks safe).
 */

import { useCallback, useState } from "react";
import { type Address, erc20Abi, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** A resolved premium-payment intent — built by the pay page from live balance/allowance + the price. */
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
  /** true ⇒ an `approve(treasury, amount)` leg is needed (allowance < amount). */
  readonly needsApprove: boolean;
  /** Called after a confirmed payment, with the payment tx hash (drives the server-side verify). */
  readonly onDone?: (txHash: Hex) => void;
}

export type PremiumExecStage = "idle" | "approve" | "pay" | "done" | "error";

export interface PremiumExecController {
  readonly stage: PremiumExecStage;
  readonly isBusy: boolean;
  readonly isDone: boolean;
  readonly awaitingWallet: boolean;
  readonly approveHash: Hex | undefined;
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
  const [approveHash, setApproveHash] = useState<Hex | undefined>();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const [error, setError] = useState<string | undefined>();

  const start = useCallback(async () => {
    if (!exec || !publicClient) return;
    const e = exec;
    setError(undefined);
    try {
      // ── leg-0: approve the treasury to move the SRK (only when allowance < price) ──
      if (e.needsApprove) {
        setStage("approve");
        setAwaitingWallet(true);
        const approveTx = await writeContractAsync({
          address: e.srk,
          abi: erc20Abi,
          functionName: "approve",
          args: [e.treasury, e.amount],
          chainId: e.chainId as WagmiChainId,
        });
        setAwaitingWallet(false);
        setApproveHash(approveTx);
        const ar = await publicClient.waitForTransactionReceipt({ hash: approveTx });
        if (ar.status === "reverted") {
          setStage("error");
          setError("Approval reverted on-chain — nothing moved.");
          return;
        }
      }

      // ── terminal leg: the payment — a plain transfer to the disclosed treasury ──
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
    isBusy: stage === "approve" || stage === "pay",
    isDone: stage === "done",
    awaitingWallet,
    approveHash,
    txHash,
    error,
    start,
  };
}
