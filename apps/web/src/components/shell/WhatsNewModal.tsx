"use client";

/**
 * What's New greeting (feature 006, US3; 061 A9).
 *
 * It used to be a MODAL with a full-screen scrim: on a returning user's first screen it blocked the
 * app until dismissed. Nothing about "here is what changed" justifies stopping someone opening the
 * vault, so it is now a NON-BLOCKING dismissible panel in the corner — no scrim, no focus trap, the
 * page behind it stays usable.
 *
 * "Once per release" is keyed to the newest entry's SLUG (see `lib/whatsNew.ts`) and persisted in
 * localStorage, so acknowledging a release does not resurface on the next visit or after a re-seed
 * that renumbers row ids. A brand-new user still gets a bounded welcome (never the whole backlog).
 *
 * It opens ONLY when there is genuinely something to show, only on authenticated app routes (the
 * changelog is beta-gated). Content only, never custody (N2).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { env } from "@/lib/env";
import { Icon } from "@/lib/icons";
import { useChangelog } from "@/lib/agent/useContent";
import { useLocalState } from "@/lib/ui/useLocalState";
import { EntryCard } from "@/components/content/EntryCard";
import { WHATS_NEW_SEEN_KEY, releaseKey, selectFreshEntries } from "@/lib/whatsNew";

// Routes where the greeting must NOT auto-open: the landing/auth funnel, the escape hatches (/exit,
// /trust — N2), admin, onboarding, and /changelog itself (they're already looking at it).
const BLOCKED = [
  "/",
  "/connect",
  "/verify",
  "/apply",
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

export function WhatsNewModal() {
  const { entries, online, loading } = useChangelog();
  const [seenSlug, setSeenSlug] = useLocalState<string | null>(WHATS_NEW_SEEN_KEY, null);
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();

  // Dormant until the feature-006 flag is on, so nothing greets until deliberately enabled.
  const enabled = env.forceRefresh;
  const ready = enabled && online && !loading && entries.length > 0;
  const fresh = ready ? selectFreshEntries(entries, seenSlug) : [];
  const newestSlug = entries[0] ? releaseKey(entries[0]) : null;
  const show = fresh.length > 0 && !dismissed && isAppRoute(pathname);

  function gotIt() {
    if (newestSlug) setSeenSlug(newestSlug);
    setDismissed(true);
  }

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <aside
      data-testid="whats-new"
      aria-label="What's new"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 110,
        width: "min(380px, calc(100vw - 24px))",
        maxHeight: "min(70vh, 520px)",
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
          padding: "13px 15px",
          borderBottom: "1px solid var(--border-soft)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ color: "var(--primary)", display: "inline-flex" }}>
          <Icon name="spark" size={18} />
        </span>
        <div style={{ fontSize: 14.5, fontWeight: 640 }}>What&apos;s new</div>
        <button
          aria-label="Dismiss what's new"
          onClick={gotIt}
          className="iconbtn"
          style={{ marginLeft: "auto", background: "transparent", border: 0, cursor: "pointer", color: "var(--muted-foreground)" }}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div style={{ padding: "10px 12px 2px", overflowY: "auto" }}>
        {fresh.map((entry) => (
          <EntryCard key={entry.id ?? entry.slug} entry={entry} />
        ))}
      </div>

      <div
        style={{
          padding: "10px 14px",
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
    </aside>,
    document.body,
  );
}
