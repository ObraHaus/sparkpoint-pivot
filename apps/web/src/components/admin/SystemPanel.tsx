"use client";

/**
 * 035 — the original /admin/system screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → System & ops health (scSystem).
 *
 * The status tiles are driven by the REAL agent readiness probe (`/api/agent/readyz`,
 * proxied through the same-origin BFF which injects the service bearer to unlock the
 * per-dependency breakdown). Tiles with no real source (indexer lag, subgraphs, Sentry,
 * data freshness) were removed rather than shown as fabricated "ok". The two charts are
 * labelled illustrative — they are not yet wired to a metrics source.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { tilesFrom, type ReadyzDetail } from "@/lib/admin/systemTiles";
import { Icon } from "@/lib/icons";

export function SystemPanel() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [detail, setDetail] = useState<ReadyzDetail | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/agent/readyz", { cache: "no-store" });
        const json = (await res.json()) as ReadyzDetail;
        if (alive) {
          setDetail(json);
          setState("ok");
        }
      } catch {
        if (alive) {
          setDetail(null);
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

  const tiles = tilesFrom(state, detail);

  return (
    <>
      <div className="pghead">
        <div>
          <h1>System &amp; ops health</h1>
          <div className="sub">Is the machine healthy? Health surfaces never expose a fund control.</div>
        </div>
        <span className={`pill ${state === "error" ? "amber" : "ok"}`}>
          <span className="led" />
          {state === "loading" ? "Probing…" : state === "error" ? "Agent unreachable" : "Live · /readyz"}
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
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Ops metrics</span>
            <span className="prov">pending instrumentation</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 6 }}>
            <Icon name="info" size={13} /> The policy-engine decision-volume and simulation-latency charts were removed
            rather than shown as fabricated series — they are not yet wired to a metrics source. Live per-dependency
            health is in the tiles above; the readiness probe (<span className="mono">/readyz</span>) is real.
          </div>
        </div>
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Kill-switch status</span>
            <a className="pill info" href="/admin/killswitch" style={{ textDecoration: "none" }}>
              <span className="led" />
              Pause-only · read live on Kill-switch →
            </a>
          </div>
          <div className="statusrow">
            <span className="muted">Withdrawals</span>
            <span>Always open — un-pausable by design (N2)</span>
          </div>
          <div className="statusrow">
            <span className="muted">Deposit pause state</span>
            <a href="/admin/killswitch" style={{ color: "var(--primary)" }}>
              Read live on the Kill-switch page →
            </a>
          </div>
          <div className="statusrow">
            <span className="muted">Guardian (on-chain)</span>
            <a href="/admin/killswitch" style={{ color: "var(--primary)" }}>
              Read live on the Kill-switch page →
            </a>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", maxWidth: 430 }}>
              <Icon name="info" size={13} /> Pause never blocks withdrawals (N2) and is governed on-chain by the guardian timelock.
              This surface is status-only.
            </div>
            <button
              className="btn-exp"
              style={{ borderColor: "color-mix(in srgb,var(--caution) 40%,transparent)", color: "var(--caution)" }}
              onClick={() => router.push("/admin/killswitch")}
            >
              <Icon name="pause" size={13} /> Open kill-switch control
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
