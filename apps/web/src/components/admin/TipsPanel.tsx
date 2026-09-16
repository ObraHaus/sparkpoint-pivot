/**
 * 032 — the tips panel, extracted from `/admin/tips` so the consolidated knowledge
 * console can render it as one of its five sections.
 *
 * The panel is unchanged: same API calls, same behaviour. Only its mount point moved, and
 * `/admin/tips` still resolves (it now redirects into the console) so every existing
 * bookmark and every link in the nav keeps working.
 */
"use client";

/**
 * Admin → Tips — manage the sidebar tip widget's databank (the Obsidian 'tip' corpus).
 *
 * Each tip is a short note (title + body + optional CTA + active flag) stored under
 * source_kind='tip' via /api/agent/admin/tips*. Admin-gated (non-admin → 404); reads GET, writes
 * POST (the BFF forwards only GET/POST). A save re-embeds the note with the real provider (503 if
 * unset — never a stub). "Restore defaults" re-ingests the shipped seed tips. ACCESS only (N2).
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/lib/icons";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

const CHAIN_HEADERS = { "x-chain-id": APP_CHAIN_ID_HEADER };
const API = "/api/agent/admin/tips";

interface Tip {
  source: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  active: boolean;
}
type Banner = { kind: "ok" | "err"; text: string } | null;

const BLANK = {
  source: null as string | null,
  title: "",
  body: "",
  cta_label: "",
  cta_href: "",
  active: true,
};

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/** Map a mutating response to an honest banner (422 = PII, 503 = no embedder). */
async function mutationError(r: Response): Promise<string> {
  const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
  if (r.status === 422) return b.error?.message ?? "Refused: the tip looks like it contains PII or a secret.";
  if (r.status === 503) return "The embedding provider isn't configured — tip edits are unavailable.";
  return b.error?.message ?? `Request failed (${r.status}).`;
}

export function TipsPanel() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await getJSON<{ tips: Tip[] }>("");
      setTips(list.tips ?? []);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const edit = (t: Tip) => {
    setForm({
      source: t.source,
      title: t.title,
      body: t.body,
      cta_label: t.ctaLabel ?? "",
      cta_href: t.ctaHref ?? "",
      active: t.active,
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
        title: form.title.trim(),
        body: form.body.trim(),
        active: form.active,
      };
      if (form.source) payload.source = form.source;
      if (form.cta_label.trim() && form.cta_href.trim()) {
        payload.cta_label = form.cta_label.trim();
        payload.cta_href = form.cta_href.trim();
      }
      const r = await fetch(API, {
        method: "POST",
        headers: { ...CHAIN_HEADERS, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await mutationError(r));
      setBanner({ kind: "ok", text: form.source ? "Tip updated." : "Tip added." });
      clear();
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  };

  const del = async (source: string) => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/delete`, {
        method: "POST",
        headers: { ...CHAIN_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!r.ok) throw new Error(await mutationError(r));
      if (form.source === source) clear();
      setBanner({ kind: "ok", text: "Tip deleted." });
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Delete failed." });
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/reingest`, { method: "POST", headers: CHAIN_HEADERS });
      if (!r.ok) throw new Error(await mutationError(r));
      const j = (await r.json()) as { ingested?: unknown[] };
      setBanner({ kind: "ok", text: `Restored ${(j.ingested ?? []).length} default tips.` });
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Restore failed." });
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
          <h2 style={{ margin: 0 }}>Tips</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            The rotating tips in the sidebar widget. Stored in the knowledge corpus (tip databank).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={reseed}>
            <Icon name="refresh" size={14} /> Restore defaults
          </button>
          <span className={`pill ${state === "loading" ? "info" : state === "ok" ? "ok" : "amber"}`}>
            <span className="led" /> {state === "loading" ? "Loading…" : state === "ok" ? "Live" : "Error"}
          </span>
        </div>
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
        <div className="ct">{form.source ? "Edit tip" : "New tip"}</div>
        <input
          placeholder="Title"
          value={form.title}
          maxLength={80}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={{ ...inputStyle, width: "100%" }}
        />
        <textarea
          placeholder="Body (kept short — shows in the sidebar card)"
          value={form.body}
          maxLength={400}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={3}
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
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)" }}
          >
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active (shown)
          </label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !form.title.trim() || !form.body.trim()}
            onClick={save}
          >
            <Icon name="check" size={14} /> {form.source ? "Save changes" : "Add tip"}
          </button>
          {form.source !== null && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={clear}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="card card-pad">
        <div className="ct" style={{ marginBottom: 10 }}>
          All tips ({tips.length})
        </div>
        {tips.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            No tips yet — add one above, or restore the defaults.
          </div>
        )}
        {tips.map((t) => (
          <div
            key={t.source}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 0",
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {t.title}{" "}
                {!t.active && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    (hidden)
                  </span>
                )}
                {t.ctaLabel && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {" "}
                    · CTA: {t.ctaLabel}
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
                {t.body}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => edit(t)}>
              <Icon name="settings" size={13} /> Edit
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              aria-label="Delete"
              onClick={() => del(t.source)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
};
