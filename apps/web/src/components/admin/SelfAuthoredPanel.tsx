"use client";

/**
 * 034 — the Self-authored section, wired.
 *
 * Replaces the deliberately-unwired mockup from 032. What an admin does here:
 *
 *   * decides what Sparky may read — the structured feeds, and the prose domain allowlist;
 *   * decides whether and when documents reach users;
 *   * reads, edits, publishes and deletes the six documents;
 *   * releases the unflattering findings a run held back.
 *
 * THE THINGS THIS SCREEN HAS TO SAY OUT LOUD, because each is invisible otherwise:
 *
 *   * **An empty prose allowlist means no prose is fetched** — never "fetch anything". Empty looks
 *     like an unfinished setting rather than a deliberate one, so it is stated.
 *   * **Enabled but reading nothing is not the same as switched off**, and both look identical if
 *     each setting is rendered on its own. Hence one state sentence rather than a row of badges.
 *   * **Silence is a normal outcome.** Most days nothing material changes. A UI that painted that
 *     red would train an admin to ignore the status line, and then miss the day it says something.
 *   * **How many findings are held, and how old the oldest is.** A growing pile is what turns
 *     editorial control into a corpus that only contains good news.
 */

import { useCallback, useEffect, useState } from "react";

import {
  DATA_SOURCES,
  addDomain,
  checkWindowHours,
  describeHeld,
  describeOutcome,
  describeState,
  removeDomain,
  toggleSource,
} from "@/lib/selfauthor/settings";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

const API = "/api/agent/admin/self-authoring";
const CHAIN_HEADERS = { "x-chain-id": APP_CHAIN_ID_HEADER };

interface Settings {
  enabled: boolean;
  publishMode: string;
  draftWindowHours: number;
  allowedDataSources: string[];
  allowedProseDomains: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
}
interface Doc {
  slug: string;
  title: string;
  status: string;
  markdown: string;
  claimCount: number;
  firstWrittenAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  editedByAdmin: boolean;
}
interface Finding {
  id: number;
  topic: string;
  summary: string;
  status: string;
  createdAt: string | null;
}
interface Run {
  id: number;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
  detail: string | null;
  stats: Record<string, unknown>;
}
interface Overview {
  settings: Settings;
  documents: Doc[];
  findings: { heldCount: number; oldestHeldAt: string | null; items: Finding[] };
  runs: Run[];
}
type Banner = { kind: "ok" | "err"; text: string } | null;

const TONE: Record<string, string> = {
  good: "var(--positive, #2c7a5a)",
  quiet: "var(--muted-foreground, #6b7280)",
  bad: "var(--danger, #c1402e)",
};

async function mutate(path: string, method: string, body?: unknown): Promise<string> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...CHAIN_HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.ok) return "";
  const parsed = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
  // The agent's message names the offending value ("docs.aave.com/v3: drop the path"), which is
  // the whole point of surfacing it verbatim rather than replacing it with a generic failure.
  return parsed.error?.message ?? `Request failed (${r.status}).`;
}

