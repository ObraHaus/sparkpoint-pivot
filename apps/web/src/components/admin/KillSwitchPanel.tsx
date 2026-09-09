"use client";

/**
 * 035 — the original /admin/killswitch screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → Emergency kill-switch (status + honest read-only control).
 *
 * Pausing is a NON-CUSTODIAL, pause-only power governed ON-CHAIN by the vault's guardian (the OZ
 * TimelockController), whose proposer/executor/canceller + admin roles are now held by a dedicated
 * 2-of-3 Gnosis Safe (the deployer FULLY RENOUNCED, 2026-07-24). It can halt new execution — it can
 * NEVER touch user funds or block withdrawals (N2).
 *
 * This panel is READ-ONLY: it does not (and must not) sign. Executing a pause/resume is a 2-of-3 Safe
 * action (prepare the timelock calldata on the Vaults page → 2 signers co-sign in the Safe). The
 * governance shown below is REAL (live on-chain reads + the recorded Safe controller), not illustrative.
 *
 * Phase B: the pause STATE + the guardian are now LIVE on-chain reads (the vault's `paused()` /
 * `guardian()`), so the status pill reflects the real chain — never a hardcoded default.
 */

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { Icon } from "@/lib/icons";

/** The vault lives on Base Sepolia (84532); read there regardless of the connected chain. */
const VAULT_CHAIN = 84532;
/** Fallback guardian (used only until the live read resolves). */
const GUARDIAN_FALLBACK = "0x0A21A9B4c2cd2d6a68EC828188826B673572d720";

export function KillSwitchPanel() {
  const vault = getAddresses(VAULT_CHAIN).vault as Address | undefined;
  const govSafe = getAddresses(VAULT_CHAIN).governanceSafe as Address | undefined;
  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;
  const reads = useReadContracts({
    query: { enabled: !!vault, refetchInterval: 30_000 },
    contracts: [
      { ...vaultC, functionName: "paused" }, // 0
      { ...vaultC, functionName: "guardian" }, // 1
    ],
  });
  // LIVE pause state — undefined while the read is in flight (shown as "…"), never a fake default.
  const paused = reads.data?.[0]?.result as boolean | undefined;
  const guardian = (reads.data?.[1]?.result as string | undefined) ?? GUARDIAN_FALLBACK;

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Emergency kill-switch</h1>
          <div className="sub">Multisig-governed, pause-only. It can halt new execution — it can never touch user funds or block withdrawals.</div>
        </div>
        <span className={`pill ${paused ? "amber" : "info"}`}>
          <span className="led" />
          {paused === undefined ? "Reading chain…" : paused ? "Paused · new deposits halted" : "Pause-only · inactive"}
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
              href={`https://sepolia.basescan.org/address/${guardian}`}
              target="_blank"
              rel="noreferrer"
            >
              {guardian.slice(0, 6)}…{guardian.slice(-4)} <Icon name="ext" size={11} />
            </a>
          </div>
          <div className="statusrow">
            <span className="muted">Type</span>
            <span style={{ fontWeight: 600 }}>OZ TimelockController</span>
          </div>
          <div className="statusrow">
            <span className="muted">Controller (2-of-3 Safe)</span>
            {govSafe ? (
              <a
                className="mono"
                style={{ fontSize: 11, color: "var(--primary)" }}
                href={`https://sepolia.basescan.org/address/${govSafe}`}
                target="_blank"
                rel="noreferrer"
              >
                {govSafe.slice(0, 6)}…{govSafe.slice(-4)} <Icon name="ext" size={11} />
              </a>
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>—</span>
            )}
          </div>
          <div className="statusrow">
            <span className="muted">2-of-3 Safe + delay</span>
            <span className="pill ok" style={{ fontSize: 10 }}>
              <span className="led" /> Live
            </span>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            The timelock&rsquo;s proposer/executor/canceller + admin roles are held by a dedicated <b>2-of-3 Gnosis
            Safe</b> — the deployer has <b>fully renounced</b>. No single key can pause the vault or change fees/caps;
            only 2-of-3 of the guardian signers can, after the timelock delay. Proven on-chain by a pause→unpause
            round-trip at the cutover.
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16, borderColor: "color-mix(in srgb,var(--caution) 30%,transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Initiate emergency pause</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 560, lineHeight: 1.5 }}>
              A pause is a <b>2-of-3 guardian Safe</b> action: prepare the timelock calldata on the Vaults page, then
              <b> 2 of the 3</b> guardian signers co-sign it in the Safe. This monitoring panel never signs — deliberately
              (a fund-safety control belongs behind the multisig, not a one-click web button). Withdrawals stay open throughout (N2).
            </div>
          </div>
          <a
            className="btn-exp"
            href="/admin/vaults"
            title="Prepare the pause (timelock schedule+execute calldata) on the Vaults page, then co-sign 2-of-3 in the Safe"
            style={{ fontSize: 13.5, padding: "11px 18px", textDecoration: "none" }}
          >
            <Icon name="pause" size={14} /> Prepare pause → Vaults
          </a>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ch" style={{ marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="ct">Kill-switch history</span>
          <span className="prov">from guardian events</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          The 2-of-3 guardian Safe executed a verification pause→unpause round-trip during the governance cutover.
          A live event feed of pause/unpause actions is not yet wired into this panel; for now, the guardian
          timelock and Safe are auditable directly on Basescan.
        </div>
      </div>
    </>
  );
}
