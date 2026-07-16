"use client";

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
import { Icon } from "@/lib/icons";
import { StackedBars, Composed } from "@/components/admin/charts";

/** The live guardian of the deployed Base-Sepolia vault (OZ TimelockController). */
const GUARDIAN_TIMELOCK = "0x0A21A9B4c2cd2d6a68EC828188826B673572d720";

type Tone = "ok" | "amber" | "info";
type Tile = { label: string; tone: Tone; value: string };

interface ReadyzDetail {
  ready?: boolean;
  checks?: { sim_fork?: boolean; base_rpc?: boolean; llm?: boolean; postgres?: boolean };
}

function tilesFrom(state: "loading" | "ok" | "error", d: ReadyzDetail | null): Tile[] {
  const reachable = state === "ok" && d !== null;
  const c = d?.checks ?? {};
  const yn = (ok: boolean | undefined, up: string, down: string): Tile => ({
    label: "",
    tone: ok ? "ok" : "amber",
    value: ok ? up : down,
  });
  const t = (label: string, tile: Tile): Tile => ({ ...tile, label });
  if (state === "loading") {
    return ["Agent service", "Base RPC", "Simulator (Anvil fork)", "Database", "LLM gateway (LiteLLM)"].map((label) => ({
      label,
      tone: "info" as Tone,
      value: "checking…",
    }));
  }
  return [
    t("Agent service", { label: "", tone: reachable ? "ok" : "amber", value: reachable ? "Up" : "Unreachable" }),
    t("Base RPC", yn(reachable && c.base_rpc, "Healthy", "Down")),
    t("Simulator (Anvil fork)", yn(reachable && c.sim_fork, "Available", "Down")),
    t("Database", yn(reachable && c.postgres, "Connected", "Down")),
    t("LLM gateway (LiteLLM)", yn(reachable && c.llm, "Live", "Down")),
  ];
}

export default function Page() {
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
            <span className="ct">Policy-engine decisions</span>
            <span className="prov">illustrative · not wired</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--gain)" }} />
              Approved
            </span>
            <span>
              <i style={{ background: "var(--caution)" }} />
              Blocked (cap/slippage)
            </span>
          </div>
          <StackedBars
            data={["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => ({
              x: d,
              ok: [88, 92, 80, 96, 90][i],
              block: [6, 4, 9, 3, 5][i],
            }))}
            keys={["ok", "block"]}
            max={105}
            opts={{ H: 200, colors: { ok: "var(--gain)", block: "var(--caution)" } }}
          />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Simulation latency p50 / p95</span>
            <span className="prov">illustrative · not wired</span>
          </div>
          <Composed areaV={[0.4, 0.5, 0.45, 0.6, 0.5, 0.55]} lineV={[0.9, 1.1, 1.0, 1.3, 1.1, 1.2]} amax={1.5} lmax={1.5} opts={{ H: 200 }} />
        </div>
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Kill-switch status</span>
            <span className="pill info">
              <span className="led" />
              Pause-only · inactive
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Current state</span>
            <span>Deposits live · withdrawals always open</span>
          </div>
          <div className="statusrow">
            <span className="muted">Guardian (on-chain)</span>
            <a
              className="mono"
              style={{ fontSize: 11, color: "var(--primary)" }}
              href={`https://sepolia.basescan.org/address/${GUARDIAN_TIMELOCK}`}
              target="_blank"
              rel="noreferrer"
            >
              {GUARDIAN_TIMELOCK.slice(0, 6)}…{GUARDIAN_TIMELOCK.slice(-4)} <Icon name="ext" size={11} />
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
