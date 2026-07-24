"use client";

/**
 * useExecutionSign (feature 019 US2) — the single wallet signature over a server IntentBundle.
 *
 * Signs the bundle's `steps[0]` calldata VERBATIM via wagmi `useSendTransaction` (`{to,data,value}` —
 * NO re-encode, so the /submit-signed-tx byte-match holds, SC-005), confirms on the connected
 * transport's own client (`waitForTransactionReceipt` — direct RPC, never the agent; N2 independence),
 * and fires a BEST-EFFORT relay to `POST /submit-signed-tx` so the agent can record the execution +
 * correlate the outcome. The relay is a raw fetch because the typed `AgentClient` refuses a body with
 * a `signed` field; it never blocks the user, and the direct receipt is the source of truth.
 *
 * The service holds no key and signs nothing — the user is the sole signer (N1/N3).
 */

import { useCallback, useState } from "react";
import { usePublicClient, useSendTransaction } from "wagmi";
import type { Hex } from "viem";

import { wagmiConfig } from "@/lib/wagmi";
import type { IntentBundle } from "@sparkpoint/shared/schemas";
import { stepToTx } from "./executionModel";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

export type SignStage = "idle" | "signing" | "confirming" | "done" | "error";

export interface SignController {
  stage: SignStage;
  txHash: Hex | undefined;
  error: string | undefined;
  isBusy: boolean;
  isDone: boolean;
  start: () => void;
}

function shortError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | null;
  const msg = e?.shortMessage ?? e?.message ?? "Transaction failed.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

/** Best-effort relay for outcome correlation (§3.6). Never throws into the sign flow. */
async function relaySubmit(intentId: string, txHash: Hex, chainId: number): Promise<void> {
  try {
    await fetch("/api/agent/submit-signed-tx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chain-id": String(chainId),
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ intentId, signed: { opType: "eoa_call", txHash } }),
    });
  } catch {
    // best-effort: the direct receipt is the source of truth (N2 independence)
  }
}

export function useExecutionSign(bundle: IntentBundle | null): SignController {
  const [stage, setStage] = useState<SignStage>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [error, setError] = useState<string>();

  const chainId = bundle?.steps[0]?.chainId as WagmiChainId | undefined;
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId });

  const start = useCallback(() => {
    const b = bundle;
    const step = b?.steps[0];
    if (!b || !step || !publicClient || chainId === undefined) return;
    setError(undefined);
    setTxHash(undefined);
    void (async () => {
      try {
        setStage("signing");
        const tx = stepToTx(step);
        // Sign the SERVER calldata verbatim — the byte-match (SC-005). The service never signs (N3).
        const hash = await sendTransactionAsync({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          chainId,
        });
        setTxHash(hash);
        void relaySubmit(b.id, hash, chainId); // best-effort correlation; does not block
        setStage("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          setStage("error");
          setError("Transaction reverted on-chain — nothing moved.");
          return;
        }
        setStage("done");
      } catch (err) {
        setStage("error");
        setError(shortError(err));
      }
    })();
  }, [bundle, publicClient, sendTransactionAsync, chainId]);

  return {
    stage,
    txHash,
    error,
    isBusy: stage === "signing" || stage === "confirming",
    isDone: stage === "done",
    start,
  };
}
