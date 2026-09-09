/**
 * 032 — the updates panel, extracted from `/admin/updates` so the consolidated knowledge
 * console can render it as one of its five sections.
 *
 * The panel is unchanged: same API calls, same behaviour. Only its mount point moved, and
 * `/admin/updates` still resolves (it now redirects into the console) so every existing
 * bookmark and every link in the nav keeps working.
 */
"use client";

/**
 * Admin → Updates — author the live changelog + the sidebar announcement (Alpha).
 *
 * ONE surface for both: type='changelog' rows feed /changelog; the newest active
 * type='announcement' row is the sidebar widget banner. Admin-gated via the same-origin BFF
 * (/api/agent/admin/content*): a non-admin gets 404. Reads are GET; every mutation is a POST (the
 * BFF forwards only GET/POST). ACCESS/content only — nothing here can move funds (N2).
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/lib/icons";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

const CHAIN_HEADERS = { "x-chain-id": APP_CHAIN_ID_HEADER };
const API = "/api/agent/admin/content";

type EntryType = "changelog" | "announcement";
type EntryTag = "New" | "Fixed" | "Improved";

interface Entry {
  id: number;
  type: EntryType;
  title: string;
  body: string;
  tag: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isActive: boolean;
  publishedAt: string;
  updatedAt: string;
  author?: string | null;
}
type Banner = { kind: "ok" | "err"; text: string } | null;

const BLANK = {
  id: null as number | null,
  type: "changelog" as EntryType,
  title: "",
  body: "",
  tag: "New" as EntryTag,
  cta_label: "",
  cta_href: "",
  is_active: true,
  published_at: "", // YYYY-MM-DD; empty = today on create / unchanged on edit
};

const isoDate = (iso: string): string => (iso ? iso.slice(0, 10) : "");
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

export function UpdatesPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await getJSON<{ entries: Entry[] }>("");
      setEntries(list.entries ?? []);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const edit = (e: Entry) => {
    setForm({
      id: e.id,
      type: e.type,
      title: e.title,
      body: e.body,
      tag: (e.tag as EntryTag) ?? "New",
      cta_label: e.ctaLabel ?? "",
      cta_href: e.ctaHref ?? "",
      is_active: e.isActive,
      published_at: isoDate(e.publishedAt),
    });
    setBanner(null);
  };
  const clear = () => {
    setForm({ ...BLANK });
    setBanner(null);
  };

  const save = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        title: form.title.trim(),
        body: form.body.trim(),
        is_active: form.is_active,
      };
      if (form.id !== null) payload.id = form.id;
      if (form.type === "changelog") payload.tag = form.tag;
      if (form.cta_label.trim() && form.cta_href.trim()) {
        payload.cta_label = form.cta_label.trim();
        payload.cta_href = form.cta_href.trim();
      }
      if (form.published_at.trim()) payload.published_at = form.published_at.trim();
      const r = await fetch(API, {
        method: "POST",
        headers: { ...CHAIN_HEADERS, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(b.error?.message ?? `Save failed (${r.status}).`);
      }
      setBanner({ kind: "ok", text: form.id ? "Updated." : "Published." });
      clear();
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/delete`, {
        method: "POST",
        headers: { ...CHAIN_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`Delete failed (${r.status}).`);
      if (form.id === id) clear();
      setBanner({ kind: "ok", text: "Deleted." });
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Delete failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Updates</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Author the live changelog + the sidebar announcement. Testers see these instantly.
          </div>
        </div>
        <span className={`pill ${state === "loading" ? "info" : state === "ok" ? "ok" : "amber"}`}>
          <span className="led" /> {state === "loading" ? "Loading…" : state === "ok" ? "Live" : "Error"}
        </span>
      </div>

      {banner && (
        <div
          className="infobanner"
          style={{
            marginBottom: 12,
            background: banner.kind === "ok" ? "var(--gain-subtle)" : "var(--caution-subtle)",
            borderColor: `color-mix(in srgb, ${
              banner.kind === "ok" ? "var(--gain)" : "var(--caution)"
            } 26%, transparent)`,
          }}
        >
          {banner.text}
        </div>
      )}

      {/* Editor */}
      <div
        className="card card-pad"
        style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div className="ct">{form.id ? "Edit entry" : "New entry"}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={labelStyle}>
            Type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as EntryType })}
              style={inputStyle}
            >
              <option value="changelog">Changelog</option>
              <option value="announcement">Announcement</option>
            </select>
          </label>
          {form.type === "changelog" && (
            <label style={labelStyle}>
              Tag
              <select
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value as EntryTag })}
                style={inputStyle}
              >
                <option>New</option>
                <option>Improved</option>
                <option>Fixed</option>
              </select>
            </label>
          )}
          <label style={labelStyle}>
            Date {form.id ? "" : "(blank = today)"}
            <input
              type="date"
              value={form.published_at}
              onChange={(e) => setForm({ ...form, published_at: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 18 }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active (visible)
          </label>
        </div>
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={{ ...inputStyle, width: "100%" }}
        />
        <textarea
          placeholder="Body"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={4}
          style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            placeholder="CTA label (optional)"
            value={form.cta_label}
            onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="CTA link — /path or https:// (optional)"
            value={form.cta_href}
            onChange={(e) => setForm({ ...form, cta_href: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !form.title.trim() || !form.body.trim()}
            onClick={save}
          >
            <Icon name="check" size={14} /> {form.id ? "Save changes" : "Publish"}
          </button>
          {form.id !== null && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={clear}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="card card-pad">
        <div className="ct" style={{ marginBottom: 10 }}>
          All entries ({entries.length})
        </div>
        {entries.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            No entries yet.
          </div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 0",
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <span className="pill" style={{ fontSize: 10, fontWeight: 700 }}>
              {e.type}
            </span>
            <span
              className="muted"
              style={{ fontSize: 11, whiteSpace: "nowrap", paddingTop: 2, fontVariantNumeric: "tabular-nums" }}
            >
              {fmtDate(e.publishedAt)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {e.title}{" "}
                {!e.isActive && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    (hidden)
                  </span>
                )}
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.body}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => edit(e)}>
              <Icon name="settings" size={13} /> Edit
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              aria-label="Delete"
              onClick={() => del(e.id)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "var(--muted-foreground)",
};
const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
};
