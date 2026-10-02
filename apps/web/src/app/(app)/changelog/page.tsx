"use client";

/**
 * /changelog — the live "What's new" feed for the always-hot Alpha. Entries (GET /content/changelog,
 * sourced from the committed content_seed/whats-new.json + any admin edits) render newest-first with
 * a New/Fixed/Improved tag + date. Offline (no wallet) or empty shows an honest connect/empty state —
 * never mock. Inherits the (app) shell + beta gate via the route group. The card is shared with the
 * WhatsNewModal (components/content/EntryCard).
 */

import { StatusTag } from "@/components/ui/status-tag";
import { EntryCard } from "@/components/content/EntryCard";
import { useChangelog } from "@/lib/agent/useContent";
import { stageCopy } from "@/lib/stage";

export default function Page() {
  const { entries, online, loading } = useChangelog();
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            What&apos;s new <StatusTag variant="live" />
          </h1>
          <div className="sub">Every update we ship to the {stageCopy.label} — newest first.</div>
        </div>
      </div>
      {loading && (
        <div className="card card-pad" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </div>
      )}
      {!loading && entries.length === 0 && (
        <div className="card card-pad" style={{ color: "var(--muted-foreground)" }}>
          {online ? "No updates yet — check back soon." : "Connect your wallet to see what's new."}
        </div>
      )}
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
