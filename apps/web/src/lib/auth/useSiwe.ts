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

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { isSessionWalletStale } from "@/lib/auth/session-binding";

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

  // Feature 006: pause the force-refresh while a sign-in signature is in flight (BUSY — no funds move,
  // but don't interrupt the wallet signature). Held in the hook so every caller inherits it.
  useHoldCriticalOp(pending, "busy");

  return { login, pending, error };
}

// A single wallet switch is observed by every mounted `useSession()` instance at once (the global
// OverlayProvider, the /verify page, `useBeta` on deposit surfaces). Dedupe their reaction through
// one in-flight promise so the switch fires ONE logout POST, not a burst of identical ones. Cleared
// when it settles, so a subsequent switch logs out again. Idempotent regardless (logout just clears
// the cookie), so this is a cheapness/hardening guard, not a correctness requirement.
let pendingLogout: Promise<void> | null = null;
function endSessionForWalletChange(): Promise<void> {
  pendingLogout ??= fetch("/api/auth/logout", { method: "POST" })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      pendingLogout = null;
    });
  return pendingLogout;
}

export function useSession(): {
  session: Session | null | undefined; // undefined = still loading
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const { address } = useAccount();
  // Whether a connected wallet has EVER been observed in this instance — lets us tell a real
  // disconnect apart from the brief `address === undefined` window while wagmi reconnects on load.
  const seenConnectedRef = useRef(false);

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

  // Bind the in-memory session to the LIVE connected wallet. A SIWE session proves control of
  // exactly ONE address; when the browser wallet switches to a DIFFERENT account (or fully
  // disconnects after having been connected), that session is stale for the wallet now in front of
  // the user. End it server-side (clears the httpOnly sp_session cookie, so the middleware also
  // stops honouring the old wallet's `beta` claim) and re-fetch (→ null), so the UI treats this as
  // signed-out and offers a fresh sign-in for the new wallet. Without this, switching from a
  // non-allowlisted wallet to an allowlisted one left the app stuck on the old "not in the alpha
  // yet" verdict with no way to re-sign; the reverse let a switched-in wallet coast on the old
  // wallet's beta claim. NON-CUSTODY: logout only drops the access cookie — it never touches the
  // wallet, keys, or funds, and never gates /exit or /trust.
  useEffect(() => {
    if (address) seenConnectedRef.current = true;
    if (!isSessionWalletStale(session, address, seenConnectedRef.current)) return;
    let cancelled = false;
    void (async () => {
      await endSessionForWalletChange();
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [address, session, refresh]);

  return { session, refresh };
}
