"use client";

/**
 * /settings — tabbed settings: Account, Mandate, Notifications, Appearance, Security.
 * Risk profile, goals, alerts, connected wallet, and theme (wired to next-themes).
 *
 * Faithful 1:1 port of the design's `settings` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim;
 * the tab/switch/segment interactivity is reproduced with React state.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Icon } from "@/lib/icons";
import { useNetwork } from "@/lib/network";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/support.css";
import { StatusTag } from "@/components/ui/status-tag";
import { useMandate } from "@/lib/agent/useAgent";
import { useNotifPrefs, useDisplayPrefs } from "@/lib/settings/usePrefs";
import type { NotifKey } from "@/lib/settings/prefs";

type Tab = "account" | "mandate" | "notifications" | "appearance" | "security";

const SETTABS: [Tab, string][] = [
  ["account", "Account"],
  ["mandate", "Mandate"],
  ["notifications", "Notifications"],
  ["appearance", "Appearance"],
  ["security", "Security"],
];

const NOTIF_ROWS: { key: NotifKey; label: string }[] = [
  { key: "txResults", label: "Transaction results" },
  { key: "rateChanges", label: "Rate changes & recommendations" },
  { key: "capsNearLimit", label: "Caps near limit" },
  { key: "sessionKeyExpiry", label: "Session-key expiry" },
  { key: "outcomeUpdates", label: "Outcome updates" },
];

/** A controlled toggle mirroring the design's `.switch`. */
function Switch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      className={"switch" + (on ? " on" : "")}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

/** The Mandate tab — the user's REAL persisted plan (GET /agent/mandate), with honest
 * loading / empty / disconnected states. Replaces the former hardcoded tier-1 mock. */
function MandateTab() {
  const mandate = useMandate();

  if (mandate.status === "disconnected" || mandate.status === "loading") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Your plan</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {mandate.status === "loading" ? "Loading your plan…" : "Connect your wallet to see your mandate."}
          </div>
        </div>
        <span className="muted">—</span>
      </div>
    );
  }

  if (mandate.status === "error") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Your plan</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Couldn’t load your mandate just now.</div>
        </div>
        <Link className="btn btn-outline btn-md" href="/onboarding">Review plan</Link>
      </div>
    );
  }

  if (mandate.status === "empty") {
    return (
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>No plan yet</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Set your risk &amp; goals so recommendations fit you.</div>
        </div>
        <Link className="btn btn-primary btn-md" href="/onboarding">Set up mandate</Link>
      </div>
    );
  }

  const m = mandate.mandate;
  return (
    <>
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Risk tier</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{m.riskLabel} · {m.tier}/5 · {m.riskBlurb}</div>
        </div>
        <RiskChip tier={m.tier} />
      </div>
      <div className="setrow">
        <div><div style={{ fontWeight: 600 }}>Goal</div></div>
        <span>{m.goal}</span>
      </div>
      <div className="setrow">
        <div><div style={{ fontWeight: 600 }}>Timeline</div></div>
        <span>{m.timeline}</span>
      </div>
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Max slippage</div>
          <div className="muted" style={{ fontSize: 12.5 }}>The most price movement a move may accept.</div>
        </div>
        <span>{m.maxSlippageBps !== undefined ? `${(m.maxSlippageBps / 100).toFixed(2)}%` : "—"}</span>
      </div>
      <div className="setrow">
        <div>
          <div style={{ fontWeight: 600 }}>Edit your plan</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Re-runs the review &amp; confirm steps.</div>
        </div>
        <Link className="btn btn-primary btn-md" href="/onboarding">Edit mandate</Link>
      </div>
    </>
  );
}

export default function Page() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { wallet, disconnectWallet } = useNetwork();
  const [tab, setTab] = useState<Tab>("account");
  const { prefs: notif, setNotif } = useNotifPrefs();
  const { prefs: display, setDensity, setReducedMotion } = useDisplayPrefs();

  const isLight = resolvedTheme === "light";

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>Settings <StatusTag variant="partial" works={["Your mandate (risk + slippage) is real and drives recommendations", "Notification & display preferences are saved on this device", "Compact density and reduce-motion apply across the app"]} pending={["Notification delivery (email / push) isn’t wired yet — toggles record your intent"]} /></h1>
        </div>
        <button
          className="btn btn-ghost btn-md"
          onClick={async () => {
            await disconnectWallet();
            router.push(toHref("landing"));
          }}
        >
          <Icon name="logout" size={15} /> Log out
        </button>
      </div>
      <div className="settabs">
        {SETTABS.map((t) => (
          <div
            className={"settab " + (t[0] === tab ? "active" : "")}
            key={t[0]}
            onClick={() => setTab(t[0])}
          >
            {t[1]}
          </div>
        ))}
      </div>
      <div className="card card-pad">
        {tab === "account" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Connected wallet</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Smart account on Base
                </div>
              </div>
              <span className="mono">{wallet}</span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Network</div>
              </div>
              <span className="pill ghosty" style={{ cursor: "default" }}>
                Base
              </span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Disconnect</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Your funds are untouched — you can reconnect anytime.
                </div>
              </div>
              <button
                className="btn btn-outline btn-md"
                onClick={async () => {
                  await disconnectWallet();
                  router.push(toHref("landing"));
                }}
              >
                <Icon name="logout" size={15} /> Disconnect
              </button>
            </div>
          </>
        )}

        {tab === "mandate" && <MandateTab />}

        {tab === "notifications" && (
          <>
            {NOTIF_ROWS.map(({ key, label }) => (
              <div className="setrow" key={key}>
                <div style={{ fontWeight: 600 }}>{label}</div>
                <Switch on={notif[key]} onChange={(v) => setNotif(key, v)} />
              </div>
            ))}
            <div className="setrow">
              <div className="muted" style={{ fontSize: 12.5 }}>
                Saved on this device. Delivery (email / push) isn’t live in alpha — these set what you’ll get once it is.
              </div>
            </div>
          </>
        )}

        {tab === "appearance" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Theme</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Dark is the default canvas.
                </div>
              </div>
              <div className="seg">
                <button className={!isLight ? "active" : ""} onClick={() => setTheme("dark")}>
                  Dark
                </button>
                <button className={isLight ? "active" : ""} onClick={() => setTheme("light")}>
                  Light
                </button>
              </div>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Density</div>
              </div>
              <div className="seg">
                <button
                  className={display.density === "comfortable" ? "active" : ""}
                  onClick={() => setDensity("comfortable")}
                >
                  Comfortable
                </button>
                <button
                  className={display.density === "compact" ? "active" : ""}
                  onClick={() => setDensity("compact")}
                >
                  Compact
                </button>
              </div>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Reduce motion</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Fewer transitions &amp; animations on this device.
                </div>
              </div>
              <Switch on={display.reducedMotion} onChange={setReducedMotion} />
            </div>
          </>
        )}

        {tab === "security" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Active session keys</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  None — you sign every move.
                </div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("automation"))}>
                Manage
              </button>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>View exact permissions</div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/permissions"))}>
                <Icon name="shieldcheck" size={15} /> Prove it
              </button>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Withdraw / Exit</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Always available, even if we&apos;re offline.
                </div>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("trust/exit"))}>
                <Icon name="door" size={15} /> Exit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
