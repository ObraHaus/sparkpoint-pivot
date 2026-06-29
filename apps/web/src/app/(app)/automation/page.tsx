"use client";

/**
 * /automation — Session-key management. By default you sign every move (data.sessionKey
 * is null → the none-granted empty state). Any granted key is scoped, capped,
 * time-boxed, and revocable by you instantly.
 *
 * Faithful 1:1 port of the design's `automation` screen
 * (docs/design-handover/showcase/screens/trust.js). Markup, classes, and the
 * "How session keys stay safe" rows are reproduced verbatim.
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";

const SAFE: [string, string][] = [
  ["Allowlist", "Can only touch the audited Aave vault — nothing else."],
  ["Per-tx + cumulative caps", "Bounded spend per action and in total."],
  ["Max slippage", "Trades stop if prices move against you."],
  ["Hard expiry", "Auto-expires; you set the window."],
  ["Instant revoke", "Cancel unilaterally on-chain — no Sparky cooperation needed."],
];

export default function Page() {
  const router = useRouter();
  const sk = data.sessionKey;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Automation</h1>
          <div className="sub">Opt-in, scoped, time-boxed — and revocable by you instantly.</div>
        </div>
      </div>
      {sk ? null : (
        <div className="card card-pad" style={{ textAlign: "center", padding: "36px 24px", marginBottom: 16 }}>
          <div className="empty" style={{ padding: 0 }}>
            <span className="ei">
              <Icon name="zap" size={24} />
            </span>
            <div className="et">No active automation</div>
            <div className="eb">
              By default you sign every move. You can grant a scoped, capped, time-limited session key for hands-off
              rebalancing — and revoke it instantly, without our help.
            </div>
            <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("automation/grant"))}>
              Grant scoped access
            </button>
          </div>
        </div>
      )}
      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">How session keys stay safe</span>
        </div>
        {SAFE.map((r) => (
          <div className="statusrow" key={r[0]}>
            <span style={{ fontWeight: 600 }}>{r[0]}</span>
            <span className="muted" style={{ fontSize: 12.5, maxWidth: 300, textAlign: "right" }}>
              {r[1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
