"use client";

/**
 * Admin → Knowledge ("second brain" / Obsidian console) — R2, item #11.
 *
 * REAL, admin-gated view + edit of the RAG corpus via the same-origin BFF (`/api/agent/admin/knowledge*`).
 * The BFF injects the verified admin's identity; the agent gates every call on the `admin` role (a
 * non-admin gets 404). Reads are GET; every mutation is a POST (the BFF proxy forwards only GET/POST).
 *
 * HONEST, FAIL-CLOSED writes (enforced server-side, surfaced here):
 *   - a note that trips the PII/secret scan is refused (422) — shown as a clear "refused" banner;
 *   - a save is impossible unless the REAL embedder is configured (503) — never a silent stub;
 *   - an admin edit becomes the authoritative note and WINS over the same-slug seed on re-ingest.
 *
 * This is a KNOWLEDGE/ACCESS surface only: nothing here can move funds or touch custody (N2). The
 * corpus feeds ONLY the assistant's prose (literacy / explainer / rationale), never the policy gate.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TipsPanel } from "@/components/admin/TipsPanel";
import { UpdatesPanel } from "@/components/admin/UpdatesPanel";
import { SelfAuthoredPreview } from "@/components/admin/SelfAuthoredPreview";
import { Icon } from "@/lib/icons";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

const CHAIN_HEADERS = { "x-chain-id": "84532" };
const API = "/api/agent/admin/knowledge";

interface SourceRow {
  source: string;
  title: string;
  chunk_count: number;
  git_sha?: string | null;
  ingested_at?: string | null;
  origin: "seed" | "admin";
  author?: string | null;
  updated_at?: string | null;
}
interface Chunk {
  content: string;
  metadata: Record<string, unknown>;
}
interface NoteBody {
  title: string;
  markdown: string;
  origin: string;
  author?: string | null;
  updated_at?: string;
}
interface Detail {
  source: string;
  note: NoteBody | null;
  chunks: Chunk[];
}
interface Status {
  embedder_configured: boolean;
  model_version: string;
  source_count: number;
  chunk_count: number;
  admin_notes: number;
}
interface AuditEntry {
  action: string;
  source: string;
  actor: string | null;
  at: string;
}
type Banner = { kind: "ok" | "err" | "warn"; text: string } | null;

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/** Map a mutating response's status to a human, honest banner (422 = PII, 503 = no embedder). */
async function mutationError(r: Response): Promise<string> {
  const body = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (r.status === 422) return body.error?.message ?? "Refused: the note looks like it contains PII or a secret.";
  if (r.status === 503) return "The embedding provider isn't configured — knowledge edits are unavailable.";
  return body.error?.message ?? `Request failed (${r.status}).`;
}

/**
 * 032 — the five bodies of writing an admin maintains, in one console.
 *
 * They used to live on three separate screens with three different shapes (`/admin/knowledge`,
 * `/admin/tips`, `/admin/updates`), so maintaining what the assistant says meant learning three
 * pages and remembering which one held what. The old routes still resolve — they redirect here —
 * so no bookmark or nav link breaks.
 *
 * Ordered by who wrote it and how much the assistant leans on it:
 *   1. Knowledge      — hand-written documentation. The corpus behind Sparky's explanations.
 *   2. Persona        — Sparky's character. TRUSTED system-prompt content, deliberately NOT part
 *                       of the corpus: never embedded, never retrievable, never citable.
 *   3. Self-authored  — Sparky's own research. NOT BUILT YET (a preview only; see the panel).
 *   4. Updates        — the in-app changelog. Since 031, indexed and readable by the assistant.
 *   5. Tips           — the sidebar explainer databank. Likewise readable since 031.
 */
type AdminTab = "knowledge" | "persona" | "self-authored" | "updates" | "tips";

const TABS: { id: AdminTab; label: string; hint: string }[] = [
  { id: "knowledge", label: "Knowledge", hint: "Documentation you write. Sparky answers from it." },
  { id: "persona", label: "Persona", hint: "Sparky's character. Never part of the corpus." },
  { id: "self-authored", label: "Self-authored", hint: "Sparky's own research. Not built yet." },
  { id: "updates", label: "Updates", hint: "The in-app changelog. Sparky reads it." },
  { id: "tips", label: "Tips", hint: "Sidebar explainers. Sparky reads them." },
];