export function SelfAuthoredPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [windowText, setWindowText] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(API, { headers: CHAIN_HEADERS, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as Overview;
      setData(next);
      setWindowText(String(next.settings.draftWindowHours));
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Read the clock once, on mount. `Date.now()` in render is impure and would also mean the
    // "oldest held 12 days ago" line silently changed on every unrelated re-render.
    setNowMs(Date.now());
  }, [load]);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      const problem = await mutate("/settings", "PUT", patch);
      setBanner(problem ? { kind: "err", text: problem } : { kind: "ok", text: "Saved." });
      await load();
      setBusy(false);
    },
    [load],
  );

  if (state === "loading") return <p style={{ opacity: 0.7 }}>Loading…</p>;
  if (state === "error" || !data) {
    return (
      <p style={{ color: "var(--danger, #c1402e)" }}>
        Couldn&apos;t load the self-authoring console. The agent may be unreachable, or migration
        0035 may not be applied yet — nothing else is affected.
      </p>
    );
  }

  const s = data.settings;
  const held = data.findings.items.filter((f) => f.status === "held");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {banner && (
        <div
          role="status"
          style={{
            border: `1px solid ${banner.kind === "ok" ? "var(--border-soft)" : "var(--danger, #c1402e)"}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13.5,
          }}
        >
          {banner.text}
        </div>
      )}

      {/* One sentence, because the COMBINATION is what matters: enabled-but-reading-nothing and
          switched-off look identical when each setting is rendered on its own. */}
      <section style={card}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void save({ enabled: !s.enabled })}
          >
            {s.enabled ? "Switch off" : "Switch on"}
          </button>
          <button
            className="btn btn-outline btn-sm"
            disabled={busy || !s.enabled}
            onClick={async () => {
              setBusy(true);
              const problem = await mutate("/run", "POST");
              setBanner(
                problem
                  ? { kind: "err", text: problem }
                  : { kind: "ok", text: "Run started. It works in the background — reload in a minute." },
              );
              setBusy(false);
            }}
          >
            Run now
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
            Reload
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>{describeState(s)}</p>
        {s.updatedBy && (
          <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.7 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${new Date(s.updatedAt).toLocaleString()}` : ""}.
          </p>
        )}
      </section>

      {/* What Sparky may read. */}
      <section style={card}>
        <h3 style={heading}>What Sparky may read</h3>
        <p style={sub}>Changes take effect on the next run. No deploy needed.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {DATA_SOURCES.map((source) => (
            <label key={source.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={s.allowedDataSources.includes(source.id)}
                disabled={busy}
                onChange={() =>
                  void save({ allowedDataSources: toggleSource(s.allowedDataSources, source.id) })
                }
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ fontSize: 13.5 }}>{source.label}</strong>
                <span style={{ display: "block", fontSize: 12.5, opacity: 0.75 }}>{source.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <h4 style={{ ...heading, fontSize: 14, marginTop: 20 }}>Allowed pages</h4>
        <p style={sub}>
          Sparky may quote text from these hosts, always attributed and never as instruction.{" "}
          <strong>
            {s.allowedProseDomains.length === 0
              ? "The list is empty, so no external page is read at all."
              : "Removing a host also retires whatever it was the only support for."}
          </strong>
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="docs.aave.com"
            aria-label="Host to allow"
            style={{ flex: "1 1 16rem", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-soft)" }}
          />
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => {
              const { list, problem } = addDomain(s.allowedProseDomains, newDomain);
              if (problem) {
                setBanner({ kind: "err", text: problem });
                return;
              }
              setNewDomain("");
              void save({ allowedProseDomains: list });
            }}
          >
            Allow
          </button>
        </div>
        {s.allowedProseDomains.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.allowedProseDomains.map((domain) => (
              <li
                key={domain}
                style={{
                  border: "1px solid var(--border-soft)",
                  borderRadius: 999,
                  padding: "3px 6px 3px 10px",
                  fontSize: 12.5,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <code>{domain}</code>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  aria-label={`Remove ${domain}`}
                  onClick={() => void save({ allowedProseDomains: removeDomain(s.allowedProseDomains, domain) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Publishing. */}
      <section style={card}>
        <h3 style={heading}>When documents reach users</h3>
        <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <span>Publishing</span>
            <select
              value={s.publishMode}
              disabled={busy}
              onChange={(e) => void save({ publishMode: e.target.value })}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-soft)" }}
            >
              <option value="manual">Manual — you publish each one</option>
              <option value="automatic">Automatic, after the draft window</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <span>Draft window (hours)</span>
            <input
              value={windowText}
              onChange={(e) => setWindowText(e.target.value)}
              inputMode="numeric"
              style={{ width: 120, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-soft)" }}
            />
          </label>
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => {
              const check = checkWindowHours(windowText);
              if (!check.ok) {
                setBanner({ kind: "err", text: check.problem });
                return;
              }
              void save({ draftWindowHours: check.value });
            }}
          >
            Save window
          </button>
        </div>
      </section>

      {/* Held findings. */}
      <section style={card}>
        <h3 style={heading}>Findings held for you</h3>
        <p style={sub}>{describeHeld(data.findings.heldCount, data.findings.oldestHeldAt, nowMs)}</p>
        {held.length > 0 && (
          <p style={{ ...sub, marginTop: 6 }}>
            While a finding is held, no published document asserts a claim it contradicts — the
            document says less, never something untrue.
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {data.findings.items.map((finding) => (
            <article key={finding.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <code style={{ fontSize: 12 }}>{finding.topic}</code>
                <span style={{ fontSize: 11.5, opacity: 0.7 }}>{finding.status}</span>
              </div>
              <p style={{ margin: "6px 0", fontSize: 13.5 }}>{finding.summary}</p>
              {finding.status === "held" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await mutate(`/findings/${finding.id}`, "POST", { status: "released" });
                      await load();
                      setBusy(false);
                    }}
                  >
                    Release
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await mutate(`/findings/${finding.id}`, "POST", { status: "dismissed" });
                      await load();
                      setBusy(false);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </article>
          ))}
          {data.findings.items.length === 0 && <p style={sub}>No findings yet.</p>}
        </div>
      </section>

      {/* The documents. */}
      <section style={card}>
        <h3 style={heading}>Documents</h3>
        <p style={sub}>
          Six at most, rewritten in place rather than added to — which is what keeps the corpus the
          size it is, and keeps the answers that already work working.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {data.documents.map((doc) => (
            <article key={doc.slug} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{doc.title}</strong>
                <span style={{ fontSize: 11.5, opacity: 0.75 }}>{doc.status}</span>
                <span style={{ fontSize: 11.5, opacity: 0.6 }}>
                  {doc.claimCount} claim{doc.claimCount === 1 ? "" : "s"}
                </span>
                {doc.editedByAdmin && <span style={{ fontSize: 11.5, opacity: 0.75 }}>edited by you</span>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setOpen(open === doc.slug ? null : doc.slug);
                    setDraft(doc.markdown);
                  }}
                >
                  {open === doc.slug ? "Close" : "Read / edit"}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const next = doc.status === "published" ? "draft" : "published";
                    const problem = await mutate(`/documents/${doc.slug}`, "PUT", { status: next });
                    if (problem) setBanner({ kind: "err", text: problem });
                    await load();
                    setBusy(false);
                  }}
                >
                  {doc.status === "published" ? "Unpublish" : "Publish"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await mutate(`/documents/${doc.slug}`, "DELETE");
                    await load();
                    setBusy(false);
                  }}
                >
                  Delete
                </button>
              </div>
              {open === doc.slug && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={14}
                    aria-label={`${doc.title} markdown`}
                    style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: 10 }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      setBusy(true);
                      const problem = await mutate(`/documents/${doc.slug}`, "PUT", { markdown: draft });
                      setBanner(
                        problem
                          ? { kind: "err", text: problem }
                          : { kind: "ok", text: "Saved. The next run will note that it replaced your edit." },
                      );
                      await load();
                      setBusy(false);
                    }}
                  >
                    Save edit
                  </button>
                </div>
              )}
            </article>
          ))}
          {data.documents.length === 0 && (
            <p style={sub}>
              Nothing written yet. Switch the feature on, allow at least one source, and run it.
            </p>
          )}
        </div>
      </section>

      {/* Runs. */}
      <section style={card}>
        <h3 style={heading}>Runs</h3>
        <p style={sub}>
          Most days a run finds nothing new to say. That is the intended outcome, not a failure.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          {data.runs.map((run) => {
            const outcome = describeOutcome(run.outcome);
            return (
              <div key={run.id} style={{ borderBottom: "1px solid var(--border-soft)", paddingBottom: 6 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: TONE[outcome.tone], fontWeight: 600, fontSize: 13 }}>{outcome.text}</span>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"} · {run.trigger}
                  </span>
                </div>
                {run.detail && <p style={{ margin: "3px 0 0", fontSize: 12.5, opacity: 0.85 }}>{run.detail}</p>}
              </div>
            );
          })}
          {data.runs.length === 0 && <p style={sub}>No runs yet.</p>}
        </div>
      </section>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "14px 16px",
};
const heading: React.CSSProperties = { margin: 0, fontSize: 15 };
const sub: React.CSSProperties = { margin: "4px 0 0", fontSize: 12.5, opacity: 0.78, lineHeight: 1.6 };
