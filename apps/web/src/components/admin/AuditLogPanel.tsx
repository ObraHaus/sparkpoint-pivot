"use client";

/**
 * 035 — the original /admin/audit screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → Audit log (Phase B.1: REAL data, no fabrication).
 *
 * Wired to the agent's append-only allowlist audit (`/admin/allowlist/audit` via the BFF) — the
 * only admin-action audit that actually exists today (every beta/admin add/remove/seed). A broader
 * admin-action audit (logins, exports, config changes) is not yet instrumented and is honestly NOT
 * shown as if it were. Empty state is shown honestly when there are no changes.
 */

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  action: string;
  address: string;
  role: string;
  actor: string | null;
  at: string;
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/admin/allowlist/audit?limit=100", {
        headers: { "x-chain-id": "84532" },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(String(r.status));
      setEntries(((await r.json()) as { entries?: AuditEntry[] }).entries ?? []);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Audit log</h1>
          <div className="sub">
            Append-only record of allowlist changes (add / remove / seed of beta &amp; admin wallets).
            Broader admin-action auditing is not yet instrumented.
          </div>
        </div>
        <span className={`pill ${state === "ok" ? "ok" : state === "loading" ? "info" : "amber"}`}>
          <span className="led" />
          {state === "loading" ? "Loading…" : state === "error" ? "Unavailable" : `${entries.length} entries`}
        </span>
      </div>
      <div className="panel">
        {entries.length === 0 ? (
          <div className="muted" style={{ padding: "14px 4px", fontSize: 13 }}>
            {state === "loading"
              ? "Loading…"
              : state === "error"
                ? "Couldn’t load the audit log."
                : "No allowlist changes recorded yet."}
          </div>
        ) : (
          <table className="adtbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Role</th>
                <th>Wallet</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{new Date(e.at).toLocaleString()}</td>
                  <td className="mono">{e.actor ?? "—"}</td>
                  <td>
                    <span className={`pill ${e.action === "remove" ? "amber" : "ok"}`}>{e.action}</span>
                  </td>
                  <td>{e.role}</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>{e.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
