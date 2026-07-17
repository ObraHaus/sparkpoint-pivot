"use client";

/**
 * Admin → Allowlist management (Phase B, item #11b).
 *
 * REAL, admin-gated CRUD over the agent's DB-backed beta/admin allowlist, via the same-origin BFF
 * (`/api/agent/admin/allowlist*`). The BFF injects the verified admin's X-Owner; the agent gates
 * every call on `admin` role (a non-admin gets 404). Every add/remove is audit-logged server-side
 * and shown below. This governs ACCESS only — it never touches custody (/exit + withdraw stay open).
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

type Role = "beta" | "admin";
interface AuditEntry {
  action: string;
  address: string;
  role: string;
  actor: string | null;
  at: string;
}

const CHAIN_HEADERS = { "x-chain-id": "84532" };
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

async function listRole(role: Role): Promise<string[]> {
  const r = await fetch(`/api/agent/admin/allowlist?role=${role}`, {
    headers: CHAIN_HEADERS,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Failed to load ${role} list (${r.status})`);
  return ((await r.json()).addresses ?? []) as string[];
}

async function listAudit(): Promise<AuditEntry[]> {
  const r = await fetch(`/api/agent/admin/allowlist/audit?limit=25`, {
    headers: CHAIN_HEADERS,
    cache: "no-store",
  });
  if (!r.ok) return [];
  return ((await r.json()).entries ?? []) as AuditEntry[];
}

export default function Page() {
  const [beta, setBeta] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addr, setAddr] = useState("");
  const [role, setRole] = useState<Role>("beta");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [b, a, log] = await Promise.all([listRole("beta"), listRole("admin"), listAudit()]);
      setBeta(b);
      setAdmins(a);
      setAudit(log);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to load allowlists" });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // On-mount fetch of the allowlists (state is set inside refresh's async callback, after the
    // awaits — external-system sync, not a derived-state effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    const address = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setMsg({ kind: "err", text: "Enter a valid 0x wallet address." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/agent/admin/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json", ...CHAIN_HEADERS },
        body: JSON.stringify({ address, role }),
      });
      if (!r.ok) throw new Error(`Add failed (${r.status})`);
      setAddr("");
      setMsg({ kind: "ok", text: `Added ${short(address)} to ${role}.` });
      await refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Add failed" });
    } finally {
      setBusy(false);
    }
  }, [addr, role, refresh]);

  const remove = useCallback(
    async (address: string, r: Role) => {
      setBusy(true);
      setMsg(null);
      try {
        // POST (not DELETE): the same-origin BFF proxy forwards only GET/POST, so removal is a POST
        // to …/{role}/delete with the address in the body (the RESTful DELETE never reaches the agent).
        const res = await fetch(`/api/agent/admin/allowlist/${r}/delete`, {
          method: "POST",
          headers: { "content-type": "application/json", ...CHAIN_HEADERS },
          body: JSON.stringify({ address }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(detail.error?.message ?? `Remove failed (${res.status})`);
        }
        setMsg({ kind: "ok", text: `Removed ${short(address)} from ${r}.` });
        await refresh();
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : "Remove failed" });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const column = (title: string, list: string[], r: Role) => (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">
          {title} <span className="prov">{list.length}</span>
        </span>
      </div>
      <div style={{ padding: "4px 2px" }}>
        {list.length === 0 ? (
          <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
            {loaded ? "No wallets yet." : "Loading…"}
          </div>
        ) : (
          list.map((a) => (
            <div
              key={a}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 8px",
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              <span className="mono" style={{ fontSize: 12.5, flex: 1, wordBreak: "break-all" }}>
                {a}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => remove(a, r)}
                title={`Remove from ${r}`}
              >
                <Icon name="x" size={14} /> Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Allowlist</h1>
          <div className="sub">
            Who may enter the app (beta) and the admin panel (admin). DB-backed, audit-logged.
            Access only — never gates /exit, /trust, or withdrawals.
          </div>
        </div>
      </div>

      <div className="chartcard" style={{ marginBottom: 14 }}>
        <div className="ch">
          <span className="ct">Add a wallet</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 4px", alignItems: "center" }}>
          <input
            className="mono"
            placeholder="0x… wallet address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            style={{
              flex: "1 1 340px",
              padding: "9px 11px",
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
              background: "var(--surface-2, transparent)",
              color: "var(--foreground)",
              fontSize: 13,
            }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            style={{
              padding: "9px 11px",
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
              background: "var(--surface-2, transparent)",
              color: "var(--foreground)",
              fontSize: 13,
            }}
          >
            <option value="beta">beta</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={add}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
        {msg && (
          <div
            style={{
              padding: "6px 8px",
              fontSize: 12.5,
              color: msg.kind === "ok" ? "var(--gain)" : "var(--loss, #ff6b6b)",
            }}
          >
            {msg.text}
          </div>
        )}
      </div>

      <div className="grid2">
        {column("Beta wallets", beta, "beta")}
        {column("Admin wallets", admins, "admin")}
      </div>

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
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "7px 8px",
                  borderTop: "1px solid var(--border-soft)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ width: 62, color: e.action === "remove" ? "var(--loss, #ff6b6b)" : "var(--gain)" }}>
                  {e.action}
                </span>
                <span style={{ width: 52, color: "var(--muted-foreground)" }}>{e.role}</span>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{e.address}</span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>
                  {new Date(e.at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
