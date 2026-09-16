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
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

const API = "/api/agent/admin/llm";
const CHAIN = { "x-chain-id": APP_CHAIN_ID_HEADER };
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const money = (v: unknown) =>
  v === undefined || v === null || v === "" ? "—" : `$${Number(v).toFixed(4)}`;

// Format a per-1M in/out price pair. Each side is INDEPENDENT: a null side is unknown/unset ("—"),
// never coalesced to "$0" (the gateway distinguishes free=0 from unknown=null). Both null → "price —".
const priceText = (inM?: number | null, outM?: number | null) =>
  inM == null && outM == null
    ? "price —"
    : `${inM == null ? "—" : `$${inM}`} / ${outM == null ? "—" : `$${outM}`} /1M`;

type Tab = "overview" | "stats" | "activity" | "config";

interface GatewayModel {
  name: string;
  upstream: string;
  inputCostPerM?: number | null;
  outputCostPerM?: number | null;
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
  monthToDate?: number | null;
  projectedMonthly?: number | null;
  spendPerDay?: number | null;
  budgetUsedPct?: number | null;
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
  inputCostPerM?: number | null;
  outputCostPerM?: number | null;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{label}</span>
      {children}
    </label>
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
          <span className="ct">Model aliases</span>
          <span className="prov">/model/info</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          {(status?.models.length ?? 0) === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {state === "loading" ? "Loading…" : "No models reported."}
            </div>
          ) : (
            Object.entries(
              (status?.models ?? []).reduce<Record<string, GatewayModel[]>>((acc, m) => {
                (acc[m.name] ??= []).push(m);
                return acc;
              }, {}),
            ).map(([alias, models]) => (
              <div
                key={alias}
                style={{ borderTop: "1px solid var(--border-soft)", padding: "8px 8px" }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  {alias}{" "}
                  <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                    · {models.length} backend{models.length === 1 ? "" : "s"}
                  </span>
                </div>
                {models.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "baseline",
                      paddingLeft: 10,
                      fontSize: 12.5,
                    }}
                  >
                    <span className="mono muted" style={{ flex: 1, wordBreak: "break-all" }}>
                      {m.upstream || "—"}
                    </span>
                    <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {priceText(m.inputCostPerM, m.outputCostPerM)}
                    </span>
                  </div>
                ))}
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
  const k = stats.key ?? null;
  const budgetPct = stats.budgetUsedPct ?? null;
  const budgetTone = (budgetPct ?? 0) > 80 ? "var(--loss, #ff6b6b)" : undefined;
  const mtd = Number(stats.monthToDate) || 0;
  const proj = Number(stats.projectedMonthly) || 0;
  const mtdPctOfProj = proj > 0 ? Math.min(100, (mtd / proj) * 100) : 0;
  const maxSpend = Math.max(0, ...(stats.by_model ?? []).map((m) => Number(m.spend) || 0));
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <StatTile
          label="Spend this period"
          value={money(k?.spend)}
          sub={k?.budget_duration ? `resets / ${k.budget_duration}` : undefined}
        />
        <StatTile label="Month to date" value={money(stats.monthToDate)} />
        <StatTile label="Projected month" value={money(stats.projectedMonthly)} />
        <StatTile label="Per day (avg)" value={money(stats.spendPerDay)} />
        <StatTile
          label="Budget used"
          value={budgetPct != null ? `${budgetPct}%` : "—"}
          tone={budgetTone}
        />
        <StatTile label="All-time spend" value={money(stats.total_spend)} />
      </div>

      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Budget used</span>
            <span className="prov">virtual key</span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              padding: "10px 12px",
              flexWrap: "wrap",
            }}
          >
            <Donut pct={budgetPct} />
            <dl style={{ margin: 0, fontSize: 13, lineHeight: 1.9, flex: "1 1 150px" }}>
              <Row k="Spend" v={money(k?.spend)} />
              <Row k="Budget" v={k?.max_budget != null ? money(k.max_budget) : "unlimited"} />
              <Row k="Resets" v={fmt(k?.budget_duration)} />
              <Row k="RPM / TPM" v={`${fmt(k?.rpm_limit)} / ${fmt(k?.tpm_limit)}`} />
            </dl>
          </div>
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Monthly pace</span>
            <span className="prov">MTD → projected</span>
          </div>
          <div style={{ padding: "16px 12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                marginBottom: 8,
              }}
            >
              <span className="muted">
                To date <b style={{ color: "var(--foreground)" }}>{money(stats.monthToDate)}</b>
              </span>
              <span className="muted">
                Projected <b style={{ color: "var(--foreground)" }}>{money(stats.projectedMonthly)}</b>
              </span>
            </div>
            <div
              style={{
                height: 12,
                borderRadius: 6,
                background: "var(--border-soft)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${mtdPctOfProj}%`,
                  height: "100%",
                  background: "var(--accent, #6a8bff)",
                  borderRadius: 6,
                }}
              />
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              {proj > 0
                ? `${Math.round(mtdPctOfProj)}% of the projected month spent · ${money(
                    stats.spendPerDay,
                  )}/day`
                : "Not enough spend this month to project a pace yet."}
            </div>
          </div>
        </div>
      </div>

      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Spend by model</span>
          <span className="prov">this month · /spend/logs</span>
        </div>
        <div style={{ padding: "8px 2px" }}>
          {(stats.by_model?.length ?? 0) === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              No per-model spend yet this month.
            </div>
          ) : (
            stats.by_model!.map((m, i) => (
              <HBar key={i} label={m.model} value={Number(m.spend) || 0} max={maxSpend} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

// A budget-used ring gauge (pure SVG; the arc starts at 12 o'clock, colour steps green→amber→red).
function Donut({ pct, tone }: { pct?: number | null; tone?: string }) {
  const has = pct != null;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const r = 42;
  const cx = 55;
  const cy = 55;
  const circ = 2 * Math.PI * r;
  const dash = (p / 100) * circ;
  const color =
    tone ?? (p > 90 ? "var(--loss, #ff6b6b)" : p > 70 ? "var(--caution, #e0a33e)" : "var(--gain, #33c27f)");
  return (
    <svg
      viewBox="0 0 110 110"
      width="112"
      height="112"
      role="img"
      aria-label={`Budget used ${has ? `${Math.round(p)} percent` : "unknown"}`}
    >
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-soft)" strokeWidth="10" />
        {has && p > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
          />
        )}
      </g>
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="21" fontWeight="700" fill="var(--foreground)">
        {has ? `${Math.round(p)}%` : "—"}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground)">
        of budget
      </text>
    </svg>
  );
}

