"use client";

/**
 * /bridge — Cross-network Bridge (Base ↔ Sui). Fully self-custodial: you sign the
 * lock/burn, the canonical bridge verifies, and you receive in your own wallet on the
 * destination network — Sparky never holds funds in transit.
 *
 * Faithful 1:1 port of the design's `bridge` screen
 * (docs/design-handover/showcase/screens/bridge.js). Markup, classes, copy, the
 * asset/network/amount controls, the swap-direction flip, and the route + custody
 * sections are reproduced verbatim; balances read from data.bridgeAssets.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { fmt } from "@/lib/utils";
import { toHref } from "@/lib/nav";
import "@/components/screens/bridge.css";

type NetId = "base" | "sui";

const NET: Record<NetId, { name: string; color: string }> = {
  base: { name: "Base", color: "#0052FF" },
  sui: { name: "Sui", color: "#4DA8FF" },
};

const ASSETS = ["USDC", "ETH"] as const;
type Asset = (typeof ASSETS)[number];

export default function Page() {
  const router = useRouter();
  const [from, setFrom] = useState<NetId>("base");
  const [to, setTo] = useState<NetId>("sui");
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amt, setAmt] = useState("500.00");
  const [focus, setFocus] = useState(false);

  const balOf = (net: NetId): number => {
    const a = data.bridgeAssets.find((x) => x.sym === asset);
    return a ? a[net] : 0;
  };

  const flip = () => {
    setFrom(to);
    setTo(from);
  };

  const f = NET[from];
  const t = NET[to];
  const dec = asset === "ETH" ? 4 : 2;

  return (
    <div className="page">
      <div className="br-wrap">
        <div className="pagehead">
          <div>
            <h1>Bridge</h1>
            <div className="sub">
              Move assets between networks. Non-custodial — you sign; Sparky never holds your funds in transit.
            </div>
          </div>
        </div>
        <div className="card-pad" style={{ padding: 0 }}>
          <div className="br-card">
            <div className="assetpick" style={{ marginBottom: 14 }}>
              {ASSETS.map((a) => (
                <button key={a} className={a === asset ? "on" : ""} onClick={() => setAsset(a)}>
                  {a}
                </button>
              ))}
            </div>
            <div className={"netbox" + (focus ? " focus" : "")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500 }}>From</span>
                <span className="netsel" onClick={flip}>
                  <span className="ndot" style={{ background: f.color }} />
                  {f.name}
                  <Icon name="chevd" size={13} />
                </span>
              </div>
              <div className="br-amt">
                <input
                  id="bramt"
                  inputMode="decimal"
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  onFocus={() => setFocus(true)}
                  onBlur={() => setFocus(false)}
                />
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--muted-foreground)" }}>{asset}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 4 }}>
                Balance on {f.name}:{" "}
                <span className="tnum">
                  {fmt(balOf(from), dec)} {asset}
                </span>{" "}
                ·{" "}
                <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => setAmt(fmt(balOf(from), dec))}>
                  Max
                </a>
              </div>
            </div>
            <div className="br-swap">
              <button title="Swap direction" onClick={flip}>
                <Icon name="refresh" size={17} />
              </button>
            </div>
            <div className="netbox">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500 }}>To</span>
                <span className="netsel">
                  <span className="ndot" style={{ background: t.color }} />
                  {t.name}
                </span>
              </div>
              <div className="br-amt">
                <span style={{ flex: 1, fontSize: 26, fontWeight: 600 }} className="tnum">
                  {amt || "0.00"}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--muted-foreground)" }}>{asset}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 4 }}>
                Balance on {t.name}:{" "}
                <span className="tnum">
                  {fmt(balOf(to), dec)} {asset}
                </span>
              </div>
            </div>
            <div
              style={{
                background: "var(--background)",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--radius)",
                padding: 13,
                marginTop: 14,
              }}
            >
              <div className="br-row">
                <span className="muted">Bridge route</span>
                <span>
                  {f.name} → {t.name} · canonical
                </span>
              </div>
              <div className="br-row">
                <span className="muted">Est. time</span>
                <span className="tnum">~3–5 min</span>
              </div>
              <div className="br-row">
                <span className="muted">Bridge fee</span>
                <span className="tnum">~$0.40</span>
              </div>
              <div className="br-row">
                <span className="muted">You&apos;ll receive</span>
                <span className="tnum" style={{ fontWeight: 600 }}>
                  ≈ {amt || "0.00"} {asset} on {t.name}
                </span>
              </div>
            </div>
            <button
              className="btn btn-primary btn-lg"
              style={{ width: "100%", marginTop: 16 }}
              onClick={() => router.push(toHref("confirm/bridge"))}
            >
              Review bridge
            </button>
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
              Next: simulation + guardrail check, then you sign. Withdraw-always applies on both networks.
            </div>
          </div>
        </div>
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div className="card-hd">
            <span className="t">How the bridge keeps custody yours</span>
          </div>
          <div className="route-step">
            <span className="rn">1</span>
            <div>
              You sign a <b>lock/burn</b> on {f.name} — funds leave your wallet only by your signature.
            </div>
          </div>
          <div className="route-step">
            <span className="rn">2</span>
            <div>
              The canonical bridge <b>verifies</b> the message across networks.
            </div>
          </div>
          <div className="route-step">
            <span className="rn">3</span>
            <div>
              You <b>receive</b> the asset on {t.name}, in your own wallet. Sparky never custodies it in transit.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
