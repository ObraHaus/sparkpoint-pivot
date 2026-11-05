"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Icon, SparkMark } from "@/lib/icons";
import { PUBLIC_NETWORKS } from "@sparkpoint/shared/networks";
import { PubTop } from "@/components/screens/PubTop";
import { NearWalletControl } from "@/components/near/NearWalletControl";
import { useNearLogin } from "@/lib/near/useNearLogin";
import "@/components/screens/public.css";

/** The one wallet row this build actually wires: the injected/browser connector. */
const WALLET_ROW_LABEL = "Browser wallet / MetaMask";

/**
 * wagmi names the injected connector "Injected", which is implementation jargon. Show a label
 * people recognise instead, while still passing through a real connector name if one is supplied.
 */
function walletRowLabel(name: string | undefined): string {
  const clean = name?.trim();
  if (!clean || clean.toLowerCase() === "injected") return WALLET_ROW_LABEL;
  return clean;
}

const BrowserIcon = (
  <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden>
    <rect width="40" height="40" rx="10" fill="#2a3346" />
    <circle cx="20" cy="20" r="9" fill="none" stroke="#cbd5e1" strokeWidth="2" />
    <path
      d="M11 20h18M20 11c2.6 2.4 2.6 15.6 0 18M20 11c-2.6 2.4-2.6 15.6 0 18"
      stroke="#cbd5e1"
      strokeWidth="1.6"
      fill="none"
    />
  </svg>
);

export default function ConnectPage() {
  const router = useRouter();
  // REAL wagmi connect (the injected/browser-wallet connector is the only one wired in
  // this build; WalletConnect/Coinbase SDKs are deferred). No wallet is ever faked — the
  // page advances to /verify ONLY after an actual connection is established.
  const { isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  // HONEST ROWS: one per REAL connector. This build wires `injected()` only — the old four
  // Coinbase/WalletConnect/MetaMask/Browser rows all called this same connector, which promised
  // wallet support the app did not have. Add a row here only when its connector is truly wired.
  const walletRows = connectors.filter((c) => c.type === "injected");
  const injected = walletRows[0];
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const nearLogin = useNearLogin();

  useEffect(() => {
    if (isConnected) router.push("/verify");
  }, [isConnected, router]);

  const onConnect = (i: number) => {
    const connector = walletRows[i];
    if (isPending || !connector) return;
    setPendingIdx(i);
    connect({ connector });
  };
  const connecting = isPending ? pendingIdx : null;
  const nearPhaseLabel =
    nearLogin.phase === "nonce"
      ? "Starting NEAR sign-in…"
      : nearLogin.phase === "signing"
        ? "Waiting for NEAR signature…"
        : nearLogin.phase === "verifying"
          ? "Verifying NEAR account…"
          : "Sign in with NEAR";

  const onNearSignIn = async () => {
    if (nearLogin.pending) return;
    const result = await nearLogin.login();
    if (result) router.push("/verify");
  };

  return (
    <div className="pubwrap">
      <PubTop />
      <div className="center-stage">
        <div className="connect-card">
          <div style={{ textAlign: "center", marginBottom: "6px" }}>
            <SparkMark size={34} />
          </div>
          <h2 style={{ textAlign: "center", fontSize: "22px", fontWeight: 600, margin: "0 0 6px" }}>
            Connect your wallet
          </h2>
          <p
            style={{
              textAlign: "center",
              fontSize: "13.5px",
              color: "var(--muted-foreground)",
              margin: "0 0 20px",
              lineHeight: 1.5,
            }}
          >
            You stay in control. We read your wallet to personalize —{" "}
            <b style={{ color: "var(--foreground)" }}>nothing moves without your signature.</b>
          </p>
          <div className="walletlist">
            {/* 076 — a REAL NEAR-only sign-in option (Meteor first). It proves the NEAR account
                with NEP-413 server-side; no EVM wallet is needed. */}
            <button
              className="walletrow"
              data-testid="near-signin"
              onClick={() => void onNearSignIn()}
              disabled={nearLogin.pending}
              aria-disabled={nearLogin.pending}
            >
              <span className="wl-ico" style={{ background: "#000000" }}>
                <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden>
                  <rect width="40" height="40" rx="10" fill="#000000" />
                  <path d="M12 28V12h4l8 10.5V12h4v16h-4l-8-10.5V28h-4Z" fill="#ffffff" />
                </svg>
              </span>
              <span className="wl-name">{nearPhaseLabel}</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                Meteor
              </span>
              <Icon name="chevr" size={16} />
            </button>
            {walletRows.length === 0 ? (
              <p
                style={{
                  textAlign: "center",
                  fontSize: "12.5px",
                  color: "var(--muted-foreground)",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                No browser wallet detected. Install MetaMask (or another browser wallet) to connect.
              </p>
            ) : (
              walletRows.map((connector, i) => (
                <button
                  className="walletrow"
                  data-i={i}
                  key={connector.uid}
                  data-testid="connect-wallet-row"
                  onClick={() => onConnect(i)}
                >
                  {connecting === i ? (
                    <>
                      <span className="wl-ico">
                        <span className="ai-dot"></span>
                      </span>
                      <span className="wl-name">Connecting…</span>
                    </>
                  ) : (
                    <>
                      <span className="wl-ico">{BrowserIcon}</span>
                      <span className="wl-name">{walletRowLabel(connector.name)}</span>
                      <Icon name="chevr" size={16} />
                    </>
                  )}
                </button>
              ))
            )}
          </div>
          {!injected && (
            <p style={{ textAlign: "center", fontSize: "12.5px", color: "var(--muted-foreground)", margin: "10px 0 0", lineHeight: 1.5 }}>
              No browser wallet detected. Install MetaMask (or another browser wallet) to connect.
            </p>
          )}
          {(error || nearLogin.error) && (
            <p style={{ textAlign: "center", fontSize: "12.5px", color: "var(--loss, #ff6b6b)", margin: "10px 0 0", lineHeight: 1.5 }}>
              {error?.message ?? nearLogin.error}
            </p>
          )}
          {/* 075 — optional NEAR wallet, separate from EVM sign-in. Meteor first; no access key. */}
          <div
            data-testid="near-connect-section"
            style={{
              marginTop: "18px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border-soft)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
              NEAR wallet (optional)
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "var(--muted-foreground)",
                margin: "0 0 10px",
                lineHeight: 1.5,
              }}
            >
              Already signed in with NEAR? You can also connect your account here to receive swaps
              on NEAR. Signing in with NEAR is a real option above — no EVM wallet needed.
            </p>
            <NearWalletControl />
          </div>

          <div className="connect-reassure">
            <Icon name="shieldcheck" size={16} />
            <span>You own your keys and your account. We never generate a wallet for you or hold your keys.</span>
          </div>
          <div
            data-testid="connect-networks"
            style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: "14px" }}
          >
            {PUBLIC_NETWORKS.map((n) => (
              <span
                key={n.id}
                className="pill ghosty"
                style={{ cursor: "default", fontSize: 11.5 }}
                title={n.destinationOnly ? `${n.label} — receive only (paste a payout address)` : `${n.label} — supported`}
              >
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: n.color, display: "inline-block" }} />
                {n.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
