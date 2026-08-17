"use client";

/**
 * 035 — the original /admin/allowlist screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


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
/** 026 — one pending access application as the agent serves it. */
interface ApplicationRow {
  address: string;
  contact: string;
  name: string;
  reason: string;
  status: string;
  submittedAt: string;
  /**
   * 045 — how the address got here. `"wallet"`: filed from a signed-in session, so the applicant
   * PROVED they control it. `"public"`: typed into the landing-page form by someone who proved
   * nothing. Optional because an agent predating migration 0036 omits the field; absent is read as
   * `"wallet"`, which is what every pre-045 row genuinely was.
   */
  source?: string;
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

/**
 * 026 — access applications from wallets that weren't on the allowlist. Approving is exactly the
 * `beta` add above (the agent does it server-side and audit-logs it identically), so this panel
 * adds a review queue, not a second access mechanism. Denying grants nothing and revokes nothing.
 */
/**
 * 045 — whether anyone proved this address, shown next to it rather than buried in the detail rows.
 *
 * This is the single most important fact on the row and the one the reviewer cannot recover any
 * other way. Approving adds the address to `beta`; if it arrived through the public form, the
 * person who typed it may not control it, and the person who does may not have asked for anything.
 * A queue that renders both kinds identically is asking for a decision without the facts.
 */
function SourceTag({ source }: { source?: string }) {
  const isPublic = source === "public";
  return (
    <span
      className="prov"
      title={
        isPublic
          ? "Submitted from the public form on the landing page — the address was typed in, not signed for. Verify it out-of-band before approving."
          : "Filed from a signed-in session — the applicant proved they control this address."
      }
      style={{
        fontSize: 11,
        whiteSpace: "nowrap",
        color: isPublic ? "var(--warn, #d08700)" : "var(--muted-foreground)",
        border: `1px solid ${isPublic ? "var(--warn, #d08700)" : "var(--border-soft)"}`,
        borderRadius: 999,
        padding: "1px 8px",
      }}
    >
      {isPublic ? "unverified · public form" : "wallet-signed"}
    </span>
  );
}

function PendingApplications({ onDecided }: { onDecided: () => Promise<void> }) {
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/admin/access/applications?status=pending", {
        headers: CHAIN_HEADERS,
        cache: "no-store",
      });
      // 404 = this agent doesn't serve the endpoint yet (migration 0029 not deployed): show the
      // empty state, never an error — the rest of the page must keep working.
      setApps(r.ok ? (((await r.json()).applications ?? []) as ApplicationRow[]) : []);
    } catch {
      setApps([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const decide = useCallback(
    async (address: string, approve: boolean) => {
      setBusy(address);
      setNote(null);
      try {
        const r = await fetch(
          `/api/agent/admin/access/applications/${approve ? "approve" : "deny"}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...CHAIN_HEADERS },
            body: JSON.stringify({ address }),
          },
        );
        if (!r.ok) throw new Error(`${approve ? "Approve" : "Deny"} failed (${r.status})`);
        setNote({
          kind: "ok",
          text: `${approve ? "Approved" : "Denied"} ${short(address)}${approve ? " — added to beta." : "."}`,
        });
        await load();
        if (approve) await onDecided();
      } catch (e) {
        setNote({ kind: "err", text: e instanceof Error ? e.message : "Decision failed" });
      } finally {
        setBusy(null);
      }
    },
    [load, onDecided],
  );

  return (
    <div className="chartcard" style={{ marginTop: 14 }}>
      <div className="ch">
        <span className="ct">
          Pending applications <span className="prov">{apps.length}</span>
        </span>
        <span className="prov">approve = add to beta</span>
      </div>
      <div style={{ padding: "4px 2px" }}>
        {apps.length === 0 ? (
          <div className="muted" style={{ padding: "10px 8px", fontSize: 13 }}>
            {loaded ? "No applications waiting for review." : "Loading…"}
          </div>
        ) : (
          apps.map((a) => (
            <div key={a.address} style={{ padding: "10px 8px", borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 12.5, flex: "1 1 320px", wordBreak: "break-all" }}>
                  {a.address}
                </span>
                <SourceTag source={a.source} />
                <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                  {a.submittedAt ? new Date(a.submittedAt).toLocaleString() : ""}
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void decide(a.address, true)}
                >
                  <Icon name="check" size={14} /> Approve
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() => void decide(a.address, false)}
                >
                  <Icon name="x" size={14} /> Deny
                </button>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                <span>
                  <span className="muted">Name / alias: </span>
                  {a.name}
                </span>
                <span>
                  <span className="muted">Contact: </span>
                  {a.contact}
                </span>
                <span style={{ lineHeight: 1.5 }}>
                  <span className="muted">Reason: </span>
                  {a.reason}
                </span>
              </div>
            </div>
          ))
        )}
        {note && (
          <div
            style={{
              padding: "6px 8px",
              fontSize: 12.5,
              color: note.kind === "ok" ? "var(--gain)" : "var(--loss, #ff6b6b)",
            }}
          >
            {note.text}
          </div>
        )}
      </div>
    </div>
  );
}

export function AllowlistPanel() {
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
          <span className="ct">Beta-gate controls</span>
          <span className="prov">§6.4</span>
        </div>
        <div style={{ padding: "4px 2px" }}>
          <div className="statusrow">
            <span>Wallet whitelist enforcement</span>
            <span className="pill ok" style={{ fontSize: 10 }}>
              <span className="led" /> Enforced · this page + session
            </span>
          </div>
          <div className="statusrow">
            <span>Geo-fenced frontend</span>
            <span className="pill amber" style={{ fontSize: 10 }}>
              <Icon name="info" size={12} /> Scaffolded · not enforced
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
            <Icon name="info" size={13} /> Geo-fencing has its UI + <span className="mono">GEO_BLOCKED</span> (451) seam wired, but the
            jurisdiction check (<span className="mono">checkGeoAllowed</span>) is still a placeholder — no country is blocked today.
            Real enforcement needs a jurisdiction policy + a geo-providing edge (e.g. Cloudflare), scheduled for the
            real-money (Phase-4) gate. Surfaced here so the control&rsquo;s true state is never assumed.
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

      <PendingApplications onDecided={refresh} />


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
