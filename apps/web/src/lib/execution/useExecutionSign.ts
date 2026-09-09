"use client";

/**
 * useExecutionSign (feature 019 US2) — the single wallet signature over a server IntentBundle.
 *
 * Signs the bundle's `steps[0]` calldata VERBATIM via wagmi `useSendTransaction` (`{to,data,value}` —
 * NO re-encode, so the /submit-signed-tx byte-match holds, SC-005), confirms on the connected
 * transport's own client (`waitForTransactionReceipt` — direct RPC, never the agent; N2 independence),
 * and — ONLY after the receipt confirms (the tx is now retrievable on-chain, matching the #91
 * verify-before-record) — fires a BEST-EFFORT relay to `POST /submit-signed-tx` so the agent can
 * record the execution + correlate the outcome. The relay retries a `409 DATA_STALE` (the agent's RPC
 * hasn't seen the tx yet) with a bounded backoff so a briefly-lagging real tx still correlates without
 * user action. It's a raw fetch (the typed `AgentClient` refuses a body with a `signed` field), never
 * blocks the user, and never relays a reverted tx — the direct receipt is the source of truth.
 *
 * The service holds no key and signs nothing — the user is the sole signer (N1/N3).
 */

import { useCallback, useState } from "react";
import { usePublicClient, useSendTransaction } from "wagmi";
import type { Hex } from "viem";

import { wagmiConfig } from "@/lib/wagmi";
import type { IntentBundle } from "@sparkpoint/shared/schemas";
import { relayWithRetry, stepToTx } from "./executionModel";

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

/** Bounded retry so a briefly-lagging real tx self-correlates; each `post` also absorbs the agent's
 * own ~3s internal wait (`_await_relayed_tx`) before it degrades to a retryable 409. */
const RELAY_POLICY = { maxAttempts: 3, backoffMs: 1500 };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort relay for outcome correlation (§3.6). Retries a `409 DATA_STALE` (tx not yet visible to
 * the agent's RPC) with a bounded backoff, using ONE stable idempotency key across the retries. Never
 * throws into the sign flow — the direct receipt is the source of truth (N2 independence).
 */
async function relaySubmit(intentId: string, txHash: Hex, chainId: number): Promise<void> {
  await relayWithRetry(
    {
      newKey: () => crypto.randomUUID(),
      sleep,
      post: async (idempotencyKey) => {
        try {
          const res = await fetch("/api/agent/submit-signed-tx", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-chain-id": String(chainId),
              "idempotency-key": idempotencyKey,
            },
            body: JSON.stringify({ intentId, signed: { opType: "eoa_call", txHash } }),
          });
          return res.status;
        } catch {
          return 0; // network error — best-effort; the direct receipt is the source of truth (N2)
        }
      },
    },
    RELAY_POLICY,
  );
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
        setStage("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          setStage("error");
          setError("Transaction reverted on-chain — nothing moved.");
          return;
        }
        setStage("done");
        // Relay ONLY after the receipt confirms — the tx is now retrievable on-chain, so the agent
        // can verify + record it (§3.6/#91), and a reverted tx is never recorded as an execution.
        // Best-effort with a bounded retry-on-409; fire-and-forget, never blocks the done state. The
        // `.catch` is belt-and-suspenders: relaySubmit already swallows all errors (N2), so this can't
        // fire — it just guarantees the "never throws into the sign flow" contract can never regress.
        void relaySubmit(b.id, hash, chainId).catch(() => {});
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
