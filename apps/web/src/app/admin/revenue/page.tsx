"use client";

/**
 * Admin → Revenue ★ — the REAL revenue dashboard (feature 013/014), MULTI-NETWORK. Reads
 * GET /admin/revenue/summary ({ networks: [...] }) and renders each network's streams in its own
 * section, each stream honest about its own state, in its own units. It reads NOTHING from
 * `components/admin/data.tsx` (no `$13.9K`/`$82.8K` mock literal), shows a per-stream
 * "not tracked" state when a source is off / not applicable to that network, and honest-degrades to
 * a plain "cannot load" when the fetch fails. Swap fees are attributed per network (never
 * cross-counted). No cross-network total is shown — streams are in different tokens.
 */

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { STREAM, StackedBars } from "@/components/admin/charts";
import { RevenueMultisig } from "@/components/admin/revenue-multisig";
import { Icon } from "@/lib/icons";

interface StreamSeries {
  configured: boolean;
  cumulativeRaw: string;
  tokenDecimals: number | null;
  periods: { periodStart: string; valueRaw: string }[];
  disclosures: string[];
}
interface NetworkRevenue {
  networkId: string;
  chainId: number;
  label: string;
  swap: StreamSeries;
  perf: StreamSeries;
  premium: StreamSeries;
}
interface RevenueSummary {
  networks: NetworkRevenue[];
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-01" → "Jul '26" — parsed from the string (timezone-safe, no Date()). */
function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m)] ?? m} '${(y ?? "").slice(2)}`;
}

function human(raw: string, decimals: number | null): number {
  if (decimals == null) return 0;
  try {
    return Number(formatUnits(BigInt(raw), decimals));
  } catch {
    return 0;
  }
}

function StreamCard({
  title,
  unit,
  color,
  stream,
  notApplicable = false,
}: {
  title: string;
  unit: string;
  color: string;
  stream: StreamSeries;
  /** true ⇒ this stream structurally doesn't exist on this network (e.g. no vault / no Premium on
   *  46630) — distinct from a source that's momentarily unavailable. */
  notApplicable?: boolean;
}) {
  if (!stream.configured) {
    return (
      <div className="chartcard">
        <div className="ch">
          <span className="ct">{title}</span>
          <span className="pill">{notApplicable ? "n/a here" : "unavailable"}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>
          {notApplicable
            ? "Not applicable on this network — there's no such source here (e.g. no vault / no Premium). We never show a made-up number."
            : "Source momentarily unavailable — no data right now. We show nothing rather than a guess; Refresh to retry."}
        </div>
      </div>
    );
  }
  const cum = human(stream.cumulativeRaw, stream.tokenDecimals);
  const points = stream.periods.map((p) => ({
    x: monthLabel(p.periodStart),
    value: human(p.valueRaw, stream.tokenDecimals),
  }));
  const max = Math.max(0.000001, ...points.map((p) => p.value)) * 1.15;
  return (
    <div className="chartcard">
      <div className="ch">
        <span className="ct">{title}</span>
        <span className="prov">on-chain · live</span>
      </div>
      <div className="tnum" style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px" }}>
        {cum.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted-foreground)" }}>{unit}</span>
      </div>
      {points.length > 0 ? (
        <StackedBars data={points} keys={["value"]} max={max} opts={{ colors: { value: color }, H: 170 }} />
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "18px 0" }}>
          No revenue in this stream yet — a real zero, not a placeholder.
        </div>
      )}
      {stream.disclosures.map((d) => (
        <div
          key={d.slice(0, 24)}
          style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6, display: "flex", gap: 6 }}
        >
          <Icon name="info" size={12} />
          <span>{d}</span>
        </div>
      ))}
    </div>
  );
}

function NetworkSection({ net }: { net: NetworkRevenue }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="ch" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="ct" style={{ fontSize: 15 }}>
          {net.label}
        </span>
        <span className="pill">chain {net.chainId}</span>
      </div>
      <div className="grid2">
        <StreamCard title="Swap routing fee (0.20%)" unit="USDC" color={STREAM.swap} stream={net.swap} />
        <StreamCard
          title="Vault performance fee (10%)"
          unit="spkUSDC"
          color={STREAM.perf}
          stream={net.perf}
          notApplicable={net.networkId !== "base"}
        />
        <StreamCard
          title="SRK membership"
          unit="SRK"
          color={STREAM.premium}
          stream={net.premium}
          notApplicable={net.networkId !== "base"}
        />
        <RevenueMultisig chainId={net.chainId} />
      </div>
    </div>
  );
}

export default function Page() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Inline async IIFE (all setState inside the async closure) keyed by a reload counter — the mount
  // fetch + the manual Refresh both flow through it without a synchronous setState-in-effect.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/agent/admin/revenue/summary", {
          headers: { "x-chain-id": "84532" },
          cache: "no-store",
        });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as RevenueSummary;
        if (alive) {
          setSummary(data);
          setLoadErr(false);
        }
      } catch {
        if (alive) setLoadErr(true);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Revenue ★</h1>
          <div className="sub">
            Real revenue by network, then by stream — on-chain, per source. No projections; a source with no feed
            shows nothing, not a guess.
          </div>
        </div>
        <button
          className="btn-exp"
          onClick={() => {
            setBusy(true);
            setReloadKey((k) => k + 1);
          }}
          disabled={busy}
        >
          <Icon name="ext" size={13} /> {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="infobanner">
        <Icon name="info" size={16} />
        <span>
          Every figure is summed from a real on-chain ledger in base units, attributed to its network.{" "}
          <b style={{ color: "var(--foreground)" }}>We only earn when you earn</b> — never on your principal, never by
          taking custody.
        </span>
      </div>

      {loadErr ? (
        <div className="chartcard" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Icon name="alert" size={16} />
          <span style={{ fontSize: 13 }}>
            Couldn&apos;t load revenue right now — the figures are safe on-chain; try Refresh. (No mock series is
            shown.)
          </span>
        </div>
      ) : !summary ? (
        <div className="chartcard" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Loading real revenue…
        </div>
      ) : (
        summary.networks.map((net) => <NetworkSection key={net.networkId} net={net} />)
      )}
    </>
  );
}
