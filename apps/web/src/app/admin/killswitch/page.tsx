"use client";

/**
 * Admin → Emergency kill-switch (scKill + openKillConfirm dialog).
 * Multisig-governed, pause-only. It can halt new execution — it can NEVER touch
 * user funds or block withdrawals. This panel can only propose & sign; execution
 * requires the on-chain 2-of-3 multisig threshold. Faithful 1:1 port of the
 * Kill-switch screen in SparkPoint Admin.html.
 */

import { useState } from "react";
import { Icon } from "@/lib/icons";
import { ROLES, useAdminRole } from "@/components/admin/role-context";

const HISTORY: [string, string, string, string, string][] = [
  ["Jun 14 02:11", "Drill (resume)", "ops_a", "2/3", "ok"],
  ["Jun 14 02:04", "Drill (pause)", "ops_a", "2/3", "ok"],
  ["May 02 18:30", "Resume", "founder", "3/3", "ok"],
  ["May 02 18:22", "Emergency pause", "security", "2/3", "ok"],
];

/** openKillConfirm() — the propose-and-sign confirmation dialog. */
function KillConfirm({ paused, onClose, onSign }: { paused: boolean; onClose: () => void; onSign: () => void }) {
  const { role } = useAdminRole();
  const [ack, setAck] = useState(false);
  const [awaiting, setAwaiting] = useState(false);

  return (
    <div className="addialog-scrim show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="addialog">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span className={`pill ${paused ? "ok" : "amber"}`} style={{ fontSize: 11 }}>
            <span className="led" />
            {paused ? "Resume" : "Emergency pause"}
          </span>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 600, margin: "6px 0 8px" }}>
          {paused ? "Propose resuming operation?" : "Propose an emergency pause?"}
        </h3>
        <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55, margin: "0 0 14px" }}>
          {paused ? (
            <>
              This proposes lifting the pause. New deposits and agent execution resume once{" "}
              <b style={{ color: "var(--foreground)" }}>2 of 3</b> signers confirm on-chain.
            </>
          ) : (
            <>
              This proposes halting <b style={{ color: "var(--foreground)" }}>new deposits and agent execution</b>. It needs{" "}
              <b style={{ color: "var(--foreground)" }}>2 of 3</b> multisig signers to take effect.{" "}
              <b style={{ color: "var(--gain)" }}>User withdrawals stay open the entire time.</b>
            </>
          )}
        </p>
        <div style={{ background: "var(--background)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div className="statusrow" style={{ padding: "7px 0" }}>
            <span className="muted">Your role</span>
            <span style={{ fontWeight: 600 }}>{ROLES[role].label} · signer 1 of 2 needed</span>
          </div>
          <div className="statusrow" style={{ padding: "7px 0", borderBottom: "none" }}>
            <span className="muted">Affects withdrawals?</span>
            <span style={{ color: "var(--gain)", fontWeight: 600 }}>No — never</span>
          </div>
        </div>
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "var(--foreground)", marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 2 }} /> I understand this{" "}
          {paused ? "resume" : "pause"} only takes effect after the multisig threshold is met, and that it cannot move user funds or block
          withdrawals.
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-exp" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-exp"
            disabled={!ack || awaiting}
            style={{
              opacity: ack ? 1 : 0.5,
              borderColor: "color-mix(in srgb,var(--caution) 45%,transparent)",
              color: "var(--caution)",
            }}
            onClick={() => {
              setAwaiting(true);
              setTimeout(onSign, 1400);
            }}
          >
            {awaiting ? (
              <>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} /> Awaiting multisig
                (1/2)…
              </>
            ) : (
              <>
                <Icon name="pause" size={13} /> Sign &amp; propose
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [paused, setPaused] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Emergency kill-switch</h1>
          <div className="sub">Multisig-governed, pause-only. It can halt new execution — it can never touch user funds or block withdrawals.</div>
        </div>
        <span className={`pill ${paused ? "amber" : "info"}`}>
          <span className="led" />
          {paused ? "Paused · new deposits halted" : "Pause-only · inactive"}
        </span>
      </div>
      <div
        className="infobanner"
        style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
      >
        <Icon name="info" size={16} />
        <span>
          <b style={{ color: "var(--foreground)" }}>This control is non-custodial.</b> It pauses{" "}
          <b style={{ color: "var(--foreground)" }}>new deposits &amp; agent execution only</b>. Withdrawals (N2: withdraw-always) remain open at
          all times. Executing a pause requires the on-chain multisig threshold — this panel can only propose &amp; sign.
        </span>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="ct">Pause scope</span>
            <span className="prov">what a pause does</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill amber" style={{ fontSize: 10 }}>
                PAUSES
              </span>{" "}
              New deposits
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              halted on-chain
            </span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill amber" style={{ fontSize: 10 }}>
                PAUSES
              </span>{" "}
              Agent / session-key execution
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              no new actions
            </span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill amber" style={{ fontSize: 10 }}>
                PAUSES
              </span>{" "}
              AI swaps &amp; rebalances
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              blocked
            </span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill ok" style={{ fontSize: 10 }}>
                STAYS OPEN
              </span>{" "}
              User withdrawals
            </span>
            <span style={{ color: "var(--gain)", fontSize: 12, fontWeight: 600 }}>always</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill ok" style={{ fontSize: 10 }}>
                STAYS OPEN
              </span>{" "}
              On-chain self-service exit
            </span>
            <span style={{ color: "var(--gain)", fontSize: 12, fontWeight: 600 }}>always</span>
          </div>
        </div>
        <div className="panel">
          <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="ct">Governance</span>
            <span className="prov">2-of-3 multisig</span>
          </div>
          <div className="statusrow">
            <span className="muted">Threshold</span>
            <span style={{ fontWeight: 600 }}>2 of 3 signers</span>
          </div>
          <div className="statusrow">
            <span className="muted">Signer A · Eng lead</span>
            <span className="mono" style={{ fontSize: 11 }}>
              0x4d…A1
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Signer B · Security</span>
            <span className="mono" style={{ fontSize: 11 }}>
              0x91…C7
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Signer C · Founder</span>
            <span className="mono" style={{ fontSize: 11 }}>
              0x2f…E3
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Last drill</span>
            <span className="pill ok">
              <span className="led" />
              Passed · 6h ago
            </span>
          </div>
        </div>
      </div>
      <div
        className="panel"
        style={{ marginTop: 16, borderColor: `color-mix(in srgb,var(--${paused ? "gain" : "caution"}) 30%,transparent)` }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{paused ? "Resume normal operation" : "Initiate emergency pause"}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 520, lineHeight: 1.5 }}>
              {paused
                ? "Proposes lifting the pause. New deposits & execution resume once the multisig threshold confirms."
                : "Proposes halting new deposits & agent execution. You'll sign as one signer; it executes only when 2 of 3 confirm. Withdrawals stay open throughout."}
            </div>
          </div>
          <button
            className="btn-exp"
            style={
              paused
                ? { fontSize: 13.5, padding: "11px 18px", borderColor: "color-mix(in srgb,var(--gain) 45%,transparent)", color: "var(--gain)" }
                : {
                    fontSize: 13.5,
                    padding: "11px 18px",
                    borderColor: "color-mix(in srgb,var(--caution) 45%,transparent)",
                    color: "var(--caution)",
                    background: "var(--caution-subtle)",
                  }
            }
            onClick={() => setConfirm(true)}
          >
            <Icon name={paused ? "check" : "pause"} size={14} /> {paused ? "Propose resume" : "Initiate pause"}
          </button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ch" style={{ marginBottom: 10 }}>
          <span className="ct">Kill-switch history</span>
        </div>
        <table className="adtbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Initiated by</th>
              <th>Signers</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {HISTORY.map((r) => (
              <tr key={r[0]}>
                <td className="mono">{r[0]}</td>
                <td>{r[1]}</td>
                <td className="mono">{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td>
                  <span className="pill ok">{r[4]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirm ? (
        <KillConfirm
          paused={paused}
          onClose={() => setConfirm(false)}
          onSign={() => {
            setPaused((p) => !p);
            setConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}
