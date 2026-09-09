"use client";

/**
 * 035 — the original /admin/tvl screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → TVL & vault — the "money view", now LIVE on-chain (was 100% sample data).
 *
 * Every figure is read directly from the deployed Base-Sepolia `SparkPointVault`:
 *   TVL = totalAssets(), cap = depositCap(), utilization = TVL/cap, plus the live pause + guardian.
 * There are NO fabricated numbers and — critically — NO fabricated SAFETY state: the kill-switch and
 * guardian tiles reflect the real chain (previously a static "Inactive"/"Healthy" that could mislead an
 * operator). Values still resolving render as "…", never a fake zero. Display-only — never a fund gate.
 */

import { Icon } from "@/lib/icons";
import { Kpi } from "@/components/admin/charts";
import { useVaultStats, VAULT_CHAIN } from "@/lib/admin/useVaultStats";
import { formatUsdCompact, shortAddr } from "@/lib/admin/vaultStats";

export function VaultOverviewPanel() {
  const s = useVaultStats();

  const tvl = formatUsdCompact(s.tvl);
  const cap = s.cap === undefined ? "…" : s.cap === 0n ? "No cap set" : formatUsdCompact(s.cap);
  const headroom = s.cap === 0n ? "Unlimited" : formatUsdCompact(s.headroom);
  const util = s.capUtilPct === null ? "—" : `${s.capUtilPct.toFixed(1)}%`;
  const utilBar = s.capUtilPct === null ? 0 : Math.min(100, Math.max(0, s.capUtilPct));

  const statusPill = !s.configured
    ? { cls: "amber", text: "Vault not configured" }
    : s.loading
      ? { cls: "info", text: "Reading chain…" }
      : { cls: "ok", text: "Live · on-chain" };

  return (
    <>
      <div className="pghead">
        <div>
          <h1>TVL &amp; vault</h1>
          <div className="sub">The money view — on-chain truth. Display-only, never a gate.</div>
        </div>
        <span className={`pill ${statusPill.cls}`}>
          <span className="led" /> {statusPill.text}
        </span>
      </div>

      {!s.configured ? (
        <div className="panel" style={{ marginTop: 4 }}>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            <Icon name="info" size={14} /> No vault address is configured for this deployment, so there is nothing to
            read on-chain. Figures appear here once the vault is set in the address book.
          </div>
        </div>
      ) : null}

      <div className="band">
        <Kpi label="Total TVL" val={tvl} />
        <Kpi label="Cap utilization" val={util} />
        <Kpi label="Vault deposit cap" val={cap} />
        <Kpi label="Headroom remaining" val={headroom} />
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="ct">Caps &amp; utilization</span>
            <span className="prov">live · totalAssets / depositCap</span>
          </div>
          <div style={{ margin: "4px 0 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
              <span className="muted">Cap utilization</span>
              <span className="tnum">{util}</span>
            </div>
            <div style={{ height: 18, borderRadius: 5, background: "var(--muted)" }}>
              <div
                style={{
                  height: "100%",
                  borderRadius: 5,
                  width: `${utilBar}%`,
                  background: utilBar >= 90 ? "var(--caution)" : "var(--gain)",
                  transition: "width .3s ease",
                }}
              />
            </div>
          </div>
          <div className="statusrow">
            <span className="muted">Total value locked</span>
            <span className="tnum" style={{ fontWeight: 600 }}>{tvl}</span>
          </div>
          <div className="statusrow">
            <span className="muted">Deposit cap</span>
            <span className="tnum">{cap}</span>
          </div>
          <div className="statusrow">
            <span className="muted">Headroom remaining</span>
            <span className="tnum">{headroom}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
            <Icon name="info" size={13} /> Caps are enforced programmatically on-chain (ERC-4626 <span className="mono">maxDeposit</span>);
            the operator adjusts them via the guardian <span className="mono">setCaps</span> action on the Vaults page.
          </div>
        </div>

        <div className="panel">
          <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="ct">Safety — live on-chain</span>
            <span className="prov">paused() · guardian()</span>
          </div>
          <div className="statusrow">
            <span className="muted">Kill-switch (pause-only)</span>
            {s.paused === undefined ? (
              <span className="pill info" style={{ fontSize: 10 }}>
                <Icon name="info" size={12} /> Reading chain…
              </span>
            ) : s.paused ? (
              <span className="pill amber" style={{ fontSize: 10 }}>
                <Icon name="pause" size={12} /> Paused · deposits halted
              </span>
            ) : (
              <span className="pill ok" style={{ fontSize: 10 }}>
                <span className="led" /> Inactive · deposits open
              </span>
            )}
          </div>
          <div className="statusrow">
            <span className="muted">User withdrawals</span>
            <span style={{ color: "var(--gain)", fontSize: 12, fontWeight: 600 }}>Always open (N2)</span>
          </div>
          <div className="statusrow">
            <span className="muted">Guardian (live)</span>
            {s.guardian ? (
              <a
                className="mono"
                style={{ fontSize: 11, color: "var(--primary)" }}
                href={`https://sepolia.basescan.org/address/${s.guardian}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(s.guardian)} <Icon name="ext" size={11} />
              </a>
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>reading…</span>
            )}
          </div>
          <div className="statusrow">
            <span className="muted">Guardian type</span>
            <span style={{ fontWeight: 600, fontSize: 12 }}>OZ TimelockController</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
            <Icon name="info" size={13} /> A pause never blocks withdrawals and is a guardian (multisig) action performed
            off-app. Status only — no controls on this page. Reads refresh every 30s from chain {VAULT_CHAIN}.
          </div>
        </div>
      </div>
    </>
  );
}
