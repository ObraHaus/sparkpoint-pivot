"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Icon, SparkMark } from "@/lib/icons";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

/** Wallet rows — real brand logos (public/wallets) on a 38px tile. */
const WALLETS: { name: string; icon: ReactNode; tileStyle?: CSSProperties }[] = [
  {
    name: "Coinbase Wallet",
    icon: <Image src="/wallets/coinbase.webp" alt="" width={38} height={38} style={{ objectFit: "cover" }} />,
    tileStyle: { background: "#0052FF" },
  },
  {
    name: "WalletConnect",
    icon: <Image src="/wallets/walletconnect.png" alt="" width={38} height={38} style={{ objectFit: "cover" }} />,
  },
  {
    name: "MetaMask",
    icon: <Image src="/wallets/metamask.png" alt="" width={38} height={38} style={{ objectFit: "contain" }} />,
    tileStyle: { background: "#ffffff" },
  },
  {
    name: "Browser wallet",
    icon: (
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
                    <span className="wl-ico" style={w.tileStyle}>{w.icon}</span>
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
