"use client";

/**
 * Admin → Limits & Tiers (feature 008, US2).
 *
 * REAL, admin-gated editing of the per-tier AI limits (daily caps, concurrency, priority, model
 * alias) + premium grant/revoke, via the same-origin BFF (`/api/agent/admin/limits/*`). The BFF
 * injects the verified admin's X-Owner; the agent gates every call on `admin` role (a non-admin
 * gets 404) and audits every write. Changes take effect on the NEXT request — no redeploy.
 *
 * This configures an ADVISORY-COMPUTE gate only: it can slow or cap chat/recommendations, and it
 * NEVER moves funds or blocks a withdrawal (/exit + withdraw stay open regardless, N2).
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

interface Tier {
  tier: string;
  displayName: string;
  chatDailyLimit: number;
  recsDailyLimit: number;
  onboardingDailyLimit: number;
  concurrency: number;
  priorityWeight: number;
  modelAlias: string;
  isDefault: boolean;
}
interface AuditEntry {
  action: string;
  subject: string;
  actor: string | null;
  at: string;
}

const CHAIN_HEADERS = { "x-chain-id": "84532" };
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

const NUM_FIELDS: { key: keyof Tier; label: string }[] = [
  { key: "chatDailyLimit", label: "Chat turns / day" },
  { key: "recsDailyLimit", label: "Recommendations / day" },
  { key: "onboardingDailyLimit", label: "Onboarding turns / day" },
  { key: "concurrency", label: "Concurrent slots" },
  { key: "priorityWeight", label: "Priority weight" },
];

async function listTiers(): Promise<Tier[]> {
  const r = await fetch("/api/agent/admin/limits/tiers", { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load tiers (${r.status})`);
  return ((await r.json()).tiers ?? []) as Tier[];
}

async function listAudit(): Promise<AuditEntry[]> {
  const r = await fetch("/api/agent/admin/limits/audit?limit=25", {
    headers: CHAIN_HEADERS,
    cache: "no-store",
  });
  if (!r.ok) return [];
  return ((await r.json()).entries ?? []) as AuditEntry[];
}

async function errMessage(res: Response, fallback: string): Promise<string> {
  const detail = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return detail.error?.message ?? `${fallback} (${res.status})`;
}

const INPUT_STYLE: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--surface-2, transparent)",
  color: "var(--foreground)",
  fontSize: 13,
  width: "100%",
};

export default function Page() {
  const [drafts, setDrafts] = useState<Record<string, Tier>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantAddr, setGrantAddr] = useState("");
  const [grantTier, setGrantTier] = useState("premium");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tiers, log] = await Promise.all([listTiers(), listAudit()]);
      setDrafts(Object.fromEntries(tiers.map((t) => [t.tier, t])));
      setOrder(tiers.map((t) => t.tier));
      setAudit(log);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load tiers");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // On-mount fetch (state set inside the async callback after the awaits — external sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const setField = (tier: string, key: keyof Tier, value: number | string) =>
    setDrafts((d) => ({ ...d, [tier]: { ...d[tier], [key]: value } }));

  const saveTier = useCallback(
    async (tier: string) => {
      const t = drafts[tier];
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/agent/admin/limits/tiers", {
          method: "POST",
          headers: { "content-type": "application/json", ...CHAIN_HEADERS },
          body: JSON.stringify(t),
        });
        if (!res.ok) throw new Error(await errMessage(res, "Save failed"));
        setMsg({ kind: "ok", text: `Saved ${t.displayName} limits — effective on the next request.` });
        await refresh();
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
      } finally {
        setBusy(false);
      }
    },
    [drafts, refresh],
  );

  const membership = useCallback(
    async (action: "assign" | "revoke") => {
      const address = grantAddr.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        setMsg({ kind: "err", text: "Enter a valid 0x wallet address." });
        return;
      }
      setBusy(true);
      setMsg(null);
      try {
        const body = action === "assign" ? { address, tier: grantTier } : { address };
        const res = await fetch(`/api/agent/admin/limits/tiers/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...CHAIN_HEADERS },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errMessage(res, `${action} failed`));
        setGrantAddr("");
        const label = action === "assign" ? `Granted ${grantTier} to` : "Reverted to default:";
        setMsg({ kind: "ok", text: `${label} ${short(address)}.` });
        await refresh();
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : `${action} failed` });
      } finally {
        setBusy(false);
      }
    },
    [grantAddr, grantTier, refresh],
  );

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Limits &amp; Tiers</h1>
          <div className="sub">
            Per-tier AI limits &amp; priority compute. Effective on the next request, audited.
            Advisory compute only — never funds or withdrawals.
          </div>
        </div>
      </div>

      <div className="infobanner">
        <Icon name="info" size={16} />
        <span>
          These limits shape the AI assistant only.{" "}
          <b style={{ color: "var(--foreground)" }}>They cannot move funds or block withdrawals.</b> The
          free tier stays fully capable; premium only adds higher caps and priority.
        </span>
      </div>

      {loadErr && (
        <div className="panel" style={{ color: "var(--muted-foreground)" }}>
          Couldn&rsquo;t load tier limits: {loadErr}. (Requires the 0015 migration applied + admin access.)
        </div>
      )}

      {!loaded && !loadErr && <div className="panel muted">Loading tiers…</div>}

      {order.map((name) => {
        const t = drafts[name];
        if (!t) return null;
        return (
          <div className="chartcard" key={name} style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">
                {t.displayName}{" "}
                {t.isDefault && <span className="pill info" style={{ marginLeft: 6 }}>default</span>}
              </span>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveTier(name)}>
                <Icon name="check" size={14} /> Save
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                padding: "12px 4px",
              }}
            >
              {NUM_FIELDS.map((f) => (
                <label key={f.key} style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  {f.label}
                  <input
                    type="number"
                    min={0}
                    className="mono"
                    value={String(t[f.key] as number)}
                    disabled={busy}
                    onChange={(e) => setField(name, f.key, Math.max(0, Number(e.target.value) || 0))}
                    style={{ ...INPUT_STYLE, marginTop: 4 }}
                  />
                </label>
              ))}
              <label style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Model alias
                <input
                  className="mono"
                  value={t.modelAlias}
                  disabled={busy}
                  onChange={(e) => setField(name, "modelAlias", e.target.value)}
                  style={{ ...INPUT_STYLE, marginTop: 4 }}
                />
              </label>
            </div>
          </div>
        );
      })}

      <div className="chartcard" style={{ marginBottom: 14 }}>
        <div className="ch">
          <span className="ct">Premium membership</span>
        </div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "10px 4px", alignItems: "center" }}
        >
          <input
            className="mono"
            placeholder="0x… wallet address"
            value={grantAddr}
            onChange={(e) => setGrantAddr(e.target.value)}
            style={{ ...INPUT_STYLE, flex: "1 1 320px", width: "auto" }}
          />
          <select
            value={grantTier}
            onChange={(e) => setGrantTier(e.target.value)}
            style={{ ...INPUT_STYLE, width: "auto" }}
          >
            {order.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => membership("assign")}>
            <Icon name="plus" size={14} /> Grant
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => membership("revoke")}>
            <Icon name="x" size={14} /> Revoke
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

      <div className="chartcard">
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
                <span style={{ width: 90, color: e.action === "revoke" ? "var(--loss, #ff6b6b)" : "var(--gain)" }}>
                  {e.action}
                </span>
                <span className="mono" style={{ flex: 1, wordBreak: "break-all" }}>
                  {e.subject}
                </span>
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
