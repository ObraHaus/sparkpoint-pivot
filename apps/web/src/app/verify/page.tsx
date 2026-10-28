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

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Icon } from "@/lib/icons";
import { useSession, useSiweLogin } from "@/lib/auth/useSiwe";
import { useAgentClient } from "@/lib/agent/useAgent";
import { hasSavedMandate } from "@/lib/agent/mandate";
import { useNetwork } from "@/lib/network";
import { captureNetworkDiagnostic } from "@/lib/debug/networkBeacon";
import { AccessApplicationForm } from "@/components/access/AccessApplicationForm";
import { PubTop } from "@/components/screens/PubTop";
import { stageCopy } from "@/lib/stage";
import { wagmiConfig } from "@/lib/wagmi";
import "@/components/screens/public.css";

// SIWE sign-in is offered on exactly the chains THIS build registers in wagmi — mirrors the server's
// allowedChainIds() (SIWE_CHAIN_ID) in app/api/auth/verify/route.ts. Alpha/testnet registers Base ·
// Base Sepolia · Robinhood testnet; the mainnet-beta registers Robinhood Chain 4663 only. Deriving
// from the config keeps each build correct without a hardcoded per-build list, and never shows a
// sign-in CTA on a chain this build's server would reject.
const SIGNIN_CHAINS = new Set<number>(wagmiConfig.chains.map((c) => c.id));
const CHAIN_LABEL: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia", 46630: "Robinhood Testnet", 4663: "Robinhood Chain" };
// The chains THIS build registers (derived above), as an ordered list + a human phrase — drives the
// wrong-network recovery CTAs + copy so they always point at a chain the wallet can actually switch to.
const SIGNIN_CHAIN_LIST: number[] = [...SIGNIN_CHAINS];
const signinChainNames = SIGNIN_CHAIN_LIST.map((id) => CHAIN_LABEL[id] ?? `chain ${id}`).join(" or ");
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function VerifyPage() {
  const router = useRouter();
  const { address, chainId, isConnected, status, connector } = useAccount();
  const { session, refresh } = useSession();
  const { login, pending, phase, error } = useSiweLogin();
  // Set when a sign-in completed but the SRK auto-gate could not be READ (timeout / agent quiet),
  // as opposed to reading a genuinely insufficient balance. Cleared on every fresh attempt so a
  // successful retry never leaves a stale warning on screen.
  const [gateUnavailable, setGateUnavailable] = useState(false);
  const { switchToChain } = useNetwork();

  const onSupported = chainId !== undefined && SIGNIN_CHAINS.has(chainId);
  // wagmi's `useAccount().chainId` is a pass-through: it is `undefined` while connecting/reconnecting
  // (and briefly after a wallet-side switch) even though a persisted `isConnected` is already truthy.
  // Only ASSERT "wrong network" once the connection has SETTLED (status === "connected") — otherwise a
  // perfectly-supported wallet flashes a scary dead-end during the reconnect/hydration window. Until
  // then the gate shows a neutral "checking…" state instead.
  const wrongNetwork = isConnected && status === "connected" && chainId !== undefined && !onSupported;
  const signedIn = session != null; // null|undefined → not signed in / loading
  const betaOk = signedIn && session.beta;
  const done = betaOk;
  const blocked = signedIn && !session.beta;
  const needsSignIn = isConnected && onSupported && session === null;

  // Does this wallet already have a plan? /connect auto-forwards every returning wallet here and
  // sessions last 7 days, so without this check an onboarded user is told to "Start onboarding"
  // as the PRIMARY action forever — the app's own front door insisting they haven't started.
  //
  // `null` = unknown (still checking, or the check failed) ⇒ FAIL OPEN to the pre-025 CTA. This is
  // a convenience read on a gate that must never break: it is not on the withdraw/exit path (N2)
  // and nothing here is signable. Only fetched once the session is BETA — the BFF 403s
  // (`BETA_NOT_ENABLED`) every agent call for a non-beta wallet, so probing on the blocked branch
  // would be a guaranteed-failing request, and that branch must keep behaving exactly as today.
  const { client: agentClient, identity } = useAgentClient();
  // The answer is STAMPED with the wallet+chain it was read for, and read back only on a match, so
  // a wallet switch reverts to "unknown" during render instead of momentarily showing the previous
  // wallet's answer. (Clearing it with a setState in the effect body would be a cascading render.)
  const probeKey = identity ? `${identity.account}:${identity.chainId}` : "";
  const [probe, setProbe] = useState<{ key: string; onboarded: boolean } | null>(null);
  const onboarded = probe !== null && probe.key === probeKey ? probe.onboarded : null;
  useEffect(() => {
    if (!betaOk || !agentClient || !probeKey) return;
    const ctrl = new AbortController();
    let live = true;
    void (async () => {
      try {
        const body = await agentClient.request<unknown>("/mandate", { signal: ctrl.signal });
        if (live) setProbe({ key: probeKey, onboarded: hasSavedMandate(body) });
      } catch {
        // Fail open — an unreachable/failing agent must never turn the access gate into a dead end.
        // Record the settled "unknown" as not-onboarded so the anti-flicker gate below releases; a
        // probe that never resolves left the page on "Checking your access…" forever (061 e2e).
        if (live) setProbe({ key: probeKey, onboarded: false });
      }
    })();
    return () => {
      live = false;
      ctrl.abort();
    };
  }, [betaOk, agentClient, probeKey]);

  // Anti-flicker: render ONE stable loading state until every deciding input has settled, instead of
  // flipping the title/CTA as the wallet reconnects, the SIWE session resolves, and the onboarding
  // probe returns. connSettled: wallet done (re)connecting; session!==undefined: session resolved;
  // (done && onboarded===null): the returning-vs-new probe still running.
  const connSettled = status === "connected" || status === "disconnected";
  const resolving =
    !connSettled || (isConnected && session === undefined) || (done && onboarded === null);

  // Snapshot the real wallet/network state for the developer capture (see networkBeacon).
  const diagSnap = useCallback(
    () => ({ chainId, status, isConnected, connectorId: connector?.id, connectorName: connector?.name, address }),
    [chainId, status, isConnected, connector, address],
  );

  const handleSignIn = useCallback(async () => {
    if (!address || !chainId) return;
    // Capture on every explicit sign-in attempt too, so "have them log in again" is a reliable
    // incident-capture gesture even when the gate briefly showed supported.
    void captureNetworkDiagnostic("signin-attempt", diagSnap());
    setGateUnavailable(false);
    const result = await login(address, chainId);
    if (result) {
      setGateUnavailable(result.gateUnavailable && !result.beta);
      await refresh();
    }
  }, [address, chainId, diagSnap, login, refresh]);

  // Nothing to verify without a wallet — return to connect. Keyed on `disconnected` (NOT `!isConnected`)
  // so a wallet still reconnecting isn't bounced off /verify mid-hydration.
  useEffect(() => {
    if (status === "disconnected") {
      const t = setTimeout(() => router.push("/connect"), 1200);
      return () => clearTimeout(t);
    }
  }, [status, router]);

  // Auto-capture ONE diagnostic when the gate genuinely settles on an unsupported chain — our window
  // into an otherwise unreproducible report (wallet's real eth_chainId vs the chainId wagmi surfaced,
  // plus which injected wallet is bound). Guarded to `wrongNetwork`, so it never fires during settling.
  useEffect(() => {
    if (wrongNetwork) void captureNetworkDiagnostic("off-network", diagSnap());
  }, [wrongNetwork, diagSnap]);

  const steps: { label: string; ok: boolean; value?: string }[] = [
    { label: "Wallet connected", ok: isConnected, value: isConnected ? shortAddr(address) : undefined },
    {
      label: "On a supported network",
      ok: onSupported,
      value: onSupported
        ? (CHAIN_LABEL[chainId!] ?? "supported")
        : wrongNetwork
          ? "wrong network"
          : isConnected
            ? "checking…"
            : undefined,
    },
    {
      label: "Signed in (SIWE)",
      ok: signedIn,
      value: signedIn ? "verified" : needsSignIn ? "sign to continue" : undefined,
    },
    {
      // Stage-driven so it tracks NEXT_PUBLIC_APP_STAGE ("Alpha access" now; "Beta access" if we
      // ever flip to beta) — matches the sibling `value` which already uses stageCopy.adjective.
      label: `${stageCopy.label} access`,
      ok: betaOk,
      value: betaOk ? "eligible" : blocked ? `not in the ${stageCopy.adjective} yet` : undefined,
    },
  ];

  const title = !isConnected
    ? "Connect a wallet first"
    : wrongNetwork
      ? "Switch to a supported network"
      : done
        ? "You're in."
        : blocked
          ? `This wallet isn’t in the ${stageCopy.adjective} yet`
          : needsSignIn
            ? "Verify it's you"
            : "Checking your access…";
  const subtitle = !isConnected
    ? "Taking you back to connect your wallet…"
    : wrongNetwork
      ? `Switch your wallet to ${signinChainNames} to continue.`
      : done
        ? onboarded
          ? "Your plan is saved — pick up where you left off."
          : "Let's build your plan — it takes about 3 minutes."
        : blocked
          ? "Apply below and an admin will review it. Your wallet can still withdraw anytime via /exit."
          : needsSignIn
            ? "Sign a message to prove you control this wallet. It authorizes nothing on-chain and moves no funds."
            : "Confirming your session…";

  if (resolving) {
    return (
      <div className="pubwrap">
        <PubTop />
        <div className="center-stage">
          <div className="connect-card" style={{ textAlign: "center" }}>
            <div className="verify-anim" id="vanim">
              <span className="ai-dot"></span>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 600, margin: "18px 0 6px" }}>Checking your access…</h2>
            <p style={{ fontSize: "13.5px", color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
              One moment while we confirm your wallet and session.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
            ) : blocked || wrongNetwork ? (
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
            {wrongNetwork && (
              <>
                {/* Escape hatch: one switch CTA per chain THIS build registers (SIGNIN_CHAIN_LIST =
                    wagmiConfig.chains). switchChain also adds an unknown chain AND forces wagmi to
                    re-read the live chainId — self-healing a stale/mis-bound read as well as switching a
                    genuinely off-network wallet. Alpha lists its testnets; the mainnet-beta lists only
                    Robinhood Chain — never a dead button pointing at an unregistered chain. */}
                {SIGNIN_CHAIN_LIST.map((id, i) => (
                  <div key={id} style={{ marginTop: i === 0 ? "18px" : "10px" }}>
                    <a
                      className={i === 0 ? "btn btn-primary btn-lg" : "btn btn-ghost btn-sm"}
                      onClick={() => switchToChain(id as Parameters<typeof switchToChain>[0])}
                      style={{ display: "inline-flex", cursor: "pointer" }}
                    >
                      Switch to {CHAIN_LABEL[id] ?? `chain ${id}`}
                    </a>
                  </div>
                ))}
              </>
            )}
            {needsSignIn && (
              <a
                className="btn btn-primary btn-lg"
                onClick={pending ? undefined : handleSignIn}
                aria-disabled={pending}
                style={{ marginTop: "18px", display: "inline-flex", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1 }}
              >
                {/* Name the leg we are ACTUALLY on. "Waiting for signature…" is only true while the
                    wallet has the prompt; once it has been signed the wait is ours, and saying so
                    is the difference between "be patient" and "your wallet is stuck". */}
                {phase === "signing"
                  ? "Waiting for signature…"
                  : phase === "verifying"
                    ? "Verifying…"
                    : phase === "nonce"
                      ? "Starting sign-in…"
                      : "Sign in with wallet"}
              </a>
            )}
            {/* A wallet with a saved plan is NOT a new user — sending it to "Start onboarding" as
                the primary action is the app telling a returning user it doesn't know them. The
                two branches are otherwise identical, and `onboarded !== true` (unknown INCLUDED)
                keeps the pre-025 wording, so a failed/slow mandate read changes nothing. */}
            {done && (
              <>
                <a
                  className="btn btn-primary btn-lg"
                  onClick={() => router.push(onboarded ? "/chat" : "/onboarding")}
                  style={{ marginTop: "18px", display: "inline-flex", cursor: "pointer" }}
                >
                  {onboarded ? "Continue to app" : "Start onboarding"}
                </a>
                <div style={{ marginTop: "10px" }}>
                  <a
                    className="btn btn-ghost btn-sm"
                    onClick={() => router.push(onboarded ? "/onboarding" : "/chat")}
                    style={{ cursor: "pointer" }}
                  >
                    {onboarded ? "Review your plan" : "Skip to app"}
                  </a>
                </div>
              </>
            )}
            {blocked && (
              <>
                {/* 026 — this branch is no longer a dead end: apply for access here. The /exit
                    escape hatch below is UNCHANGED and stays outside the form (N2 — the way out is
                    never behind a form, and never a click further away than it was). */}
                {/* 045 — a wallet that holds the SRK threshold should have walked straight in. If
                    the balance could not be READ we must not let this form imply it was read and
                    found wanting: say so, and offer the one action that can still fix it. Shown
                    ABOVE the form because it changes what the form means. */}
                {gateUnavailable && (
                  <div
                    role="status"
                    className="card"
                    style={{ marginBottom: "14px", padding: "12px 14px", textAlign: "left" }}
                  >
                    We couldn&apos;t check your SRK balance just now, so we couldn&apos;t confirm
                    automatic access. If you hold at least the required SRK,{" "}
                    <a
                      onClick={pending ? undefined : handleSignIn}
                      aria-disabled={pending}
                      style={{ cursor: pending ? "default" : "pointer", textDecoration: "underline" }}
                    >
                      try signing in again
                    </a>
                    . Otherwise, apply below — your application still works either way.
                  </div>
                )}
                <AccessApplicationForm />
                <a
                  className="btn btn-ghost btn-sm"
                  onClick={() => router.push("/exit")}
                  style={{ marginTop: "16px", display: "inline-flex", cursor: "pointer" }}
                >
                  Withdraw via /exit →
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
