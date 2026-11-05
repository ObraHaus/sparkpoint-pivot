"use client";

/**
 * 076 — the client side of NEAR-only sign-in.
 *
 * Fetch the server's nonce + canonical message, ask the connected NEAR wallet (Meteor first) to
 * sign the NEP-413 payload, then POST the signature to the server. The server does ALL proving:
 * nonce consumption, message equality, ed25519 verification and the full-access key lookup.
 *
 * This hook never touches the EVM/SIWE session and never builds a transaction.
 */

import { useCallback, useState } from "react";
import { useNearWallet } from "./NearWalletProvider";

export type NearLoginPhase = "idle" | "nonce" | "signing" | "verifying";

export interface NearLoginResult {
  readonly address: string;
  readonly chain: "near";
  readonly beta: boolean;
  readonly admin: boolean;
}

function nonceBytes(nonce: string): Uint8Array {
  const normalized = nonce.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function useNearLogin(): {
  login: () => Promise<NearLoginResult | null>;
  pending: boolean;
  phase: NearLoginPhase;
  error: string | null;
} {
  const { accountId, connect, signMessage } = useNearWallet();
  const [phase, setPhase] = useState<NearLoginPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (): Promise<NearLoginResult | null> => {
    setPhase("nonce");
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/near/nonce", { method: "POST", cache: "no-store" });
      if (!nonceRes.ok) {
        const detail = (await nonceRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? "could not start NEAR sign-in");
      }
      const issued = (await nonceRes.json()) as {
        nonce: string;
        message: string;
        recipient: string;
      };

      if (!accountId) {
        // The user clicked "Sign in with NEAR": connect first (Meteor first), then sign.
        await connect();
      }

      setPhase("signing");
      const signed = await signMessage({
        message: issued.message,
        recipient: issued.recipient,
        nonce: nonceBytes(issued.nonce),
      });

      setPhase("verifying");
      const verifyRes = await fetch("/api/auth/near/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: signed.accountId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          message: issued.message,
          nonce: issued.nonce,
        }),
      });
      if (!verifyRes.ok) {
        const detail = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        setError(detail.error ?? "NEAR verification failed");
        return null;
      }
      const data = (await verifyRes.json()) as NearLoginResult & { ok: boolean };
      return {
        address: data.address,
        chain: "near",
        beta: Boolean(data.beta),
        admin: Boolean(data.admin),
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "NEAR sign-in failed");
      return null;
    } finally {
      setPhase("idle");
    }
  }, [accountId, connect, signMessage]);

  return { login, pending: phase !== "idle", phase, error };
}
