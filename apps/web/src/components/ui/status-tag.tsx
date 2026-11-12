"use client";

/**
 * StatusTag — the one honest data-provenance chip (R5 A4). Every screen that shows real, partial,
 * or mock data wears one, so a client can never mistake showcase data for live state.
 *
 *   live    — everything on this surface is real (on-chain / server).
 *   partial — some values are real, some are still placeholders; click for a "what works / what's
 *             pending" popover so the exact split is explicit.
 *   mock    — showcase/mock data; not wired to anything real yet.
 *
 * Purely informational. Never gates anything.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export type StatusVariant = "live" | "partial" | "mock";

const COPY: Record<StatusVariant, { label: string; color: string }> = {
  live: { label: "Live", color: "var(--gain)" },
  partial: { label: "Partial data", color: "var(--caution)" },
  mock: { label: "Preview data", color: "var(--caution)" },
};

export interface StatusTagProps {
  variant: StatusVariant;
  /** Override the default label. */
  label?: string;
  /** Hover title. */
  title?: string;
  /** For `partial`: what's real on this screen (shown in the popover). */
  works?: ReactNode[];
  /** For `partial`/`mock`: what's still a placeholder (shown in the popover). */
  pending?: ReactNode[];
}

export function StatusTag({ variant, label, title, works, pending }: StatusTagProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const copy = COPY[variant];
  const hasPopover = (works?.length ?? 0) > 0 || (pending?.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span
        className="pill"
        title={title ?? (hasPopover ? "What works on this screen — click for details" : undefined)}
        onClick={hasPopover ? () => setOpen((o) => !o) : undefined}
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: copy.color,
          borderColor: `color-mix(in srgb, ${copy.color} 40%, transparent)`,
          background: `color-mix(in srgb, ${copy.color} 10%, transparent)`,
          cursor: hasPopover ? "pointer" : "default",
          gap: 5,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: copy.color, flex: "none" }} />
        {label ?? copy.label}
        {hasPopover && <span style={{ opacity: 0.6, fontSize: 9 }}>ⓘ</span>}
      </span>

      {open && hasPopover && (
        <span
          role="dialog"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 40,
            width: 260,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border-soft)",
            background: "var(--surface, var(--background))",
            boxShadow: "0 8px 28px rgba(0,0,0,.22)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--foreground)",
            textAlign: "left",
            whiteSpace: "normal",
            cursor: "default",
          }}
        >
          {(works?.length ?? 0) > 0 && (
            <>
              <div style={{ fontWeight: 700, color: "var(--gain)", marginBottom: 4 }}>Works now</div>
              <ul style={{ margin: "0 0 8px", paddingLeft: 16 }}>
                {works!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          {(pending?.length ?? 0) > 0 && (
            <>
              <div style={{ fontWeight: 700, color: "var(--caution)", marginBottom: 4 }}>
                Coming soon
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {pending!.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </span>
      )}
    </span>
  );
}
