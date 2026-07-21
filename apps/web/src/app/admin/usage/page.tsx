"use client";

/**
 * Admin → Usage & limits (feature 008, US3).
 *
 * REAL per-tier AI consumption + throttle/deny rate from the limits engine, via the same-origin
 * BFF (`/api/agent/admin/usage/*`, admin-gated → 404 to non-admins). Sourced from the agent's
 * usage counters (allow volume) + the limits-event feed (deny/throttle). Wallets are MASKED and no
 * prompt/message content is ever shown. Honest-degrade: if the data source isn't available yet
 * (0015 not applied), it says so rather than fabricating numbers.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icons";

interface TierUsage {
  tier: string;
  wallets: number;
  turns: number;
}
interface Summary {
  configured: boolean;
  window?: string;
  byTier?: TierUsage[];
  totals?: { turns: number; deny: number; throttle: number };
  throttleRate?: number;
}
interface Consumer {
  subject: string;
  tier: string;
  turns: number;
}
interface UsageEvent {
  verdict: string;
  metric: string;
  tier: string;
  subject: string | null;
  at: string;
}

const CHAIN_HEADERS = { "x-chain-id": "84532" };

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  const r = await fetch(`/api/agent/admin/usage/${path}`, { headers: CHAIN_HEADERS, cache: "no-store" });
  if (!r.ok) return fallback;
  return (await r.json()) as T;
}

const TIER_COLORS: Record<string, string> = {
  free: "var(--muted-foreground)",
  premium: "var(--primary)",
  unknown: "var(--border)",
};

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="chartcard" style={{ flex: "1 1 160px", padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: tone }}>
        {value}
      </div>
    </div>
  );
}

export default function Page() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [s, top, ev] = await Promise.all([
      getJSON<Summary>("summary", { configured: false }),
      getJSON<{ configured: boolean; consumers?: Consumer[] }>("top", { configured: false }),
      getJSON<{ configured: boolean; events?: UsageEvent[] }>("events", { configured: false }),
    ]);
    setSummary(s);
    setConsumers(top.consumers ?? []);
    setEvents(ev.events ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // On-mount + 30s poll (external-system sync, not derived state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const configured = summary?.configured === true;
  const byTier = summary?.byTier ?? [];
  const maxTurns = Math.max(1, ...byTier.map((t) => t.turns));
  const totals = summary?.totals ?? { turns: 0, deny: 0, throttle: 0 };
  const rate = ((summary?.throttleRate ?? 0) * 100).toFixed(1);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Usage &amp; limits</h1>
          <div className="sub">
            Per-tier AI consumption and throttle/deny rate this period. Masked wallets; no message content.
          </div>
        </div>
        <span className={`pill ${configured ? "ok" : "info"}`}>
          <span className="led" />
          {configured ? "Live" : loaded ? "No data yet" : "Loading…"}
        </span>
      </div>

      {!configured && (
        <div
          className="infobanner"
          style={{ background: "var(--info-subtle, var(--surface-2))", borderColor: "var(--border-soft)" }}
        >
          <Icon name="info" size={16} />
          <span>
            No usage data yet. Once the <b style={{ color: "var(--foreground)" }}>0015 migration</b> is
            applied and the assistant sees traffic, per-tier consumption and the throttle/deny rate appear
            here — from real counters, never fabricated.
          </span>
        </div>
      )}

      {configured && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <Kpi label="Assistant turns (today)" value={String(totals.turns)} />
            <Kpi label="Denied (over cap)" value={String(totals.deny)} tone="var(--caution)" />
            <Kpi label="Throttled (busy)" value={String(totals.throttle)} tone="var(--caution)" />
            <Kpi
              label="Throttle / deny rate"
              value={`${rate}%`}
              tone={Number(rate) > 20 ? "var(--loss)" : undefined}
            />
          </div>

          <div className="chartcard" style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">Consumption by tier</span>
              <span className="prov">turns today</span>
            </div>
            <div style={{ padding: "10px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
              {byTier.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "6px 4px" }}>
                  No turns recorded this period.
                </div>
              ) : (
                byTier.map((t) => (
                  <div key={t.tier} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 80, fontSize: 13, textTransform: "capitalize" }}>{t.tier}</span>
                    <div style={{ flex: 1, background: "var(--border-soft)", borderRadius: 6, height: 20 }}>
                      <div
                        style={{
                          width: `${Math.round((t.turns / maxTurns) * 100)}%`,
                          minWidth: t.turns > 0 ? 4 : 0,
                          height: "100%",
                          borderRadius: 6,
                          background: TIER_COLORS[t.tier] ?? "var(--primary)",
                        }}
                      />
                    </div>
                    <span className="tnum mono" style={{ width: 96, textAlign: "right", fontSize: 12.5 }}>
                      {t.turns} · {t.wallets}w
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="chartcard" style={{ marginBottom: 14 }}>
            <div className="ch">
              <span className="ct">Top consumers</span>
              <span className="prov">masked</span>
            </div>
            <div style={{ padding: "4px 2px" }}>
              {consumers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "10px 8px" }}>
                  No consumers yet.
                </div>
              ) : (
                consumers.map((c, i) => (
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
                    <span className="mono" style={{ flex: 1 }}>{c.subject}</span>
                    <span style={{ width: 70, color: "var(--muted-foreground)", textTransform: "capitalize" }}>
                      {c.tier}
                    </span>
                    <span className="tnum" style={{ width: 60, textAlign: "right" }}>{c.turns}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="chartcard">
            <div className="ch">
              <span className="ct">Recent throttle / deny events</span>
              <span className="prov">newest first</span>
            </div>
            <div style={{ padding: "4px 2px" }}>
              {events.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "10px 8px" }}>
                  No throttle or deny events — limits aren&rsquo;t biting.
                </div>
              ) : (
                events.map((e, i) => (
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
                    <span
                      style={{
                        width: 64,
                        color: e.verdict === "deny" ? "var(--loss, #ff6b6b)" : "var(--caution)",
                      }}
                    >
                      {e.verdict}
                    </span>
                    <span style={{ width: 84, color: "var(--muted-foreground)" }}>{e.metric}</span>
                    <span style={{ width: 64, color: "var(--muted-foreground)" }}>{e.tier}</span>
                    <span className="mono" style={{ flex: 1 }}>{e.subject ?? "—"}</span>
                    <span className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
