"use client";

/**
 * /trust — Trust Center hub: five structural guarantees, live status, beta caps,
 * audits & addresses, and the exit / automation entry points.
 *
 * Faithful 1:1 port of the design's `trust` screen
 * (docs/design-handover/showcase/screens/trust.js). Markup, classes, copy, and the
 * GUARANTEES list are reproduced verbatim; figures read from data.vault.
 */

import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";

const GUARANTEES: [IconName, string, string][] = [
  [
    "shieldcheck",
    "No admin withdrawal",
    "We have no code path to send your funds anywhere but back to you — not us, not anyone.",
  ],
  ["door", "Withdraw-always", "Exit directly on-chain, even if Sparky's app and AI are completely offline."],
  [
    "key",
    "You own your keys",
    "You own your keys and your account. We never generate a wallet for you or hold your keys.",
  ],
  [
    "zap",
    "Scoped, revocable automation",
    "Any automation you grant is scoped, capped, time-limited, and revocable by you instantly — without our help.",
  ],
  [
    "pause",
    "Non-upgradeable, pause-only",
    "The vault is single-purpose and non-upgradeable. Any pause control governs pausing only — never your funds.",
  ],
];

export default function Page() {
  const router = useRouter();

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Trust Center</h1>
          <div className="sub">Fully self-custodial — your keys, your funds, always. Proven, not promised.</div>
        </div>
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("trust/permissions"))}>
          <Icon name="shieldcheck" size={16} /> Prove it
        </button>
      </div>
      <div className="trust-grid" style={{ marginBottom: 18 }}>
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Five structural guarantees</span>
          </div>
          {GUARANTEES.map((g) => (
            <div className="guarantee" key={g[1]}>
              <span className="gico">
                <Icon name={g[0]} size={18} />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{g[1]}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, marginTop: 3 }}>
                  {g[2]}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Status</span>
            </div>
            <div className="statusrow">
              <span className="muted">Custody invariants</span>
              <span style={{ color: "var(--gain)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="check" size={14} /> All nominal
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Kill-switch</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                <Icon name="pause" size={14} /> Pause-only · inactive
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Whitelist (beta)</span>
              <span style={{ color: "var(--gain)", fontWeight: 600 }}>Passed</span>
            </div>
            <div className="statusrow">
              <span className="muted">Network</span>
              <span style={{ fontWeight: 600 }}>Base</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.5 }}>
              <Icon name="info" size={13} /> The kill-switch can pause <b>new</b> deposits in an emergency. It can never
              block your withdrawals.
            </div>
          </div>
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Your beta caps</span>
            </div>
            <div className="statusrow">
              <span className="muted">Per-user cap</span>
              <span className="tnum">
                {money(data.vault.capUsed, 0)} / {money(data.vault.capUser, 0)}
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Vault TVL cap</span>
              <span className="tnum">
                ${data.vault.tvl}M / ${data.vault.tvlCap}M
              </span>
            </div>
          </div>
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">Audits &amp; addresses</span>
            </div>
            <div className="statusrow">
              <span className="muted">Vault contract</span>
              <span className="mono" style={{ fontSize: 12 }}>
                0x9f…2C1 <Icon name="ext" size={11} />
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Policy module</span>
              <span className="mono" style={{ fontSize: 12 }}>
                0x3a…77B <Icon name="ext" size={11} />
              </span>
            </div>
            <div className="statusrow">
              <span className="muted">Audit</span>
              <span style={{ fontWeight: 600, display: "inline-flex", gap: 5, alignItems: "center" }}>
                <Icon name="shieldcheck" size={13} /> Spearbit ↗
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Exit anytime</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
            The self-service exit works even if Sparky is entirely offline.
          </div>
        </div>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/exit"))}>
          <Icon name="door" size={16} /> Withdraw / Exit
        </button>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("automation"))}>
          <Icon name="zap" size={16} /> Automation
        </button>
      </div>
    </div>
  );
}
