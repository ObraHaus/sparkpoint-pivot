"use client";

/**
 * useSessionExecute (US6, feature 022) — run an approved, in-scope move with NO per-move wallet
 * signature, using the client-held session key.
 *
 * Flow (all from one explicit click — Gate C: no autonomy): eligibility gate (coverage) → unlock the
 * on-device key once per browser session (a wallet signature over a fixed NON-transactional message,
 * NOT a tx) → decrypt the session key → `build-tx` with `execMode=session_key` (server emits the
 * unsigned v0.7 userOp, still policy-gated + recipient-pinned) → sign it with the session key (mode
 * 0x01) → relay via `submit-signed-tx opType=userop` (the agent byte-matches SC-005 then bundles it) →
 * poll the userOp receipt. The service never holds the key (N3); the on-chain PolicyModule re-enforces
 * every bound; a bundler reject is surfaced verbatim; N2 — a transient degrade is retried, never a gate.
 */

import { useCallback, useRef, useState } from "react";
import { useSignMessage } from "wagmi";
import type { Hex } from "viem";

import type { ProposedAction } from "@sparkpoint/shared/schemas";
import { useBuildTx } from "@/lib/execution/useBuildTx";

import { isEligibleForAutoExec } from "./coverage";
import { signSessionUserOp } from "./sessionSigner";
import {
  cacheUnlockKey,
  deriveUnlockKey,
  getCachedUnlockKey,
  getSessionKey,
  unlockMessage,
  type KeyScope,
} from "./sessionKeyStore";
import { pollUntilTerminal, submitWithRetry, type TerminalStatus } from "./sessionExecuteModel";
import { useSessionKeys } from "./useSessionKey";

export type ExecStage =
  | "idle"
  | "unlocking"
  | "building"
  | "signing"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed"
  | "error";

export interface SessionExecuteController {
  stage: ExecStage;
  userOpHash: string | undefined;
  txHash: string | undefined;
  error: string | undefined;
  isBusy: boolean;
  isDone: boolean;
  /** True when the failure is "no key on this device" — the caller should offer per-action signing. */
  needsPerAction: boolean;
  start: (action: ProposedAction) => void;
  reset: () => void;
}

