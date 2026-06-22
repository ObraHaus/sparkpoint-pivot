"use client";

/**
 * /automation/grant — Grant scoped access: you decide the scope, caps, and expiry,
 * and can revoke anytime. Granting the session key is itself a transaction you sign.
 *
 * Faithful 1:1 port of the design's `automation/grant` screen
 * (docs/design-handover/showcase/screens/trust.js). Markup, classes, copy, the
 * switch toggle, and the expiry segmented control are reproduced verbatim.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";

const EXPIRES = ["7 days", "30 days", "90 days"];

export default function Page() {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [expiry, setExpiry] = useState(0);

  return (
    <div className="page page-narrow">
      <a className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} onClick={() => router.push(toHref("automation"))}>
        <Icon name="chevr" size={15} /> Back
      </a>
      <div className="pagehead">
        <div>
          <h1>Grant scoped access</h1>
          <div className="sub">You decide the scope, caps, and expiry. Revoke anytime.</div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 18 }}>
          <label>What it can do</label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          >
            <span style={{ fontSize: 13.5 }}>Auto-rebalance within the Aave vault only</span>
            <button className={"switch" + (on ? " on" : "")} onClick={() => setOn((v) => !v)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Cumulative cap</label>
          <input className="input" defaultValue="$5,000" />
          <div className="hint">Total the session key can move before it stops.</div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Max slippage</label>
          <input className="input" defaultValue="0.5%" />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Expires</label>
          <div className="seg" style={{ width: "100%" }}>
            {EXPIRES.map((d, i) => (
              <button key={d} className={i === expiry ? "active" : ""} style={{ flex: 1 }} onClick={() => setExpiry(i)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            background: "var(--info-subtle)",
            border: "1px solid color-mix(in srgb,var(--info) 22%,transparent)",
            borderRadius: "var(--radius)",
            padding: 13,
            fontSize: 12.5,
            color: "var(--muted-foreground)",
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          <Icon name="info" size={14} /> Granting a session key is itself a transaction you sign. In-scope actions then
          execute under these on-chain limits; each still appears in your outcome log.
        </div>
        <button
          className="btn btn-primary btn-lg"
          style={{ width: "100%" }}
          onClick={() => router.push(toHref("confirm/deposit"))}
        >
          Review &amp; sign grant
        </button>
      </div>
    </div>
  );
}
