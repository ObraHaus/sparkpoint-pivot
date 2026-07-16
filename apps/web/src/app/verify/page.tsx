"use client";

/**
 * /verify — the REAL access check between /connect and onboarding, now backed by a SERVER session.
 *
 * Every row reflects live state — the connected wallet (wagmi useAccount), whether it's on Base,
 * and the actual SIWE sign-in + allowlist result resolved server-side (nonce → sign → verify →
 * httpOnly session carrying {beta, admin} from the agent's DB-backed allowlist). No fabricated
 * pass: signing in only proves wallet control (authorizes nothing on-chain); a genuinely
 * non-allowlisted wallet is told so honestly and can still withdraw anytime via /exit.
 */

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Icon } from "@/lib/icons";
import { useSession, useSiweLogin } from "@/lib/auth/useSiwe";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

const BASE_CHAINS = new Set<number>([8453, 84532]);
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function VerifyPage() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { session, refresh } = useSession();
  const { login, pending, error } = useSiweLogin();

  const onBase = chainId !== undefined && BASE_CHAINS.has(chainId);
  const signedIn = session != null; // null|undefined → not signed in / loading
  const betaOk = signedIn && session.beta;
  const done = betaOk;
  const blocked = signedIn && !session.beta;
  const needsSignIn = isConnected && onBase && session === null;

  const handleSignIn = useCallback(async () => {
    if (!address || !chainId) return;
    const result = await login(address, chainId);
    if (result) await refresh();
  }, [address, chainId, login, refresh]);

  // Nothing to verify without a connected wallet — return to the real connect step.
  useEffect(() => {
    if (!isConnected) {
      const t = setTimeout(() => router.push("/connect"), 1200);
      return () => clearTimeout(t);
    }
  }, [isConnected, router]);

  const steps: { label: string; ok: boolean; value?: string }[] = [
    { label: "Wallet connected", ok: isConnected, value: isConnected ? shortAddr(address) : undefined },
    {
      label: "On Base network",
      ok: onBase,
      value: onBase ? (chainId === 84532 ? "Base Sepolia" : "Base") : isConnected ? "wrong network" : undefined,
    },
    {
      label: "Signed in (SIWE)",
      ok: signedIn,
      value: signedIn ? "verified" : needsSignIn ? "sign to continue" : undefined,
    },
    {
      label: "Beta access",
      ok: betaOk,
      value: betaOk ? "eligible" : blocked ? "not in beta yet" : undefined,
    },
  ];

  const title = !isConnected
    ? "Connect a wallet first"
    : !onBase
      ? "Switch to Base"
      : done
        ? "You're in."
        : blocked
          ? "This wallet isn't in the beta yet"
          : needsSignIn
            ? "Verify it's you"
            : "Checking your access…";
  const subtitle = !isConnected
    ? "Taking you back to connect your wallet…"
    : !onBase
      ? "Switch your wallet to Base (or Base Sepolia) to continue."
      : done
        ? "Let's build your plan — it takes about 3 minutes."
        : blocked
          ? "Your wallet can still withdraw anytime via /exit, but new deposits aren't open for it yet."
          : needsSignIn
            ? "Sign a message to prove you control this wallet. It authorizes nothing on-chain and moves no funds."
            : "Confirming your session…";

  return (
    <div className="pubwrap">
      <PubTop />
      <div className="center-stage">
        <div className="connect-card" style={{ textAlign: "center" }}>
          <div className="verify-anim" id="vanim">
            {done ? (
              <span style={{ color: "var(--gain)" }}>
                <Icon name="check" size={30} stroke={2.5} />
              </span>
            ) : blocked || (isConnected && !onBase) ? (
              <span style={{ color: "var(--caution)" }}>
                <Icon name="info" size={28} />
              </span>
            ) : (
              <span className="ai-dot"></span>
            )}
          </div>
          <h2 id="vtitle" style={{ fontSize: "20px", fontWeight: 600, margin: "18px 0 6px" }}>
            {title}
          </h2>
          <p id="vsub" style={{ fontSize: "13.5px", color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
            {subtitle}
          </p>
          <div
            id="vsteps"
            style={{ margin: "20px 0 4px", textAlign: "left", maxWidth: "280px", marginInline: "auto" }}
          >
            {isConnected &&
              steps.map(({ label, ok, value }, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "6px 0",
                    fontSize: "13px",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {ok ? (
                    <span style={{ color: "var(--gain)" }}>
                      <Icon name="check" size={15} stroke={2.5} />
                    </span>
                  ) : (
                    <span style={{ color: "var(--caution)" }}>
                      <Icon name="info" size={14} />
                    </span>
                  )}
                  <span style={{ flex: 1 }}>
                    {value ? (
                      <>
                        {label} · <span className="mono" style={{ color: "var(--foreground)" }}>{value}</span>
                      </>
                    ) : (
                      label
                    )}
                  </span>
                </div>
              ))}
          </div>
          {error && (
            <p style={{ fontSize: "12.5px", color: "var(--loss, #ff6b6b)", margin: "8px 0 0", lineHeight: 1.5 }}>
              {error}
            </p>
          )}
          <div id="vcta">
            {needsSignIn && (
              <a
                className="btn btn-primary btn-lg"
                onClick={pending ? undefined : handleSignIn}
                aria-disabled={pending}
                style={{ marginTop: "18px", display: "inline-flex", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}
              >
                {pending ? "Waiting for signature…" : "Sign in with wallet"}
              </a>
            )}
            {done && (
              <>
                <a
                  className="btn btn-primary btn-lg"
                  onClick={() => router.push("/onboarding")}
                  style={{ marginTop: "18px", display: "inline-flex", cursor: "pointer" }}
                >
                  Start onboarding
                </a>
                <div style={{ marginTop: "10px" }}>
                  <a className="btn btn-ghost btn-sm" onClick={() => router.push("/chat")} style={{ cursor: "pointer" }}>
                    Skip to app
                  </a>
                </div>
              </>
            )}
            {blocked && (
              <a
                className="btn btn-ghost btn-sm"
                onClick={() => router.push("/exit")}
                style={{ marginTop: "16px", display: "inline-flex", cursor: "pointer" }}
              >
                Withdraw via /exit →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