const isTab = (v: string | null): v is AdminTab => TABS.some((t) => t.id === v);

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24, opacity: 0.7 }}>Loading console…</div>}>
      <KnowledgeConsole />
    </Suspense>
  );
}

function KnowledgeConsole() {
  // `?section=` makes every section deep-linkable, which is what lets `/admin/tips` and
  // `/admin/updates` keep working as redirects rather than breaking existing bookmarks.
  const params = useSearchParams();
  const requested = params.get("section");
  const [tab, setTab] = useState<AdminTab>(isTab(requested) ? requested : "knowledge");

  const tabButton = (t: AdminTab, label: string) => (
    <button
      key={t}
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      style={{
        padding: "8px 18px",
        borderRadius: 8,
        border: tab === t ? "1px solid var(--accent, #6a8bff)" : "1px solid var(--border-soft)",
        background: tab === t ? "var(--accent, #6a8bff)" : "var(--surface-2, rgba(127,127,127,.12))",
        color: tab === t ? "#fff" : "var(--foreground)",
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  const active = TABS.find((t) => t.id === tab);
  return (
    <>
      <div
        style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}
        role="tablist"
        aria-label="Knowledge console section"
      >
        {TABS.map((t) => tabButton(t.id, t.label))}
      </div>
      {/* Each section says what it IS and who wrote it — the distinction that decides whether an
          admin should edit it, and (for persona vs the rest) whether Sparky can quote it. */}
      <div style={{ fontSize: 12.5, opacity: 0.75, marginBottom: 16 }}>{active?.hint}</div>

      {tab === "knowledge" && <KnowledgePanel />}
      {tab === "persona" && <PersonaPanel />}
      {tab === "self-authored" && <SelfAuthoredPreview />}
      {tab === "updates" && <UpdatesPanel />}
      {tab === "tips" && <TipsPanel />}
    </>
  );
}

function KnowledgePanel() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [newSlug, setNewSlug] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        getJSON<{ sources: SourceRow[] }>("/sources"),
        getJSON<Status>("/status"),
      ]);
      setSources(list.sources ?? []);
      setStatus(st);
      setState("ok");
      try {
        const a = await getJSON<{ entries: AuditEntry[] }>("/audit?limit=25");
        setAudit(a.entries ?? []);
      } catch {
        setAudit([]);
      }
    } catch {
      setState("error");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // On-mount sync of the corpus list + status (external-system fetch, not derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const open = useCallback(async (source: string) => {
    setSelected(source);
    setBanner(null);
    setDetail(null);
    try {
      const d = await getJSON<Detail>(`/sources/${encodeURIComponent(source)}`);
      setDetail(d);
      // Prefill the editor: the authoritative admin markdown if present, else a best-effort draft
      // reconstructed from the seed's chunks (the canonical seed markdown lives in git, not the DB).
      if (d.note) {
        setTitle(d.note.title);
        setMarkdown(d.note.markdown);
      } else {
        setTitle(source);
        setMarkdown(d.chunks.map((c) => c.content).join("\n\n"));
      }
    } catch {
      setBanner({ kind: "err", text: "Couldn’t load that note." });
    }
  }, []);

  const startNew = useCallback(() => {
    const slug = slugify(newSlug);
    if (!slug) {
      setBanner({ kind: "err", text: "Enter a slug for the new note (letters, numbers, dashes)." });
      return;
    }
    setSelected(slug);
    setDetail({ source: slug, note: null, chunks: [] });
    setTitle(slug);
    setMarkdown("");
    setNewSlug("");
    setBanner({ kind: "warn", text: `New note “${slug}”. Save to embed + persist it as admin-owned.` });
  }, [newSlug]);

  const save = useCallback(async () => {
    if (!selected) return;
    if (!title.trim() || !markdown.trim()) {
      setBanner({ kind: "err", text: "Both a title and markdown body are required." });
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/sources/${encodeURIComponent(selected)}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...CHAIN_HEADERS },
        body: JSON.stringify({ title: title.trim(), markdown }),
      });
      if (!r.ok) {
        setBanner({ kind: "err", text: await mutationError(r) });
        return;
      }
      const out = (await r.json()) as { chunks_written: number };
      setBanner({ kind: "ok", text: `Saved “${selected}” — ${out.chunks_written} chunk(s) embedded. This admin note now wins on re-ingest.` });
      await refresh();
      await open(selected);
    } catch {
      setBanner({ kind: "err", text: "Save failed — the agent is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [selected, title, markdown, refresh, open]);

  const del = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`Delete note “${selected}” and prune all its chunks? This can’t be undone.`)) return;
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/sources/${encodeURIComponent(selected)}/delete`, {
        method: "POST",
        headers: CHAIN_HEADERS,
      });
      if (!r.ok) {
        setBanner({ kind: "err", text: await mutationError(r) });
        return;
      }
      setSelected(null);
      setDetail(null);
      setBanner({ kind: "ok", text: `Deleted “${selected}”.` });
      await refresh();
    } catch {
      setBanner({ kind: "err", text: "Delete failed — the agent is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const reingest = useCallback(async () => {
    if (!window.confirm("Re-ingest the shipped seed corpus? Admin-edited notes are preserved (they win over the seed).")) return;
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${API}/reingest`, { method: "POST", headers: CHAIN_HEADERS });
      if (!r.ok) {
        setBanner({ kind: "err", text: await mutationError(r) });
        return;
      }
      const out = (await r.json()) as { ingested: { source: string }[]; skipped_admin_owned: string[] };
      setBanner({
        kind: "ok",
        text: `Re-ingested ${out.ingested.length} seed note(s); skipped ${out.skipped_admin_owned.length} admin-owned.`,
      });
      await refresh();
    } catch {
      setBanner({ kind: "err", text: "Re-ingest failed — the agent is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const embedderOk = status?.embedder_configured ?? false;

  // Feature 006: pause the force-refresh while the editor has unsaved edits, or a save/delete/reingest
  // is in flight (BUSY — admin-only data loss). `dirty` is derived in render from `detail` (the prefill
  // source), mirroring open()/startNew() exactly — no effect/ref, so it can't trip react-hooks.
  const baseTitle = detail ? (detail.note ? detail.note.title : detail.source) : "";
  const baseMarkdown = detail
    ? detail.note
      ? detail.note.markdown
      : detail.chunks.map((c) => c.content).join("\n\n")
    : "";
  const dirty = selected !== null && detail !== null && (title !== baseTitle || markdown !== baseMarkdown);
  useHoldCriticalOp(dirty || busy, "busy");

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Knowledge</h1>
          <div className="sub">
            The assistant’s “second brain” — the grounding corpus behind Sparky’s explanations. Edit a
            note and it becomes authoritative, winning over the shipped seed on re-ingest. Feeds the
            assistant’s prose only, never the policy gate; access only, never custody.
          </div>
        </div>
        <span className={`pill ${state === "loading" ? "info" : embedderOk ? "ok" : "amber"}`}>
          <span className="led" />
          {state === "loading" ? "Loading…" : embedderOk ? "Embedder live" : "Embedder off"}
        </span>
      </div>

      {!embedderOk && state === "ok" && (
        <div
          className="infobanner"
          style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
        >
          The embedding provider isn’t configured on the agent — notes are read-only until{" "}
          <span className="mono">EMBEDDING_OPENAI_*</span> is set. Saving would 503 rather than write stub vectors.
        </div>
      )}
      {state === "error" && (
        <div
          className="infobanner"
          style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
        >
          Couldn’t load the knowledge corpus.
        </div>
      )}

      {/* Corpus status band */}
      <div className="chartcard" style={{ marginBottom: 14 }}>
        <div className="ch">
          <span className="ct">Corpus</span>
          <span className="prov">{status?.model_version ?? "—"}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 22, padding: "10px 10px", fontSize: 13 }}>
          <Stat label="Sources" value={status ? String(status.source_count) : "—"} />
          <Stat label="Chunks" value={status ? String(status.chunk_count) : "—"} />
          <Stat label="Admin notes" value={status ? String(status.admin_notes) : "—"} />
          <Stat label="Embedder" value={embedderOk ? "configured" : "off"} />
          <div style={{ marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-sm" disabled={busy || !embedderOk} onClick={reingest}>
              <Icon name="activity" size={14} /> Re-ingest seed
            </button>
          </div>
        </div>
      </div>

      <div className="grid2">
        {/* Sources list */}
        <div className="chartcard">
          <div className="ch">
            <span className="ct">
              Notes <span className="prov">{sources.length}</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "8px", alignItems: "center" }}>
            <input
              className="mono"
              placeholder="new-note-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              style={inputStyle}
            />
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={startNew}>
              <Icon name="plus" size={14} /> New
            </button>
          </div>
          <div style={{ padding: "2px 2px 4px" }}>
            {sources.length === 0 ? (
              <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                {loaded ? "No notes ingested yet." : "Loading…"}
              </div>
            ) : (
              sources.map((s) => (
                <button
                  key={s.source}
                  onClick={() => open(s.source)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 8px",
                    borderTop: "1px solid var(--border-soft)",
                    background: selected === s.source ? "var(--surface-2, rgba(127,127,127,.08))" : "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title || s.source}</span>
                    <span className="mono muted" style={{ display: "block", fontSize: 11.5, wordBreak: "break-all" }}>
                      {s.source}
                    </span>
                  </span>
                  <OriginPill origin={s.origin} />
                  <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{s.chunk_count} ch</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="chartcard">
          <div className="ch">
            <span className="ct">{selected ? "Edit note" : "Editor"}</span>
            {detail?.note && <OriginPill origin={detail.note.origin === "admin" ? "admin" : "seed"} />}
          </div>
          {!selected ? (
            <div className="muted" style={{ padding: "16px 10px", fontSize: 13 }}>
              Select a note on the left, or start a new one, to view and edit its markdown.
            </div>
          ) : (
            <div style={{ padding: "10px" }}>
              {detail && !detail.note && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  This slug is seed-only (canonical markdown lives in git). Saving creates an admin
                  override that wins on re-ingest — the draft below is reconstructed from its chunks.
                </div>
              )}
              <input
                className="mono"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
              />
              <textarea
                placeholder="# Note\n\nMarkdown body…"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 240,
                  padding: "10px 11px",
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                  background: "var(--surface-2, transparent)",
                  color: "var(--foreground)",
                  font: "12.5px/1.6 var(--font-geist-mono, ui-monospace, monospace)",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button className="btn btn-primary btn-sm" disabled={busy || !embedderOk} onClick={save}>
                  <Icon name="check" size={14} /> Save + embed
                </button>
                {detail?.note && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={del}>
                    <Icon name="x" size={14} /> Delete
                  </button>
                )}
                {detail && (
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>
                    {detail.chunks.length} live chunk(s)
                  </span>
                )}
              </div>
              {banner && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    background:
                      banner.kind === "ok"
                        ? "var(--gain-subtle, rgba(0,180,120,.10))"
                        : banner.kind === "warn"
                          ? "var(--caution-subtle, rgba(200,150,0,.10))"
                          : "var(--loss-subtle, rgba(255,80,80,.10))",
                    color:
                      banner.kind === "ok"
                        ? "var(--gain)"
                        : banner.kind === "warn"
                          ? "var(--caution, #c89600)"
                          : "var(--loss, #ff6b6b)",
                  }}
                >
                  {banner.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live chunks preview for the selected note */}
      {detail && detail.chunks.length > 0 && (
        <div className="chartcard" style={{ marginTop: 14 }}>
          <div className="ch">
            <span className="ct">Ingested chunks</span>
            <span className="prov">what the assistant retrieves</span>
          </div>
          <div style={{ padding: "4px 2px" }}>
            {detail.chunks.map((c, i) => (
              <div key={i} style={{ padding: "8px 10px", borderTop: "1px solid var(--border-soft)" }}>
                <div className="muted mono" style={{ fontSize: 11, marginBottom: 4 }}>
                  {String(c.metadata.section ?? c.metadata.title ?? `chunk ${i + 1}`)}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit log */}
      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Recent changes</span>
          <span className="prov">audit log</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {audit.length === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {loaded ? "No changes recorded yet." : "Loading…"}
            </div>
          ) : (
            audit.map((e, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 10, padding: "7px 8px", borderTop: "1px solid var(--border-soft)", fontSize: 12.5 }}
              >
                <span style={{ width: 72, color: e.action === "delete" ? "var(--loss, #ff6b6b)" : "var(--gain)" }}>
                  {e.action}
                </span>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{e.source}</span>
                <span className="mono muted" style={{ width: 130, wordBreak: "break-all" }}>{e.actor ?? "—"}</span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function OriginPill({ origin }: { origin: "seed" | "admin" }) {
  const admin = origin === "admin";
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        padding: "2px 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: admin ? "var(--accent-subtle, rgba(90,120,255,.14))" : "var(--surface-2, rgba(127,127,127,.12))",
        color: admin ? "var(--accent, #6a8bff)" : "var(--muted-foreground)",
        border: "1px solid var(--border-soft)",
      }}
    >
      {origin}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  flex: "1 1 auto",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
};

// ── Persona tab ──────────────────────────────────────────────────────────────
// Sparky's character (IDENTITY/SOUL/VOICE/BOUNDARIES/EXAMPLES). Unlike Knowledge this is TRUSTED
// system-prompt content — there is NO embedder and NO chunks; a save reloads Sparky's voice live.

const PERSONA_API = "/api/agent/admin/persona";

interface PersonaSection {
  slug: string;
  title: string;
  required: boolean;
  origin: "seed" | "admin";
  has_seed: boolean;
  author?: string | null;
  updated_at?: string | null;
}
interface PersonaNote {
  title: string;
  markdown: string;
  author?: string | null;
  updated_at?: string;
}
interface PersonaDetail {
  slug: string;
  title: string;
  required: boolean;
  seed_markdown: string | null;
  note: PersonaNote | null;
}

async function personaGet<T>(path: string): Promise<T> {
  const r = await fetch(`${PERSONA_API}${path}`, { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

function PersonaPanel() {
  const [sections, setSections] = useState<PersonaSection[]>([]);
  const [personaChars, setPersonaChars] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonaDetail | null>(null);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await personaGet<{ sections: PersonaSection[]; persona_chars: number }>("");
      setSections(list.sections ?? []);
      setPersonaChars(list.persona_chars ?? null);
      setState("ok");
      try {
        const a = await personaGet<{ entries: AuditEntry[] }>("/audit?limit=25");
        setAudit(a.entries ?? []);
      } catch {
        setAudit([]);
      }
    } catch {
      setState("error");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const open = useCallback(async (slug: string) => {
    setSelected(slug);
    setBanner(null);
    setDetail(null);
    try {
      const d = await personaGet<PersonaDetail>(`/${encodeURIComponent(slug)}`);
      setDetail(d);
      // Prefill the editor with the live override if one exists, else the shipped seed markdown
      // (the canonical default — editing from here creates an admin override that wins live).
      if (d.note) {
        setTitle(d.note.title);
        setMarkdown(d.note.markdown);
      } else {
        setTitle(d.title);
        setMarkdown(d.seed_markdown ?? "");
      }
    } catch {
      setBanner({ kind: "err", text: "Couldn’t load that section." });
    }
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    if (!title.trim() || !markdown.trim()) {
      setBanner({ kind: "err", text: "Both a title and markdown body are required." });
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${PERSONA_API}/${encodeURIComponent(selected)}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...CHAIN_HEADERS },
        body: JSON.stringify({ title: title.trim(), markdown }),
      });
      if (!r.ok) {
        setBanner({ kind: "err", text: await mutationError(r) });
        return;
      }
      setBanner({ kind: "ok", text: `Saved “${selected}”. Sparky’s voice reloaded — live on the next message.` });
      await refresh();
      await open(selected);
    } catch {
      setBanner({ kind: "err", text: "Save failed — the agent is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [selected, title, markdown, refresh, open]);

  const revert = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`Revert “${selected}” to the shipped seed default? Your override is removed.`)) return;
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch(`${PERSONA_API}/${encodeURIComponent(selected)}/delete`, {
        method: "POST",
        headers: CHAIN_HEADERS,
      });
      if (!r.ok) {
        setBanner({ kind: "err", text: await mutationError(r) });
        return;
      }
      setBanner({ kind: "ok", text: `Reverted “${selected}” to the seed default. Sparky’s voice reloaded.` });
      await refresh();
      await open(selected);
    } catch {
      setBanner({ kind: "err", text: "Revert failed — the agent is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [selected, refresh, open]);

  const overrides = sections.filter((s) => s.origin === "admin").length;

  // Feature 006: pause the force-refresh while the persona editor has unsaved edits, or a save is in
  // flight (BUSY — admin-only data loss). Derived in render from `detail`, mirroring open() exactly.
  const baseTitle = detail ? (detail.note ? detail.note.title : detail.title) : "";
  const baseMarkdown = detail ? (detail.note ? detail.note.markdown : detail.seed_markdown ?? "") : "";
  const dirty = selected !== null && detail !== null && (title !== baseTitle || markdown !== baseMarkdown);
  useHoldCriticalOp(dirty || busy, "busy");

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Persona</h1>
          <div className="sub">
            Sparky’s character — identity, soul, voice, boundaries, and examples. This is the assistant’s
            trusted system prompt (not the knowledge corpus): edits reload Sparky’s voice on the next
            message, no redeploy. Boundaries keep the non-custody rules; shapes tone only, never actions.
          </div>
        </div>
        <span className={`pill ${state === "loading" ? "info" : "ok"}`}>
          <span className="led" />
          {state === "loading" ? "Loading…" : "Persona live"}
        </span>
      </div>

      {state === "error" && (
        <div
          className="infobanner"
          style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
        >
          Couldn’t load the persona sections.
        </div>
      )}

      {/* Status band */}
      <div className="chartcard" style={{ marginBottom: 14 }}>
        <div className="ch">
          <span className="ct">Persona</span>
          <span className="prov">trusted system prompt · not embedded</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 22, padding: "10px 10px", fontSize: 13 }}>
          <Stat label="Sections" value={sections.length ? String(sections.length) : "—"} />
          <Stat label="Overrides" value={String(overrides)} />
          <Stat label="Composed size" value={personaChars != null ? `${personaChars.toLocaleString()} ch` : "—"} />
        </div>
      </div>

      <div className="grid2">
        {/* Sections list */}
        <div className="chartcard">
          <div className="ch">
            <span className="ct">
              Sections <span className="prov">{sections.length}</span>
            </span>
          </div>
          <div style={{ padding: "2px 2px 4px" }}>
            {sections.length === 0 ? (
              <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
                {loaded ? "No persona sections found." : "Loading…"}
              </div>
            ) : (
              sections.map((s) => (
                <button
                  key={s.slug}
                  onClick={() => open(s.slug)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 8px",
                    borderTop: "1px solid var(--border-soft)",
                    background: selected === s.slug ? "var(--surface-2, rgba(127,127,127,.08))" : "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {s.title}
                      {s.required && <span className="muted" style={{ fontWeight: 400 }}> · required</span>}
                    </span>
                    <span className="mono muted" style={{ display: "block", fontSize: 11.5 }}>{s.slug}</span>
                  </span>
                  <OriginPill origin={s.origin} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="chartcard">
          <div className="ch">
            <span className="ct">{selected ? "Edit section" : "Editor"}</span>
            {detail && <OriginPill origin={detail.note ? "admin" : "seed"} />}
          </div>
          {!selected ? (
            <div className="muted" style={{ padding: "16px 10px", fontSize: 13 }}>
              Select a section on the left to view and edit Sparky’s character. Keep the boundaries intact —
              they hold the non-custody rules.
            </div>
          ) : (
            <div style={{ padding: "10px" }}>
              {detail && !detail.note && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  This section is the shipped seed default. Saving creates a live override that wins until
                  you revert it.
                </div>
              )}
              <input
                className="mono"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
              />
              <textarea
                placeholder="# Section\n\nMarkdown body…"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 260,
                  padding: "10px 11px",
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                  background: "var(--surface-2, transparent)",
                  color: "var(--foreground)",
                  font: "12.5px/1.6 var(--font-geist-mono, ui-monospace, monospace)",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                  <Icon name="check" size={14} /> Save + reload
                </button>
                {detail?.note && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={revert}>
                    <Icon name="refresh" size={14} /> Revert to seed
                  </button>
                )}
              </div>
              {banner && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    background:
                      banner.kind === "ok"
                        ? "var(--gain-subtle, rgba(0,180,120,.10))"
                        : banner.kind === "warn"
                          ? "var(--caution-subtle, rgba(200,150,0,.10))"
                          : "var(--loss-subtle, rgba(255,80,80,.10))",
                    color:
                      banner.kind === "ok"
                        ? "var(--gain)"
                        : banner.kind === "warn"
                          ? "var(--caution, #c89600)"
                          : "var(--loss, #ff6b6b)",
                  }}
                >
                  {banner.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audit log */}
      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Recent changes</span>
          <span className="prov">audit log</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {audit.length === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {loaded ? "No changes recorded yet." : "Loading…"}
            </div>
          ) : (
            audit.map((e, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 10, padding: "7px 8px", borderTop: "1px solid var(--border-soft)", fontSize: 12.5 }}
              >
                <span style={{ width: 72, color: e.action === "delete" ? "var(--loss, #ff6b6b)" : "var(--gain)" }}>
                  {e.action}
                </span>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{e.source}</span>
                <span className="mono muted" style={{ width: 130, wordBreak: "break-all" }}>{e.actor ?? "—"}</span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
