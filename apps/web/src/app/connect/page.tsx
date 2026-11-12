"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Icon, SparkMark } from "@/lib/icons";
import { PUBLIC_NETWORKS } from "@sparkpoint/shared/networks";
import { PubTop } from "@/components/screens/PubTop";
import { useNearLogin } from "@/lib/near/useNearLogin";
import {
  metaMaskAvailableSnapshot,
  metaMaskServerSnapshot,
  requestMetaMaskProvider,
  subscribeMetaMaskProvider,
} from "@/lib/wallet/metamaskProvider";
import "@/components/screens/public.css";

export default function ConnectPage() {
  const router = useRouter();
  // REAL wagmi connect: the MetaMask-labeled row drives the one connector in the build, which
  // targets MetaMask's own provider (EIP-6963 rDNS `io.metamask`, or `providers[]` where
  // `isMetaMask && !isPhantom`). It never falls through to a generic `window.ethereum` that
  // another extension (e.g. Phantom) may own. No wallet is ever faked.
  const { isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const metaMaskConnector =
    connectors.find((c) => c.id === "metaMask") ?? connectors.find((c) => c.type === "injected");
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const hasMetaMask = useSyncExternalStore(
    subscribeMetaMaskProvider,
    metaMaskAvailableSnapshot,
    metaMaskServerSnapshot,
  );
  const nearLogin = useNearLogin();

  useEffect(() => {
    if (isConnected) router.push("/verify");
  }, [isConnected, router]);

  const onConnect = () => {
    if (isPending) return;
    if (!requestMetaMaskProvider()) {
      setLocalError(
        "MetaMask not detected. Install the MetaMask browser extension, then reload this page.",
      );
      return;
    }
    if (!metaMaskConnector) {
      setLocalError("MetaMask not detected. Install the MetaMask browser extension, then reload this page.");
      return;
    }
    setLocalError(null);
    setPendingIdx(0);
    connect({ connector: metaMaskConnector });
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
            {!hasMetaMask ? (
              <div
                className="walletrow"
                data-testid="metamask-not-detected"
                aria-disabled="true"
                style={{ cursor: "default", opacity: 0.8 }}
              >
                <span className="wl-ico">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 38px wallet logo */}
                  <img src="/wallets/metamask.png" alt="" width={38} height={38} />
                </span>
                <span className="wl-name">MetaMask not detected</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                  Install
                </span>
              </div>
            ) : (
              <button
                className="walletrow"
                data-i={0}
                key={metaMaskConnector?.uid ?? "metamask"}
                data-testid="connect-wallet-row"
                onClick={onConnect}
                disabled={!metaMaskConnector}
              >
                {connecting === 0 ? (
                  <>
                    <span className="wl-ico">
                      <span className="ai-dot"></span>
                    </span>
                    <span className="wl-name">Connecting…</span>
                  </>
                ) : (
                  <>
                    <span className="wl-ico">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 38px wallet logo */}
                      <img src="/wallets/metamask.png" alt="" width={38} height={38} />
                    </span>
                    <span className="wl-name">MetaMask</span>
                    <Icon name="chevr" size={16} />
                  </>
                )}
              </button>
            )}
          </div>
          {(error || localError || nearLogin.error) && (
            <p style={{ textAlign: "center", fontSize: "12.5px", color: "var(--loss, #ff6b6b)", margin: "10px 0 0", lineHeight: 1.5 }}>
              {error?.message ?? localError ?? nearLogin.error}
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
