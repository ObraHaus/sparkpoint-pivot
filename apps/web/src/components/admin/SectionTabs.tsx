"use client";

/**
 * 035 — one console, several sections. The shape 032 introduced for `/admin/knowledge`, extracted
 * so the other three consoles are the same thing rather than three lookalikes.
 *
 * WHY CONSOLES AT ALL. The nav had nineteen entries, and most of them were one screen each. An
 * admin looking for the kill-switch had to know it was not under System; someone checking a user's
 * tier had to know that lived under "Limits & Tiers" rather than "Users". Grouping the screens that
 * are read together turns "which page was that on?" into "which tab?", which is a question you can
 * answer by looking.
 *
 * WHAT THIS COMPONENT GUARANTEES, so each console does not have to remember:
 *
 *   * **Every section is deep-linkable** via `?section=`. That is what lets the old routes survive
 *     as redirects and keeps existing bookmarks working — nothing an admin wrote down goes dead.
 *   * **Each tab says what it is.** A one-line hint under the tab strip, because a merged console
 *     hides things that used to be visible in the nav, and a label alone often is not enough.
 *   * **An unknown `?section=` falls back to the first tab** rather than rendering nothing. A stale
 *     link should land somewhere useful, not on a blank page.
 *
 * ⚠️ The tab buttons carry `role="tab"`, which OVERRIDES the implicit button role — in tests,
 * `getByRole("button")` will not find them. That cost a debugging round in 032.
 */

import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

export interface AdminSection {
  /** Stable, url-safe: this is what `?section=` carries and what bookmarks depend on. */
  readonly id: string;
  readonly label: string;
  /** One line, under the tabs. What this section is, in an admin's terms. */
  readonly hint: string;
  readonly render: () => ReactNode;
}

/**
 * The console. Wrap in nothing — it brings its own Suspense boundary, which `useSearchParams`
 * requires in the App Router and which is easy to forget until a production build fails.
 */
export function AdminSections({ sections }: { sections: readonly AdminSection[] }) {
  return (
    <Suspense fallback={<div style={{ padding: 24, opacity: 0.7 }}>Loading…</div>}>
      <Sections sections={sections} />
    </Suspense>
  );
}

function Sections({ sections }: { sections: readonly AdminSection[] }) {
  const params = useSearchParams();
  const requested = params.get("section");
  const known = sections.some((s) => s.id === requested);
  const [tab, setTab] = useState<string>(known && requested ? requested : sections[0].id);

  const active = sections.find((s) => s.id === tab) ?? sections[0];

  return (
    <>
      <div
        style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}
        role="tablist"
        aria-label="Console section"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === active.id}
            onClick={() => setTab(s.id)}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border:
                s.id === active.id
                  ? "1px solid var(--accent, #6a8bff)"
                  : "1px solid var(--border-soft)",
              background:
                s.id === active.id ? "var(--accent, #6a8bff)" : "var(--surface-2, rgba(127,127,127,.12))",
              color: s.id === active.id ? "#fff" : "var(--foreground)",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, opacity: 0.75, marginBottom: 16 }}>{active.hint}</div>
      {active.render()}
    </>
  );
}
