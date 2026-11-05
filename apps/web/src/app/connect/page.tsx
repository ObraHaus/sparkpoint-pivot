"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Icon, SparkMark } from "@/lib/icons";
import { PUBLIC_NETWORKS } from "@sparkpoint/shared/networks";
import { PubTop } from "@/components/screens/PubTop";
import { useNearLogin } from "@/lib/near/useNearLogin";
import "@/components/screens/public.css";

/** The one wallet row this build actually wires: the injected/browser connector. */
type InjectedProvider = { isMetaMask?: boolean; providers?: InjectedProvider[] };

/** MetaMask injects `isMetaMask`; a multi-wallet browser exposes it inside `providers`. */
function isMetaMaskProvider(provider: unknown): boolean {
  const p = provider as InjectedProvider | undefined;
  return Boolean(p?.isMetaMask || p?.providers?.some((x) => x.isMetaMask));
}

/**
 * A browser-wallet glyph that is deliberately NOT a globe: the old shared globe made every row
 * look identical. MetaMask gets its real fox logo; every other injected wallet gets this.
 */
const BrowserWalletIcon = (
  <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden>
    <rect width="40" height="40" rx="10" fill="#2a3346" />
    <path
      d="M10.5 14.5h17a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 8 27V17a2.5 2.5 0 0 1 2.5-2.5Z"
      stroke="#cbd5e1"
      strokeWidth="2"
    />
    <path d="M8 19.5h21.5" stroke="#cbd5e1" strokeWidth="2" />
    <circle cx="25.5" cy="24.5" r="1.6" fill="#cbd5e1" />
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
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  // Read the injected provider's real identity without a setState-in-effect cascade: false on the
  // server, the actual provider flag on the client. Every non-MetaMask injected wallet stays the
  // honest generic "Browser wallet" with the distinct wallet glyph.
  const isMetaMask = useSyncExternalStore(
    () => () => {},
    () => isMetaMaskProvider((window as unknown as { ethereum?: InjectedProvider }).ethereum),
    () => false,
  );
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
              <span className="wl-ico" style={{ background: "#0f0f36" }}>
                {/* Meteor's own mark — the NEAR sign-in row must not be a generic "N" or a globe. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- 38px brand mark */}
                <img src="/wallets/meteor.svg" alt="" width={38} height={38} />
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
                      <span className="wl-ico">
                        {isMetaMask ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 38px wallet logo
                          <img src="/wallets/metamask.png" alt="" width={38} height={38} />
                        ) : (
                          BrowserWalletIcon
                        )}
                      </span>
                      <span className="wl-name">{isMetaMask ? "MetaMask" : "Browser wallet"}</span>
                      <Icon name="chevr" size={16} />
                    </>
                  )}
                </button>
              ))
            )}
          </div>
          {(error || nearLogin.error) && (
            <p style={{ textAlign: "center", fontSize: "12.5px", color: "var(--loss, #ff6b6b)", margin: "10px 0 0", lineHeight: 1.5 }}>
              {error?.message ?? nearLogin.error}
            </p>
          )}
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
                className="netbadge"
                title={n.destinationOnly ? `${n.label} — receive only (paste a payout address)` : `${n.label} — supported`}
              >
                <span aria-hidden className="netbadge-dot" style={{ background: n.color }} />
                {n.label}
                {n.destinationOnly && <span className="netbadge-meta">receive</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
