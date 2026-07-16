"use client";

/**
 * /verify — the REAL access check between /connect and onboarding.
 *
 * No fabricated pass: every row reflects live state — the connected wallet (wagmi
 * useAccount), whether it's on a Base network, and the actual beta/whitelist result
 * (useBeta → the default-permissive testnet gate, or the configured allowlist on
 * mainnet). If nobody is connected there is nothing to verify, so it routes back to
 * /connect. If the wallet is genuinely not eligible, it says so honestly instead of
 * waving everyone through.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Icon } from "@/lib/icons";
import { useBeta } from "@/lib/auth/whitelist";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

const BASE_CHAINS = new Set<number>([8453, 84532]);
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function VerifyPage() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const beta = useBeta();

  const onBase = chainId !== undefined && BASE_CHAINS.has(chainId);
  const betaOk = isConnected && beta.canTransact;
  const done = isConnected && onBase && betaOk;
  const blocked = isConnected && onBase && !betaOk;

  const steps: { label: string; ok: boolean; value?: string }[] = [
    { label: "Wallet connected", ok: isConnected, value: isConnected ? shortAddr(address) : undefined },
    {
      label: "On Base network",
      ok: onBase,
      value: onBase ? (chainId === 84532 ? "Base Sepolia" : "Base") : isConnected ? "wrong network" : undefined,
    },
    {
      label: "Whitelist (beta)",
      ok: betaOk,
      value: betaOk ? (beta.isTestnet ? "testnet — open" : "eligible") : blocked ? "not eligible" : undefined,
    },
  ];

  // Nothing to verify without a connected wallet — return to the real connect step.
  useEffect(() => {
    if (!isConnected) {
      const t = setTimeout(() => router.push("/connect"), 1200);
      return () => clearTimeout(t);
    }
  }, [isConnected, router]);

  const title = !isConnected
    ? "Connect a wallet first"
    : done
      ? "You're in."
      : blocked
        ? "This wallet isn't in the beta yet"
        : "Checking your access…";
  const subtitle = !isConnected
    ? "Taking you back to connect your wallet…"
    : done
      ? "Let's build your plan — it takes about 3 minutes."
      : blocked
        ? "Your wallet can still withdraw anytime via /exit, but new deposits aren't open for it yet."
        : !onBase
          ? "Switch your wallet to Base (or Base Sepolia) to continue."
          : "Confirming your wallet's beta eligibility on Base.";

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
          <div id="vcta">
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
                    Skip to app (demo)
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
