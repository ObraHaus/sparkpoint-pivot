"use client";

/**
 * Admin → LLM gateway (Phase B status + R3 configurable panel).
 *
 * REAL, admin-gated view/control of the LiteLLM proxy via the same-origin BFF (`/api/agent/admin/llm/*`).
 * Four tabs:
 *   - Overview  — reachability + configured models + the virtual key's spend/limits (read-only, Phase B).
 *   - Stats     — total + per-model spend (needs the scoped admin key; degrades honestly).
 *   - Activity  — recent requests, SCRUBBED (model/tokens/spend/time; caller wallet masked, no content).
 *   - Config    — the deployments behind the `sparkpoint-chat` alias; add/remove with a guardrail that
 *                 refuses to strand chat with zero backends. Every write is a POST (BFF is GET/POST-only)
 *                 and is audit-logged server-side.
 *
 * The agent uses a SCOPED admin key (never the master key). When it isn't provisioned the admin tabs
 * show a clear "admin key not configured" state rather than failing. Access/config only — never custody.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

const API = "/api/agent/admin/llm";
const CHAIN = { "x-chain-id": "84532" };
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const money = (v: unknown) =>
  v === undefined || v === null || v === "" ? "—" : `$${Number(v).toFixed(4)}`;

type Tab = "overview" | "stats" | "activity" | "config";

interface GatewayModel {
  name: string;
  upstream: string;
}
interface KeyInfo {
  spend?: number;
  max_budget?: number | null;
  tpm_limit?: number | null;
  rpm_limit?: number | null;
  budget_duration?: string | null;
}
interface Status {
  configured: boolean;
  base?: string;
  reachable: boolean;
  modelAlias?: string;
  models: GatewayModel[];
  key: KeyInfo | null;
}
interface Stats {
  configured: boolean;
  adminConfigured: boolean;
  total_spend?: number | null;
  by_model?: { model: string; spend?: number | null }[];
  key?: KeyInfo | null;
}
interface Activity {
  adminConfigured: boolean;
  entries: {
    model: string;
    user?: string | null;
    total_tokens?: number | null;
    spend?: number | null;
    status?: string | null;
    at?: string | null;
  }[];
}
interface Deployment {
  id: string;
  model_name: string;
  upstream: string;
  rpm?: number | null;
}
interface AuditRow {
  action: string;
  subject: string;
  actor: string | null;
  detail: Record<string, unknown>;
  at: string;
}
interface Config {
  adminConfigured: boolean;
  alias: string;
  deployments: Deployment[];
  audit: AuditRow[];
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: CHAIN, cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <>
      <div className="pghead">
        <div>
          <h1>LLM gateway</h1>
          <div className="sub">
            LiteLLM proxy → OpenRouter. View spend/activity and configure the chat model group.
            Config changes are guarded + audit-logged; the agent holds a scoped admin key, never the
            master. Access only — never custody.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["overview", "stats", "activity", "config"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="btn btn-sm"
            style={{
              textTransform: "capitalize",
              background: tab === t ? "var(--accent-subtle, rgba(90,120,255,.16))" : "transparent",
              color: tab === t ? "var(--accent, #6a8bff)" : "var(--muted-foreground)",
              border: "1px solid var(--border-soft)",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "stats" && <StatsTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "config" && <ConfigTab />}
    </>
  );
}

function AdminOffNotice() {
  return (
    <div
      className="infobanner"
      style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
    >
      The gateway’s scoped admin key isn’t provisioned (<span className="mono">LITELLM_ADMIN_KEY</span>).
      This tab is unavailable until it’s set on the agent — the panel degrades rather than guessing.
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt className="muted">{k}</dt>
      <dd className={mono ? "mono" : undefined} style={{ margin: 0, wordBreak: "break-all", textAlign: "right" }}>
        {v}
      </dd>
    </div>
  );
}

// ── Overview (Phase B status) ────────────────────────────────────────────────
function OverviewTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    getJSON<Status>("/status")
      .then((d) => live && (setStatus(d), setState("ok")))
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);
  const reachable = status?.reachable ?? false;
  const key = status?.key ?? null;
  return (
    <>
      {state === "error" && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          Couldn’t load gateway status.
        </div>
      )}
      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Gateway</span>
            <span className={`pill ${reachable ? "ok" : "amber"}`}>
              <span className="led" />
              {state === "loading" ? "Checking…" : reachable ? "Reachable" : "Unreachable"}
            </span>
          </div>
          <dl style={{ margin: 0, padding: "6px 8px", fontSize: 13, lineHeight: 1.9 }}>
            <Row k="Alias" v={fmt(status?.modelAlias)} mono />
            <Row k="Endpoint" v={fmt(status?.base)} mono />
            <Row k="Reachable" v={reachable ? "yes" : "no"} />
            <Row k="Models" v={String(status?.models.length ?? 0)} />
          </dl>
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Virtual key</span>
            <span className="prov">live</span>
          </div>
          {key ? (
            <dl style={{ margin: 0, padding: "6px 8px", fontSize: 13, lineHeight: 1.9 }}>
              <Row k="Spend" v={money(key.spend)} />
              <Row k="Budget" v={key.max_budget != null ? money(key.max_budget) : "unlimited"} />
              <Row k="RPM limit" v={fmt(key.rpm_limit)} />
              <Row k="TPM limit" v={fmt(key.tpm_limit)} />
            </dl>
          ) : (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {state === "loading" ? "Loading…" : "Virtual-key info not available."}
            </div>
          )}
        </div>
      </div>
      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Models</span>
          <span className="prov">/model/info</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {(status?.models.length ?? 0) === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {state === "loading" ? "Loading…" : "No models reported."}
            </div>
          ) : (
            status!.models.map((m, i) => (
              <div key={i} style={rowStyle}>
                <span style={{ flex: "0 0 180px", fontWeight: 600 }}>{m.name}</span>
                <span className="mono muted" style={{ flex: 1, wordBreak: "break-all" }}>
                  {m.upstream || "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── Stats ────────────────────────────────────────────────────────────────────
function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    getJSON<Stats>("/stats")
      .then((d) => live && (setStats(d), setState("ok")))
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);
  if (state === "loading") return <Loading />;
  if (state === "error") return <ErrBanner />;
  if (!stats?.adminConfigured) return <AdminOffNotice />;
  return (
    <>
      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Total spend</span>
            <span className="prov">/global/spend</span>
          </div>
          <div style={{ padding: "14px 12px", fontSize: 28, fontWeight: 800 }}>
            {money(stats.total_spend)}
          </div>
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Virtual key</span>
          </div>
          <dl style={{ margin: 0, padding: "6px 8px", fontSize: 13, lineHeight: 1.9 }}>
            <Row k="Spend" v={money(stats.key?.spend)} />
            <Row k="Budget" v={stats.key?.max_budget != null ? money(stats.key.max_budget) : "unlimited"} />
          </dl>
        </div>
      </div>
      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Spend by model</span>
          <span className="prov">/global/spend/report</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {(stats.by_model?.length ?? 0) === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              No per-model spend reported yet.
            </div>
          ) : (
            stats.by_model!.map((m, i) => (
              <div key={i} style={rowStyle}>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{m.model}</span>
                <span style={{ fontWeight: 600 }}>{money(m.spend)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────
function ActivityTab() {
  const [act, setAct] = useState<Activity | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    getJSON<Activity>("/activity?limit=40")
      .then((d) => live && (setAct(d), setState("ok")))
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);
  if (state === "loading") return <Loading />;
  if (state === "error") return <ErrBanner />;
  if (!act?.adminConfigured) return <AdminOffNotice />;
  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">Recent requests</span>
        <span className="prov">scrubbed · wallet masked</span>
      </div>
      <div style={{ padding: "4px 2px" }}>
        {act.entries.length === 0 ? (
          <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
            No recent activity.
          </div>
        ) : (
          act.entries.map((e, i) => (
            <div key={i} style={{ ...rowStyle, fontSize: 12.5 }}>
              <span className="mono" style={{ flex: "1 1 160px" }}>{e.model || "—"}</span>
              <span className="mono muted" style={{ width: 120 }}>{e.user ?? "—"}</span>
              <span className="muted" style={{ width: 70, textAlign: "right" }}>{fmt(e.total_tokens)} tok</span>
              <span style={{ width: 80, textAlign: "right" }}>{money(e.spend)}</span>
              <span className="muted" style={{ width: 150, textAlign: "right", whiteSpace: "nowrap" }}>
                {e.at ? new Date(e.at).toLocaleString() : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Config (guarded writes) ───────────────────────────────────────────────────
function ConfigTab() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [newModel, setNewModel] = useState("");
  const [rpm, setRpm] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await getJSON<Config>("/config");
      setCfg(d);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const errText = async (r: Response) => {
    const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    return b.error?.message ?? `Request failed (${r.status}).`;
  };

  const add = useCallback(async () => {
    const upstream = newModel.trim();
    if (!upstream) {
      setMsg({ kind: "err", text: "Enter an upstream model (e.g. openrouter/google/gemma-4-31b-it:free)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { upstream_model: upstream };
      if (rpm.trim()) body.rpm = Number(rpm.trim());
      const r = await fetch(`${API}/config/model`, {
        method: "POST",
        headers: { "content-type": "application/json", ...CHAIN },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setMsg({ kind: "err", text: await errText(r) });
        return;
      }
      setNewModel("");
      setRpm("");
      setMsg({ kind: "ok", text: `Added ${upstream} to the ${cfg?.alias} group.` });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: "Add failed — the gateway is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [newModel, rpm, cfg, refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(`Remove deployment ${id} from the ${cfg?.alias} group?`)) return;
      setBusy(true);
      setMsg(null);
      try {
        const r = await fetch(`${API}/config/model/delete`, {
          method: "POST",
          headers: { "content-type": "application/json", ...CHAIN },
          body: JSON.stringify({ id }),
        });
        if (!r.ok) {
          setMsg({ kind: "err", text: await errText(r) });
          return;
        }
        setMsg({ kind: "ok", text: `Removed ${id}.` });
        await refresh();
      } catch {
        setMsg({ kind: "err", text: "Remove failed — the gateway is unreachable." });
      } finally {
        setBusy(false);
      }
    },
    [cfg, refresh],
  );

  if (state === "loading") return <Loading />;
  if (state === "error") return <ErrBanner />;
  if (!cfg?.adminConfigured) return <AdminOffNotice />;

  // Mirror the server guardrail, which counts DISTINCT non-empty deployment ids (not array length).
  const distinctIds = new Set(cfg.deployments.map((d) => d.id).filter(Boolean)).size;
  const isLast = distinctIds <= 1;
  return (
    <>
      <div className="chartcard">
        <div className="ch">
          <span className="ct">
            Deployments <span className="prov">alias: {cfg.alias}</span>
          </span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {cfg.deployments.length === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>No deployments.</div>
          ) : (
            cfg.deployments.map((d) => (
              <div key={d.id} style={rowStyle}>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all", fontSize: 12.5 }}>
                  {d.upstream || d.id}
                </span>
                <span className="muted" style={{ width: 70, textAlign: "right", fontSize: 12 }}>
                  rpm {fmt(d.rpm)}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy || isLast}
                  onClick={() => remove(d.id)}
                  title={isLast ? "Can’t remove the last backend — chat would have none" : `Remove ${d.id}`}
                >
                  <Icon name="x" size={13} /> Remove
                </button>
              </div>
            ))
          )}
        </div>
        {distinctIds === 1 && (
          <div className="muted" style={{ padding: "6px 10px", fontSize: 11.5 }}>
            Only one backend serves the alias — the last one can’t be removed (guardrail).
          </div>
        )}
      </div>

      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Add a deployment</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 8px", alignItems: "center" }}>
          <input
            className="mono"
            placeholder="openrouter/google/gemma-4-31b-it:free"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 320px" }}
          />
          <input
            placeholder="rpm (opt)"
            value={rpm}
            onChange={(e) => setRpm(e.target.value)}
            inputMode="numeric"
            style={{ ...inputStyle, width: 100 }}
          />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={add}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
        {msg && (
          <div style={{ padding: "6px 10px", fontSize: 12.5, color: msg.kind === "ok" ? "var(--gain)" : "var(--loss, #ff6b6b)" }}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Recent config changes</span>
          <span className="prov">audit log</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {cfg.audit.length === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>No changes recorded.</div>
          ) : (
            cfg.audit.map((a, i) => (
              <div key={i} style={{ ...rowStyle, fontSize: 12.5 }}>
                <span style={{ width: 100, color: a.action === "model_delete" ? "var(--loss, #ff6b6b)" : "var(--gain)" }}>
                  {a.action}
                </span>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{a.subject}</span>
                <span className="mono muted" style={{ width: 120, wordBreak: "break-all" }}>{a.actor ?? "—"}</span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(a.at).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function Loading() {
  return <div className="muted" style={{ padding: "16px 4px", fontSize: 13 }}>Loading…</div>;
}
function ErrBanner() {
  return (
    <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
      Couldn’t load this tab from the gateway.
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px",
  borderTop: "1px solid var(--border-soft)",
};
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
};
