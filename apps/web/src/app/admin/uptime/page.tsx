"use client";

/**
 * Admin → Uptime (R5 B4). Renders the SparkPoint develop monitors from Uptime Kuma via the same-
 * origin BFF (`/api/agent/admin/uptime`), which the agent serves by reading Kuma's PUBLIC status-page
 * JSON server-side (KUMA_URL lives in the agent env only — never in the browser). A LAN Kuma iframe is
 * impossible (the browser can't reach the LAN host); this is the admin-visible uptime without a
 * separate URL/creds. Read-only; never touches custody.
 */

import { useEffect, useState } from "react";

interface Monitor {
  name: string;
  status: string;
  up: boolean;
  ping: number | null;
  message: string | null;
  uptime24h: number | null;
}
interface Uptime {
  configured: boolean;
  reachable?: boolean;
  monitors: Monitor[];
  statusPageUrl: string | null;
}

const pct = (v: number | null) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);

export default function Page() {
  const [data, setData] = useState<Uptime | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/agent/admin/uptime", { headers: { "x-chain-id": "84532" }, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Uptime) => live && (setData(d), setState("ok")))
        .catch(() => live && setState("error"));
    void load();
    const t = setInterval(load, 30_000); // refresh while the tab is open
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const monitors = data?.monitors ?? [];
  const allUp = monitors.length > 0 && monitors.every((m) => m.up);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Uptime</h1>
          <div className="sub">
            SparkPoint develop monitors from Uptime Kuma (read server-side; the LAN host isn’t
            browser-reachable). Read-only.
          </div>
        </div>
        <span className={`pill ${state === "loading" ? "info" : allUp ? "ok" : "amber"}`}>
          <span className="led" />
          {state === "loading"
            ? "Checking…"
            : !data?.configured
              ? "Not configured"
              : allUp
                ? "All systems up"
                : "Degraded"}
        </span>
      </div>

      {state === "error" && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          Couldn’t load uptime.
        </div>
      )}
      {data && !data.configured && (
        <div className="infobanner" style={{ background: "var(--caution-subtle)" }}>
          Uptime isn’t wired to this deployment (<span className="mono">KUMA_URL</span> unset on the agent).
        </div>
      )}

      <div className="chartcard">
        <div className="ch">
          <span className="ct">Monitors</span>
          {data?.statusPageUrl && (
            <a
              className="prov"
              href={data.statusPageUrl}
              target="_blank"
              rel="noreferrer"
              title="Only reachable from the ops LAN"
              style={{ color: "var(--primary)" }}
            >
              Open Kuma (LAN only)
            </a>
          )}
        </div>
        <div style={{ padding: "4px 2px" }}>
          {monitors.length === 0 ? (
            <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
              {state === "loading" ? "Loading…" : "No monitors reported."}
            </div>
          ) : (
            monitors.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 8px",
                  borderTop: "1px solid var(--border-soft)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    flex: "none",
                    background: m.up ? "var(--gain)" : m.status === "pending" ? "var(--caution)" : "var(--loss, #ff6b6b)",
                  }}
                />
                <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                <span className="muted mono" style={{ width: 80, textAlign: "right", fontSize: 12 }}>
                  {m.ping != null ? `${m.ping} ms` : "—"}
                </span>
                <span className="muted" style={{ width: 90, textAlign: "right", fontSize: 12 }}>
                  {pct(m.uptime24h)} 24h
                </span>
                <span
                  style={{
                    width: 74,
                    textAlign: "right",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    color: m.up ? "var(--gain)" : "var(--caution)",
                  }}
                >
                  {m.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
