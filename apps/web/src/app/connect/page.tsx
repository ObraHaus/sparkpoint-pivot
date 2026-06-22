"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, SparkMark } from "@/lib/icons";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

/** Wallet rows — inline brand SVGs reproduced verbatim from the design. */
const WALLETS: { name: string; svg: ReactNode }[] = [
  {
    name: "Coinbase Wallet",
    svg: (
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#0052FF" />
        <circle cx="20" cy="20" r="11.5" fill="#fff" />
        <rect x="16" y="16" width="8" height="8" rx="2" fill="#0052FF" />
      </svg>
    ),
  },
  {
    name: "WalletConnect",
    svg: (
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#3396FF" />
        <path
          d="M11.6 17.6a12 12 0 0 1 16.8 0 .8.8 0 0 1 0 1.1l-2 2a.5.5 0 0 1-.7 0l-1-1a8 8 0 0 0-9.4 0l-1 1a.5.5 0 0 1-.7 0l-2-2a.8.8 0 0 1 0-1.1Z"
          fill="#fff"
        />
        <circle cx="14.8" cy="23.4" r="1.4" fill="#fff" />
        <circle cx="25.2" cy="23.4" r="1.4" fill="#fff" />
      </svg>
    ),
  },
  {
    name: "MetaMask",
    svg: (
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#16202e" />
        <path d="M12 9l6 4-2-7z" fill="#E2761B" />
        <path d="M28 9l-6 4 2-7z" fill="#E17726" />
        <path d="M17.5 13h5l7.5.9-2.2 11.6-3 2.1-2.8-1.5-2.8 1.5-3-2.1L10 13.9 17.5 13z" fill="#E4761B" />
        <path d="M14.6 26.6l2.7-1.4 2.7 1.3 2.7-1.3 2.7 1.4-.3 2.3-2.4 1.6h-5.4l-2.4-1.6z" fill="#F6E2D2" />
      </svg>
    ),
  },
  {
    name: "Browser wallet",
    svg: (
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#2a3346" />
        <circle cx="20" cy="20" r="9" fill="none" stroke="#cbd5e1" strokeWidth="2" />
        <path
          d="M11 20h18M20 11c2.6 2.4 2.6 15.6 0 18M20 11c-2.6 2.4-2.6 15.6 0 18"
          stroke="#cbd5e1"
          strokeWidth="1.6"
          fill="none"
        />
      </svg>
    ),
  },
];

export default function ConnectPage() {
  const router = useRouter();
  const [connecting, setConnecting] = useState<number | null>(null);

  const onConnect = (i: number) => {
    if (connecting !== null) return;
    setConnecting(i);
    setTimeout(() => router.push("/verify"), 900);
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
            {WALLETS.map((w, i) => (
              <button className="walletrow" data-i={i} key={i} onClick={() => onConnect(i)}>
                {connecting === i ? (
                  <>
                    <span className="wl-ico">
                      <span className="ai-dot"></span>
                    </span>
                    <span className="wl-name">Connecting…</span>
                  </>
                ) : (
                  <>
                    <span className="wl-ico">{w.svg}</span>
                    <span className="wl-name">{w.name}</span>
                    <Icon name="chevr" size={16} />
                  </>
                )}
              </button>
            ))}
          </div>
          <div className="connect-reassure">
            <Icon name="shieldcheck" size={16} />
            <span>You own your keys and your account. We never generate a wallet for you or hold your keys.</span>
          </div>
          <div style={{ textAlign: "center", marginTop: "14px" }}>
            <span className="pill ghosty" style={{ cursor: "default" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#0052FF" />
              </svg>
              Base network
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
