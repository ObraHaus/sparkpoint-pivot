"use client";

/**
 * /changelog — the live "What's new" feed for the always-hot Alpha. Admin-curated entries
 * (GET /content/changelog) render newest-first with a New/Fixed/Improved tag + date. Offline
 * (no wallet) or empty shows an honest connect/empty state — never mock. Inherits the (app) shell
 * + beta gate via the route group.
 */

import { Icon } from "@/lib/icons";
import { StatusTag } from "@/components/ui/status-tag";
import { useChangelog, type ContentEntry } from "@/lib/agent/useContent";

const TAG_TINT: Record<string, string> = {
  New: "var(--gain)",
  Improved: "var(--info)",
  Fixed: "var(--caution)",
  Announcement: "var(--primary)",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Cta({ label, href }: { label: string; href: string }) {
  if (href.startsWith("https://")) {
    return (
      <a className="tipcard-cta" href={href} target="_blank" rel="noopener noreferrer">
        {label} <Icon name="ext" size={11} />
      </a>
    );
  }
  return (
    <a className="tipcard-cta" href={href}>
      {label} <Icon name="chevr" size={12} />
    </a>
  );
}

function EntryCard({ entry }: { entry: ContentEntry }) {
  const tint = entry.tag ? (TAG_TINT[entry.tag] ?? "var(--muted-foreground)") : null;
  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        {entry.tag && tint && (
          <span
            className="pill"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: tint,
              borderColor: `color-mix(in srgb, ${tint} 40%, transparent)`,
              background: `color-mix(in srgb, ${tint} 12%, transparent)`,
            }}
          >
            {entry.tag}
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {fmtDate(entry.publishedAt)}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{entry.title}</div>
      <div
        style={{
          fontSize: 13.5,
          color: "var(--muted-foreground)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {entry.body}
      </div>
      {entry.ctaLabel && entry.ctaHref && (
        <div style={{ marginTop: 10 }}>
          <Cta label={entry.ctaLabel} href={entry.ctaHref} />
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const { entries, online, loading } = useChangelog();
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            What&apos;s new <StatusTag variant="live" />
          </h1>
          <div className="sub">Every update we ship to the Alpha — newest first.</div>
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