const SUBMIT_POLICY = { maxAttempts: 3, backoffMs: 1500 };
const POLL_POLICY = { maxPolls: 20, intervalMs: 3000 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function shortError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | null;
  const msg = e?.shortMessage ?? e?.message ?? "Something went wrong.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

export function useSessionExecute(): SessionExecuteController {
  const { active, account } = useSessionKeys();
  const { build } = useBuildTx();
  const { signMessageAsync } = useSignMessage();

  const [stage, setStage] = useState<ExecStage>("idle");
  const [userOpHash, setUserOpHash] = useState<string>();
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();
  const [needsPerAction, setNeedsPerAction] = useState(false);
  const runningRef = useRef(false);

  const fail = useCallback((message: string, perAction = false) => {
    setError(message);
    setNeedsPerAction(perAction);
    setStage("error");
  }, []);

  const start = useCallback(
    (action: ProposedAction) => {
      if (runningRef.current) return;
      const grant = active;
      if (!grant || !account) {
        fail("No active automation grant.");
        return;
      }
      const eligible = isEligibleForAutoExec(action, grant, Date.now());
      if (!eligible.ok) {
        fail(eligible.reason ?? "This move isn't covered by your automation.");
        return;
      }

      runningRef.current = true;
      setError(undefined);
      setNeedsPerAction(false);
      setUserOpHash(undefined);
      setTxHash(undefined);

      void (async () => {
        try {
          // 1. Build FIRST so we learn the exact chainId + sender the op is for (nonce read at build).
          setStage("building");
          const bundle = await build(action, "session_key");
          if (!bundle) {
            fail("The move couldn't be built (it may no longer be in scope).");
            return;
          }
          if (!bundle.userOp) {
            fail("The automated move couldn't be prepared right now — try again shortly.");
            return;
          }
          const chain = bundle.steps[0]?.chainId ?? 0;
          const smartAccount = bundle.userOp.sender;
          const scope: KeyScope = { chainId: chain, account: smartAccount, sessionAddress: grant.sessionKey };

          // 2. Unlock the on-device key (once per browser session): a wallet signature over a fixed,
          //    non-transactional message → derive the AES-GCM wrapping key. NOT a per-move signature.
          setStage("unlocking");
          let unlockKey = getCachedUnlockKey(smartAccount, chain);
          if (!unlockKey) {
            let signature: Hex;
            try {
              signature = await signMessageAsync({ message: unlockMessage(smartAccount, chain) });
            } catch {
              fail("Unlock cancelled — nothing was signed or sent.");
              return;
            }
            unlockKey = await deriveUnlockKey(signature);
            cacheUnlockKey(smartAccount, chain, unlockKey);
          }

          // 3. Decrypt the session key. Absent ⇒ the key isn't on THIS device (grant made elsewhere).
          const privateKey = await getSessionKey(scope, unlockKey);
          if (!privateKey) {
            fail(
              "Your automation key isn't on this device — sign this move manually, or re-authorize automation here.",
              true,
            );
            return;
          }

          // 4. Sign the built userOp with the SESSION key (no wallet prompt) — mode-0x01, EIP-191.
          setStage("signing");
          const { signedUserOp } = await signSessionUserOp(bundle.userOp, { chainId: chain, privateKey });

          // 5. Relay via the bundler (opType=userop). This submit IS the submission — its response is
          //    authoritative. Raw fetch: the typed AgentClient refuses any signed body.
          setStage("submitting");
          const submit = await submitWithRetry(
            {
              newKey: () => crypto.randomUUID(),
              sleep,
              post: async (idempotencyKey) => {
                try {
                  const res = await fetch("/api/agent/submit-signed-tx", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      "x-chain-id": String(chain),
                      "idempotency-key": idempotencyKey,
                    },
                    body: JSON.stringify({
                      intentId: bundle.id,
                      signed: { opType: "userop", userOp: signedUserOp },
                    }),
                  });
                  let body: Record<string, unknown> = {};
                  try {
                    body = (await res.json()) as Record<string, unknown>;
                  } catch {
                    /* empty/non-json body — status still drives the outcome */
                  }
                  const submission = body.submission as { userOpHash?: string } | undefined;
                  const err = body.error as { message?: string } | undefined;
                  return { status: res.status, userOpHash: submission?.userOpHash, message: err?.message };
                } catch {
                  return { status: 0 }; // network error — retryable? no (status 0), surfaced honestly
                }
              },
            },
            SUBMIT_POLICY,
          );

          if (!submit.ok) {
            fail(submit.message ?? "The bundler couldn't accept the move — nothing was recorded.");
            return;
          }
          setUserOpHash(submit.userOpHash);
          setStage("pending");

          // 6. Poll the bundler userOp receipt until terminal (or the budget is spent → still pending).
          const terminal: TerminalStatus = await pollUntilTerminal(
            {
              sleep,
              fetchStatus: async () => {
                const res = await fetch(`/api/agent/submit-signed-tx/${bundle.id}`, {
                  headers: { "x-chain-id": String(chain) },
                });
                if (!res.ok) return "pending";
                const body = (await res.json()) as { status?: string; txHash?: string | null };
                if (body.txHash) setTxHash(body.txHash);
                return body.status === "confirmed" || body.status === "failed" ? body.status : "pending";
              },
            },
            POLL_POLICY,
          );
          setStage(terminal === "confirmed" ? "confirmed" : terminal === "failed" ? "failed" : "pending");
        } catch (err) {
          fail(shortError(err));
        } finally {
          runningRef.current = false;
        }
      })();
    },
    [active, account, build, signMessageAsync, fail],
  );

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setStage("idle");
    setUserOpHash(undefined);
    setTxHash(undefined);
    setError(undefined);
    setNeedsPerAction(false);
  }, []);

  return {
    stage,
    userOpHash,
    txHash,
    error,
    isBusy: stage === "unlocking" || stage === "building" || stage === "signing" || stage === "submitting" || stage === "pending",
    isDone: stage === "confirmed",
    needsPerAction,
    start,
    reset,
  };
}
