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

type Tab = "account" | "mandate" | "notifications" | "appearance" | "security";

const SETTABS: [Tab, string][] = [
  ["account", "Account"],
  ["mandate", "Mandate"],
  ["notifications", "Notifications"],
  ["appearance", "Appearance"],
  ["security", "Security"],
];

const NOTIF_LABELS = [
  "Transaction results",
  "Rate changes & recommendations",
  "Caps near limit",
  "Session-key expiry",
  "Outcome updates",
];

/** A standalone toggle switch mirroring the design's `.switch` with `[data-sw]` toggle behavior. */
function Switch({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return <button className={"switch" + (on ? " on" : "")} onClick={() => setOn((v) => !v)} />;
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
  const [density, setDensity] = useState<"Comfortable" | "Compact">("Comfortable");

  const isLight = resolvedTheme === "light";

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>Settings <StatusTag variant="partial" works={["Your mandate (risk + slippage) is real and drives recommendations"]} pending={["Notification / display preferences aren’t persisted yet"]} /></h1>
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

        {tab === "notifications" &&
          NOTIF_LABELS.map((l, i) => (
            <div className="setrow" key={l}>
              <div style={{ fontWeight: 600 }}>{l}</div>
              <Switch defaultOn={i < 3} />
            </div>
          ))}

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
                  className={density === "Comfortable" ? "active" : ""}
                  onClick={() => setDensity("Comfortable")}
                >
                  Comfortable
                </button>
                <button className={density === "Compact" ? "active" : ""} onClick={() => setDensity("Compact")}>
                  Compact
                </button>
              </div>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Reduced motion</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Follows your system setting.
                </div>
              </div>
              <Switch />
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
