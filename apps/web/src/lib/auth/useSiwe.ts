"use client";

/**
 * Client hooks for the SIWE session (Phase B auth).
 *
 *   - `useSiweLogin()` → `login(address, chainId)` runs the full handshake: fetch a nonce, build
 *     an EIP-4361 message, ask the wallet to sign it (wagmi), POST to /api/auth/verify. On success
 *     the server has set the httpOnly session cookie; the resolved {address, beta, admin} is returned.
 *   - `useSession()` → the current server session ({address, beta, admin} | null), with `refresh()`.
 *
 * The signature proves wallet control ONLY — it authorizes no transaction. Copy in the message
 * says so, so a user always knows what they're signing.
 */

import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";

export interface Session {
  readonly address: string;
  readonly beta: boolean;
  readonly admin: boolean;
}

const SIWE_STATEMENT =
  "Sign in to SparkPoint. This proves you control this wallet. " +
  "It does not authorize any transaction or move any funds.";

export function useSiweLogin(): {
  login: (address: `0x${string}`, chainId: number) => Promise<Session | null>;
  pending: boolean;
  error: string | null;
} {
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (address: `0x${string}`, chainId: number): Promise<Session | null> => {
      setPending(true);
      setError(null);
      try {
        const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
        if (!nonceRes.ok) throw new Error("could not start sign-in");
        const { nonce } = (await nonceRes.json()) as { nonce: string };

        const now = new Date();
        const message = createSiweMessage({
          domain: window.location.host,
          address,
          statement: SIWE_STATEMENT,
          uri: window.location.origin,
          version: "1",
          chainId,
          nonce,
          issuedAt: now,
          // Bound lifetime — the server requires an expirationTime and rejects an expired message.
          expirationTime: new Date(now.getTime() + 10 * 60 * 1000),
        });

        const signature = await signMessageAsync({ message });

        const verifyRes = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, signature }),
        });
        if (!verifyRes.ok) {
          const detail = (await verifyRes.json().catch(() => ({}))) as { error?: string };
          setError(detail.error ?? "verification failed");
          return null;
        }
        const data = (await verifyRes.json()) as Session & { ok: boolean };
        return { address: data.address, beta: data.beta, admin: data.admin };
      } catch (e) {
        // A user rejecting the signature lands here — surface a friendly reason, no throw.
        setError(e instanceof Error ? e.message : "sign-in failed");
        return null;
      } finally {
        setPending(false);
      }
    },
    [signMessageAsync],
  );

  return { login, pending, error };
}

export function useSession(): {
  session: Session | null | undefined; // undefined = still loading
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await res.json()) as { session: Session | null };
      setSession(data.session ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    // Fetch the server session once on mount (state is set inside refresh's async callback, after
    // the await — not synchronously in the effect body). This is external-system sync, not a
    // derived-state effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { session, refresh };
}
