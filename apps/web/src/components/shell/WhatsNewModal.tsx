"use client";

/**
 * WhatsNewModal (feature 006, US3). Greets the user with what changed since they were last here —
 * right after an update-driven reload, and for a returning user whose last-seen marker is older than
 * the newest changelog entry. On the FIRST flag-on visit (no marker yet — a brand-new user OR one who
 * was active before this feature shipped) it greets ONCE with the most recent few entries (capped, a
 * welcome — not the whole backlog); every visit after shows only entries newer than the marker. It
 * opens ONLY when there is genuinely something to show (never a blank modal), only on authenticated
 * app routes (the changelog is beta-gated). Content only, never custody (N2).
 *
 * "Newer than last-seen" is keyed to the changelog entry id (monotonic), NOT the build version — so
 * an infra-only deploy that added no entry shows nothing after the first visit, and a deploy that
 * shipped a client entry greets automatically. Visibility is fully derived in render; the marker is
 * written only on acknowledge (gotIt → useLocalState, an external store, not React setState).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { env } from "@/lib/env";
import { Icon } from "@/lib/icons";
import { useChangelog } from "@/lib/agent/useContent";
import { useLocalState } from "@/lib/ui/useLocalState";
import { EntryCard } from "@/components/content/EntryCard";

// Routes where the greeting must NOT auto-open: the landing/auth funnel, the escape hatches (/exit,
// /trust — N2), admin, onboarding, and /changelog itself (they're already looking at it).
const BLOCKED = [
  "/",
  "/connect",
  "/verify",
  "/coming-soon",
  "/geo-blocked",
  "/onboarding",
  "/exit",
  "/trust",
  "/admin",
  "/changelog",
];

function isAppRoute(pathname: string): boolean {
  return !BLOCKED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// The FIRST flag-on visit greets with at most this many recent entries — a bounded welcome, not the
// whole backlog. Every later visit shows only entries newer than the last-seen marker.
const FIRST_VISIT_CAP = 4;

export function WhatsNewModal() {
  const { entries, online, loading } = useChangelog();
  const [lastSeen, setLastSeen] = useLocalState<number | null>("sp-app-version-seen", null);
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();

  // Dormant until the feature-006 flag is on (ships with the banner in Phase 7), so nothing greets
  // until the auto-experience is deliberately enabled.
  const enabled = env.forceRefresh;
  const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : null;
  const ready = enabled && online && !loading && maxId !== null;

  // What to show:
  //  • FIRST flag-on visit (no marker yet — a brand-new user OR someone who was active before this
  //    feature existed): the most recent few entries, capped, as a one-time welcome.
  //  • Every later visit: only the entries newer than the last-seen marker.
  // `entries` arrive newest-first (published_at DESC) from the API. Clicking "Got it"/close (gotIt)
  // writes the marker to the latest id, so the first-run greeting never repeats once acknowledged.
  const fresh = !ready
    ? []
    : lastSeen === null
      ? entries.slice(0, FIRST_VISIT_CAP)
      : entries.filter((e) => e.id > lastSeen).slice(0, 8);
  const hasNew = fresh.length > 0;
  const show = hasNew && !dismissed && isAppRoute(pathname);

  function gotIt() {
    if (maxId !== null) setLastSeen(maxId);
    setDismissed(true);
  }

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={gotIt}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        display: "grid",
        placeItems: "center",
        background: "rgba(5,9,18,.72)",
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--popover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: "var(--primary)", display: "inline-flex" }}>
            <Icon name="spark" size={18} />
          </span>
          <div style={{ fontSize: 15, fontWeight: 640 }}>What&apos;s new</div>
          <button
            aria-label="Close"
            onClick={gotIt}
            className="iconbtn"
            style={{ marginLeft: "auto", background: "transparent", border: 0, cursor: "pointer", color: "var(--muted-foreground)" }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ padding: "12px 14px 2px", overflowY: "auto" }}>
          {fresh.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-soft)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <a className="tipcard-cta" href="/changelog" onClick={gotIt}>
            See full changelog <Icon name="chevr" size={12} />
          </a>
          <button className="btn btn-primary btn-sm" onClick={gotIt}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
