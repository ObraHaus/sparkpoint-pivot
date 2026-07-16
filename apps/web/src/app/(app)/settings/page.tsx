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
import { useOverlay } from "@/components/overlays/OverlayProvider";
import "@/components/screens/support.css";

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

export default function Page() {
  const router = useRouter();
  const { toast } = useOverlay();
  const { resolvedTheme, setTheme } = useTheme();
  const { wallet } = useNetwork();
  const [tab, setTab] = useState<Tab>("account");
  const [density, setDensity] = useState<"Comfortable" | "Compact">("Comfortable");

  const isLight = resolvedTheme === "light";

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
        </div>
        <button
          className="btn btn-ghost btn-md"
          onClick={() => {
            toast("Logged out — funds untouched");
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
                onClick={() => {
                  toast("Disconnected — funds untouched");
                  router.push(toHref("landing"));
                }}
              >
                <Icon name="logout" size={15} /> Disconnect
              </button>
            </div>
          </>
        )}

        {tab === "mandate" && (
          <>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Risk tier</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Lower · 1/5 · capital-preservation-first
                </div>
              </div>
              <RiskChip tier={1} />
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Goal</div>
              </div>
              <span>Steady USDC yield</span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Timeline</div>
              </div>
              <span>1–3 years</span>
            </div>
            <div className="setrow">
              <div>
                <div style={{ fontWeight: 600 }}>Edit your plan</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Re-runs the review &amp; confirm steps.
                </div>
              </div>
              <Link className="btn btn-primary btn-md" href="/onboarding">
                Edit mandate
              </Link>
            </div>
          </>
        )}

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
