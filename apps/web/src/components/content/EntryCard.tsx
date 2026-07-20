"use client";

/**
 * Shared changelog entry card (feature 006). Lifted from app/(app)/changelog/page.tsx so both the
 * /changelog page and the WhatsNewModal render entries identically. Content only, never custody (N2).
 */

import { Icon } from "@/lib/icons";
import { type ContentEntry } from "@/lib/agent/useContent";

export const TAG_TINT: Record<string, string> = {
  New: "var(--gain)",
  Improved: "var(--info)",
  Fixed: "var(--caution)",
  Announcement: "var(--primary)",
};

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function Cta({ label, href }: { label: string; href: string }) {
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

export function EntryCard({ entry }: { entry: ContentEntry }) {
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
