"use client";

/**
 * Admin → LLM gateway (Phase B, item #11a).
 *
 * REAL, admin-gated read of the LiteLLM proxy via the same-origin BFF (`/api/agent/admin/llm/status`,
 * which the agent serves using the virtual key it already holds — no master key placed anywhere).
 * Shows reachability, the configured models, and the virtual key's spend / budget / rate limits.
 * Read-only: this never mutates gateway config and never touches custody.
 */

import { useEffect, useState } from "react";

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
  budget_reset_at?: string | null;
}
interface Status {
  configured: boolean;
  base?: string;
  reachable: boolean;
  modelAlias?: string;
  models: GatewayModel[];
  key: KeyInfo | null;
}

const fmt = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const money = (v?: number) => (v === undefined || v === null ? "—" : `$${Number(v).toFixed(4)}`);

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/agent/admin/llm/status", {
          headers: { "x-chain-id": "84532" },
          cache: "no-store",
        });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as Status;
        if (live) {
          setStatus(data);
          setState("ok");
        }
      } catch {
        if (live) setState("error");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const reachable = status?.reachable ?? false;
  const key = status?.key ?? null;

  return (
    <>
      <div className="pghead">
        <div>
          <h1>LLM gateway</h1>
          <div className="sub">
            LiteLLM proxy → OpenRouter. Models, virtual-key spend and rate limits. Read-only.
          </div>
        </div>
        <span className={`pill ${state === "ok" && reachable ? "ok" : state === "loading" ? "info" : "amber"}`}>
          <span className="led" />
          {state === "loading"
            ? "Checking…"
            : !status?.configured
              ? "Not configured"
              : reachable
                ? "Reachable"
                : "Unreachable"}
        </span>
      </div>

      {state === "error" && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}>
          Couldn’t load gateway status.
        </div>
      )}

      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Gateway</span>
            <span className="prov">live</span>
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
              <Row k="Budget window" v={fmt(key.budget_duration)} />
              <Row k="RPM limit" v={fmt(key.rpm_limit)} />
              <Row k="TPM limit" v={fmt(key.tpm_limit)} />
            </dl>
          ) : (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {state === "loading" ? "Loading…" : "Virtual-key info not available from this gateway."}
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
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px",
                  borderTop: "1px solid var(--border-soft)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: "0 0 180px", fontWeight: 600 }}>{m.name}</span>
                <span className="mono muted" style={{ flex: 1, wordBreak: "break-all" }}>
                  {m.upstream || "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="infobanner" style={{ marginTop: 14, background: "var(--info-subtle, var(--surface-2))", borderColor: "var(--border-soft)" }}>
        Per-user budgets are keyed off the LiteLLM <span className="mono">user</span> field (the
        SIWE-verified wallet), now threaded from the planner / recommender / literacy callers.
      </div>
    </>
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
