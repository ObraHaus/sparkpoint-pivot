"use client";

/**
 * Admin → Emergency kill-switch (status + honest read-only control).
 *
 * Pausing is a NON-CUSTODIAL, pause-only power governed ON-CHAIN by the vault's guardian
 * (the deployed OZ TimelockController; a 2-of-3 Safe + timelock delay is Phase-3 hardening).
 * It can halt new execution — it can NEVER touch user funds or block withdrawals (N2).
 *
 * This panel is READ-ONLY in this build: it does not (and must not) fake a multisig signature.
 * Executing a pause/resume is performed off-app against the on-chain guardian; the illustrative
 * governance + history below are labelled as such (no fabricated signatures or audit records).
 */

import { Icon } from "@/lib/icons";

/** The live guardian of the deployed Base-Sepolia vault (OZ TimelockController). */
const GUARDIAN_TIMELOCK = "0x0A21A9B4c2cd2d6a68EC828188826B673572d720";

export default function Page() {
  // Read-only surface: no fake sign, no local pause toggle. Pause state would be read from
  // the chain once this panel is wired to the guardian; today it presents the honest default.
  const paused = false;

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
          <b style={{ color: "var(--foreground)" }}>This control is non-custodial and read-only in this build.</b> A pause halts{" "}
          <b style={{ color: "var(--foreground)" }}>new deposits &amp; agent execution only</b>; withdrawals (N2: withdraw-always) remain open at
          all times. Executing a pause/resume is an <b style={{ color: "var(--foreground)" }}>on-chain guardian action</b> performed off-app — this
          panel does not sign transactions.
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
              <span className="pill amber" style={{ fontSize: 10 }}>PAUSES</span> New deposits
            </span>
            <span className="muted" style={{ fontSize: 12 }}>halted on-chain</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill amber" style={{ fontSize: 10 }}>PAUSES</span> Agent / session-key execution
            </span>
            <span className="muted" style={{ fontSize: 12 }}>no new actions</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill amber" style={{ fontSize: 10 }}>PAUSES</span> AI swaps &amp; rebalances
            </span>
            <span className="muted" style={{ fontSize: 12 }}>blocked</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill ok" style={{ fontSize: 10 }}>STAYS OPEN</span> User withdrawals
            </span>
            <span style={{ color: "var(--gain)", fontSize: 12, fontWeight: 600 }}>always</span>
          </div>
          <div className="statusrow">
            <span>
              <span className="pill ok" style={{ fontSize: 10 }}>STAYS OPEN</span> On-chain self-service exit
            </span>
            <span style={{ color: "var(--gain)", fontSize: 12, fontWeight: 600 }}>always</span>
          </div>
        </div>
        <div className="panel">
          <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="ct">Governance</span>
            <span className="prov">on-chain guardian</span>
          </div>
          <div className="statusrow">
            <span className="muted">Guardian (live)</span>
            <a
              className="mono"
              style={{ fontSize: 11, color: "var(--primary)" }}
              href={`https://sepolia.basescan.org/address/${GUARDIAN_TIMELOCK}`}
              target="_blank"
              rel="noreferrer"
            >
              {GUARDIAN_TIMELOCK.slice(0, 6)}…{GUARDIAN_TIMELOCK.slice(-4)} <Icon name="ext" size={11} />
            </a>
          </div>
          <div className="statusrow">
            <span className="muted">Type</span>
            <span style={{ fontWeight: 600 }}>OZ TimelockController</span>
          </div>
          <div className="statusrow">
            <span className="muted">2-of-3 Safe + delay</span>
            <span className="pill info" style={{ fontSize: 10 }}>Phase 3</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            A multi-signer Safe in front of the timelock (with a mandatory delay + admin renounce) is the
            Phase-3 hardening step; today the deployer holds the timelock proposer/executor roles.
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16, borderColor: "color-mix(in srgb,var(--caution) 30%,transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Initiate emergency pause</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 520, lineHeight: 1.5 }}>
              Executing a pause is an on-chain guardian (timelock) action performed off-app. This panel does not
              sign transactions — wiring the guardian action here is tracked for Phase 3. Withdrawals stay open throughout.
            </div>
          </div>
          <button
            className="btn-exp"
            disabled
            aria-disabled="true"
            title="Guardian action performed off-app — not wired into this panel"
            style={{ fontSize: 13.5, padding: "11px 18px", opacity: 0.55, cursor: "not-allowed" }}
          >
            <Icon name="pause" size={14} /> Guardian action — off-app
          </button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ch" style={{ marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="ct">Kill-switch history</span>
          <span className="prov">no on-chain actions in this environment</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          No pause/resume has been executed against the guardian in this environment. On-chain kill-switch
          actions will be listed here (from the guardian&rsquo;s events) once the panel is wired.
        </div>
      </div>
    </>
  );
}