// A horizontal spend bar for the by-model breakdown (width ∝ spend, min 2% so a nonzero bar shows).
function HBar({ label, value, max, tone }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ padding: "5px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span className="mono" style={{ wordBreak: "break-all", paddingRight: 8 }}>{label}</span>
        <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{money(value)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: "var(--border-soft)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: tone ?? "var(--accent, #6a8bff)",
            borderRadius: 5,
          }}
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="chartcard" style={{ flex: "1 1 150px", padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: tone }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{sub}</div>
      )}
    </div>
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
  const [addAlias, setAddAlias] = useState("");
  const [rpm, setRpm] = useState("");
  const [inCost, setInCost] = useState("");
  const [outCost, setOutCost] = useState("");
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [budget, setBudget] = useState("");
  const [duration, setDuration] = useState("");
  const [keyRpm, setKeyRpm] = useState("");
  const [keyTpm, setKeyTpm] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await getJSON<Config>("/config");
      const s = await getJSON<Status>("/status").catch(() => null);
      setCfg(d);
      setKeyInfo(s?.key ?? null);
      setAddAlias((prev) => prev || d.alias);
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

  const fetchPrice = useCallback(async () => {
    const m = newModel.trim();
    if (!m) return;
    try {
      const d = await getJSON<{
        found: boolean;
        inputCostPerM?: number | null;
        outputCostPerM?: number | null;
      }>(`/openrouter/price?model=${encodeURIComponent(m)}`);
      if (d.found) {
        setInCost(d.inputCostPerM != null ? String(d.inputCostPerM) : "");
        setOutCost(d.outputCostPerM != null ? String(d.outputCostPerM) : "");
        setMsg({
          kind: "ok",
          text: `OpenRouter: $${d.inputCostPerM} in · $${d.outputCostPerM} out per 1M tokens.`,
        });
      } else {
        setMsg({ kind: "err", text: "OpenRouter has no price for that model — enter it manually." });
      }
    } catch {
      setMsg({ kind: "err", text: "Couldn’t reach OpenRouter for a price." });
    }
  }, [newModel]);

  const add = useCallback(async () => {
    const upstream = newModel.trim();
    if (!upstream) {
      setMsg({ kind: "err", text: "Enter an upstream model (e.g. openrouter/deepseek/deepseek-v4-flash)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { upstream_model: upstream, alias: addAlias };
      if (rpm.trim()) body.rpm = Number(rpm.trim());
      if (inCost.trim()) body.input_cost_per_m = Number(inCost.trim());
      if (outCost.trim()) body.output_cost_per_m = Number(outCost.trim());
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
      setInCost("");
      setOutCost("");
      setMsg({ kind: "ok", text: `Added ${upstream} to ${addAlias}.` });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: "Add failed — the gateway is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [newModel, addAlias, rpm, inCost, outCost, refresh]);

  const remove = useCallback(
    async (id: string, alias: string) => {
      if (!window.confirm(`Remove this backend from the ${alias} group?`)) return;
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
        setMsg({ kind: "ok", text: `Removed a ${alias} backend.` });
        await refresh();
      } catch {
        setMsg({ kind: "err", text: "Remove failed — the gateway is unreachable." });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const saveBudget = useCallback(async () => {
    const body: Record<string, unknown> = {};
    if (budget.trim()) body.max_budget = Number(budget.trim());
    if (duration.trim()) body.budget_duration = duration.trim();
    if (keyRpm.trim()) body.rpm_limit = Number(keyRpm.trim());
    if (keyTpm.trim()) body.tpm_limit = Number(keyTpm.trim());
    if (Object.keys(body).length === 0) {
      setMsg({ kind: "err", text: "Enter at least one budget or limit to change." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${API}/key/config`, {
        method: "POST",
        headers: { "content-type": "application/json", ...CHAIN },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setMsg({ kind: "err", text: await errText(r) });
        return;
      }
      setBudget("");
      setDuration("");
      setKeyRpm("");
      setKeyTpm("");
      setMsg({ kind: "ok", text: "Updated the virtual key’s budget & limits." });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: "Update failed — the gateway is unreachable." });
    } finally {
      setBusy(false);
    }
  }, [budget, duration, keyRpm, keyTpm, refresh]);

  if (state === "loading") return <Loading />;
  if (state === "error") return <ErrBanner />;
  if (!cfg?.adminConfigured) return <AdminOffNotice />;

  // Group the gateway's deployments by alias (model_name) so EVERY alias is visible + editable — the
  // chat default AND the premium alias. Add/remove + a per-alias last-backend guardrail apply to each.
  // Prices come from LiteLLM's model_info (set them when adding, or auto-fill from OpenRouter).
  const byAlias: Record<string, Deployment[]> = {};
  for (const d of cfg.deployments) (byAlias[d.model_name] ??= []).push(d);
  const aliases = Object.keys(byAlias).sort((a, b) =>
    a === cfg.alias ? -1 : b === cfg.alias ? 1 : a.localeCompare(b),
  );
  const priceLabel = (d: Deployment) => priceText(d.inputCostPerM, d.outputCostPerM);
  return (
    <>
      {aliases.length === 0 && (
        <div className="chartcard">
          <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>No deployments.</div>
        </div>
      )}
      {aliases.map((alias) => {
        const deps = byAlias[alias];
        const isPrimary = alias === cfg.alias;
        const distinctIds = new Set(deps.map((d) => d.id).filter(Boolean)).size;
        const isLast = distinctIds <= 1;
        return (
          <div className="chartcard" key={alias} style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">
                {alias}{" "}
                <span className="prov">{isPrimary ? "chat default" : "premium"}</span>
              </span>
            </div>
            <div style={{ padding: "4px 2px" }}>
              {deps.map((d) => (
                <div key={d.id || d.upstream} style={rowStyle}>
                  <span className="mono" style={{ flex: 1, wordBreak: "break-all", fontSize: 12.5 }}>
                    {d.upstream || d.id}
                  </span>
                  <span className="muted" style={{ width: 140, textAlign: "right", fontSize: 11.5 }}>
                    {priceLabel(d)}
                  </span>
                  <span className="muted" style={{ width: 58, textAlign: "right", fontSize: 12 }}>
                    rpm {fmt(d.rpm)}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || isLast}
                    onClick={() => remove(d.id, alias)}
                    title={
                      isLast
                        ? "Can’t remove the last backend — this alias would have none"
                        : `Remove ${d.id}`
                    }
                  >
                    <Icon name="x" size={13} /> Remove
                  </button>
                </div>
              ))}
            </div>
            {isLast && (
              <div className="muted" style={{ padding: "6px 10px", fontSize: 11.5 }}>
                Only one backend serves this alias — the last one can’t be removed (guardrail).
              </div>
            )}
          </div>
        );
      })}

      <div className="chartcard" style={{ marginTop: 14 }}>
        <div className="ch">
          <span className="ct">Add a deployment</span>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            padding: "10px 8px 4px",
            alignItems: "center",
          }}
        >
          <select
            value={addAlias}
            onChange={(e) => setAddAlias(e.target.value)}
            style={{ ...inputStyle, width: 200 }}
            title="Which alias this backend joins"
          >
            {aliases.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            className="mono"
            placeholder="openrouter/deepseek/deepseek-v4-flash"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 240px" }}
          />
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy || !newModel.trim()}
            onClick={fetchPrice}
            title="Auto-fill the price from OpenRouter"
          >
            <Icon name="coins" size={13} /> price
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            padding: "0 8px 10px",
            alignItems: "center",
          }}
        >
          <input
            placeholder="in $ / 1M"
            value={inCost}
            onChange={(e) => setInCost(e.target.value)}
            inputMode="decimal"
            style={{ ...inputStyle, width: 110 }}
          />
          <input
            placeholder="out $ / 1M"
            value={outCost}
            onChange={(e) => setOutCost(e.target.value)}
            inputMode="decimal"
            style={{ ...inputStyle, width: 110 }}
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
          <span className="ct">Virtual key — budget &amp; limits</span>
          <span className="prov">abuse ceiling</span>
        </div>
        <div className="muted" style={{ fontSize: 12, padding: "2px 10px 4px" }}>
          The hard spend cap + rate limits on the single key that fronts all inference. Leave a field
          blank to keep its current value.
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            padding: "6px 8px 12px",
            alignItems: "flex-end",
          }}
        >
          <Field label={`Budget $ (now ${fmt(keyInfo?.max_budget)})`}>
            <input
              placeholder="e.g. 5"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              style={{ ...inputStyle, width: 110 }}
            />
          </Field>
          <Field label={`Resets (now ${fmt(keyInfo?.budget_duration)})`}>
            <input
              placeholder="e.g. 1d"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={{ ...inputStyle, width: 90 }}
            />
          </Field>
          <Field label={`RPM (now ${fmt(keyInfo?.rpm_limit)})`}>
            <input
              placeholder="e.g. 20"
              value={keyRpm}
              onChange={(e) => setKeyRpm(e.target.value)}
              inputMode="numeric"
              style={{ ...inputStyle, width: 90 }}
            />
          </Field>
          <Field label={`TPM (now ${fmt(keyInfo?.tpm_limit)})`}>
            <input
              placeholder="e.g. 40000"
              value={keyTpm}
              onChange={(e) => setKeyTpm(e.target.value)}
              inputMode="numeric"
              style={{ ...inputStyle, width: 100 }}
            />
          </Field>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveBudget}>
            <Icon name="check" size={14} /> Save
          </button>
        </div>
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
