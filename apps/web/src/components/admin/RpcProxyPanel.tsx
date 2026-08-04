"use client";

/**
 * 039 — Admin → System → RPC proxy. Every chain read rides the proxy; this section answers:
 * is it up, is the cache earning its keep, and which provider is actually serving traffic.
 *
 * READ-ONLY BY DESIGN (FR-013): the proxy's configuration is infrastructure-as-code
 * (ops/erpc/erpc.yaml) — this console observes, it never edits. The only "actions" here are
 * references: where the endpoints live, where the rollback runbook is. The kill-switch
 * philosophy applies: a health surface never exposes a control that could reroute
 * funds-touching traffic with a click.
 *
 * Data: /api/admin/rpc-proxy (admin-gated server scrape of the LAN metrics port — raw
 * Prometheus text never reaches the browser). 15s poll, same rhythm as SystemPanel.
 * Tiles follow the tri-state contract (lib/admin/rpcProxyTiles): a series the proxy does
 * not report reads "not reported" — never a fake outage.
 */

import { useEffect, useState } from "react";

import { rpcProxyTilesFrom, type RpcProxySnapshot, type UpstreamStat } from "@/lib/admin/rpcProxyTiles";
import { Icon } from "@/lib/icons";

const fmtMs = (n: number | undefined): string => (n === undefined ? "—" : `${Math.round(n)} ms`);
const fmtPct = (n: number | undefined): string => (n === undefined ? "—" : `${n.toFixed(1)}%`);
const fmtInt = (n: number | undefined): string =>
  n === undefined ? "—" : Math.round(n).toLocaleString("en-US");

/** Row tone mirrors the aggregate tile's health rule: <2% errors (or unreported) = ok. */
function rowTone(u: UpstreamStat): "ok" | "amber" {
  return (u.errorRatePct ?? 0) < 2 ? "ok" : "amber";
}

export function RpcProxyPanel() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [snap, setSnap] = useState<RpcProxySnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/rpc-proxy", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as RpcProxySnapshot;
        if (alive) {
          setSnap(json);
          setState("ok");
        }
      } catch {
        if (alive) {
          setSnap(null);
          setState("error");
        }
      }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const tiles = rpcProxyTilesFrom(state, snap);
  const live = state === "ok" && snap !== null && snap.reachable;

  return (
    <>
      <div className="pghead">
        <div>
          <h1>RPC proxy</h1>
          <div className="sub">
            Every chain read rides the proxy — health, cache, and provider traffic, live. Read-only:
            config is versioned in <span className="mono">ops/erpc/</span>, never edited here.
          </div>
        </div>
        <span className={`pill ${live ? "ok" : "amber"}`}>
          <span className="led" />
          {state === "loading"
            ? "Probing…"
            : live
              ? "Live · /metrics"
              : snap !== null && !snap.configured
                ? "Not configured"
                : "Proxy unreachable"}
        </span>
      </div>

      <div className="band" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        {tiles.map((t) => (
          <div className="kpi" key={t.label}>
            <div className="k">{t.label}</div>
            <div style={{ marginTop: 10 }}>
              <span className={`pill ${t.tone}`}>
                <span className="led" />
                {t.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Upstreams</span>
            <span className="prov">
              {live ? "counters are cumulative since proxy start" : "awaiting a reachable proxy"}
            </span>
          </div>
          {snap?.upstreams === undefined ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 6 }}>
              <Icon name="info" size={13} /> No per-upstream series reported yet. If the proxy is up, the
              metric names may have changed with a version bump — re-pin them from the live{" "}
              <span className="mono">/metrics</span> output (they live in one place:{" "}
              <span className="mono">lib/admin/rpcProxyTiles.ts</span>).
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <table className="adtbl">
                <thead>
                  <tr>
                    <th>Upstream</th>
                    <th>Chain</th>
                    <th>State</th>
                    <th className="num">Requests</th>
                    <th className="num">Share</th>
                    <th className="num">p50</th>
                    <th className="num">p95</th>
                    <th className="num">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.upstreams.map((u) => (
                    <tr key={u.id}>
                      <td className="mono">{u.id}</td>
                      <td className="mono">{u.chainId ?? "—"}</td>
                      <td>
                        <span className={`pill ${rowTone(u)}`}>
                          <span className="led" />
                          {rowTone(u) === "ok" ? "Healthy" : "Degraded"}
                        </span>
                      </td>
                      <td className="num mono">{fmtInt(u.requests)}</td>
                      <td className="num mono">{fmtPct(u.sharePct)}</td>
                      <td className="num mono">{fmtMs(u.p50Ms)}</td>
                      <td className="num mono">{fmtMs(u.p95Ms)}</td>
                      <td className="num mono">{fmtPct(u.errorRatePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Endpoints &amp; runbook</span>
            <span className="prov">read-only references</span>
          </div>
          <div className="statusrow">
            <span className="muted">Core lane (agent + indexers)</span>
            <span className="mono" style={{ fontSize: 11 }}>https://erpc-t84o44c0ss04k0oswc00wg0k.aldrickb.app/core/evm/&lt;chainId&gt; · secret-authed</span>
          </div>
          <div className="statusrow">
            <span className="muted">App lane (browsers)</span>
            <span className="mono" style={{ fontSize: 11 }}>https://erpc-t84o44c0ss04k0oswc00wg0k.aldrickb.app/app/evm/84532</span>
          </div>
          <div className="statusrow">
            <span className="muted">Metrics (LAN only)</span>
            <span className="mono" style={{ fontSize: 11 }}>:4001/metrics — scraped server-side, never public</span>
          </div>
          <div className="statusrow">
            <span className="muted">Rollback</span>
            <span className="mono" style={{ fontSize: 11 }}>ops/erpc/ROLLBACK.md — every stage is an env restore, ≤5 min</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 12 }}>
            <Icon name="info" size={13} /> The withdraw path never rides the proxy: <span className="mono">/exit</span>{" "}
            reads are pinned to public endpoints by construction (N2), so this panel going red can never mean
            &ldquo;users can&rsquo;t exit&rdquo;.
          </div>
        </div>
      </div>
    </>
  );
}
