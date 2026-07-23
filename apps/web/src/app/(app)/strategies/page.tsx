"use client";

/**
 * /strategies — Strategy Recommendations, ranked against your mandate.
 *
 * Faithful 1:1 port of the design's `strategies` screen
 * (docs/design-handover/showcase/screens/strategies.js). Each card from data.recs
 * is ranked against the mandate (lower risk, capital-preservation-first, steady
 * yield), shows net APY / risk / fit, and carries a "Why this?" rationale that
 * expands. Markup, classes, and copy are reproduced verbatim.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { capNoun } from "@/lib/stage";
import { StatusTag } from "@/components/ui/status-tag";
import { useRecommendationsView, type RecView } from "@/lib/agent/useAgent";
import "@/components/screens/strategies.css";

/** Mock strategies mapped into the shared RecView shape (offline fallback). */
const MOCK_RECS: RecView[] = data.recs.map((r, i) => ({
  id: r.id,
  rankLabel: r.rank,
  title: r.title,
  thesis: r.thesis,
  apy: r.apy,
  risk: r.risk,
  fit: r.fit,
  // Offline parity: the mock's actionable branch is exactly `apy > 0`.
  signable: r.apy > 0,
  best: i === 0,
  citations: [],
  apyKnown: r.apy > 0, // a genuine 0-APY cash mock still reads "no yield (cash)"
}));

export default function Page() {
  const router = useRouter();
  const [open, setOpen] = useState<Record<number, boolean>>({});

  // Live GET /recommendations (§3.4) ranked vs. the mandate; mock fallback offline.
  // Each card is signable ONLY when policy-approved (RecView.signable ⟺ isSignable).
  const { chainId } = useAccount();
  const testnet = chainId === 84532 || chainId === 46630;
  const liveRecs = useRecommendationsView();
  const recs = liveRecs ?? MOCK_RECS;
  // useRecommendationsView returns null offline (→ MOCK_RECS) and [] when live-but-nothing-clears.
  const usingMock = liveRecs === null;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Strategies
            {usingMock ? (
              <StatusTag
                variant="mock"
                title="Showing example strategies — connect + sign in for live, mandate-ranked recommendations"
              />
            ) : (
              <StatusTag variant="live" label="Live" />
            )}
          </h1>
          <div className="sub">Ranked against your plan — lower risk, steady yield</div>
        </div>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("settings"))}>
          <Icon name="sliders" size={16} /> Edit mandate
        </button>
      </div>
      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--spark-subtle)",
          borderColor: "color-mix(in srgb,var(--primary) 22%,transparent)",
        }}
      >
        <Icon name="info" size={18} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Only the lower-risk Aave vault is live today. Higher-risk strategies will rank here as more vaults open.
        </span>
      </div>
      {recs.map((r, i) => (
        <div className={"strat " + (r.best ? "best" : "")} key={r.id}>
          <div className="sh">
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                background: r.best ? "var(--spark-subtle)" : "var(--muted)",
                color: r.best ? "var(--primary)" : "var(--foreground)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {r.rankLabel}
            </span>
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          </div>
          <div className="st">{r.title}</div>
          <div className="sd">{r.thesis}</div>
          <div className="smetrics">
            {!r.apyKnown ? (
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
                  —
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>no yield (cash)</div>
              </div>
            ) : r.apy * 100 <= 5 /* ZERO_APY_BPS */ ? (
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
                  ≈0%
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                  net APY · {testnet ? "≈0% (testnet)" : "≈0%"}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
                  {r.apy}%
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>net APY · estimate</div>
              </div>
            )}
            <RiskChip tier={r.risk} />
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 200 }}>{r.fit}</div>
            {!usingMock && r.citations.length > 0 && (
              <span
                className="cite"
                onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                style={{ cursor: "pointer" }}
              >
                <Icon name="check" size={10} /> {r.citations.length}{" "}
                {r.citations.length === 1 ? "source" : "sources"}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 14 }}>
            Estimates, not guarantees.
          </div>
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            {r.signable ? (
              <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("confirm/deposit"))}>
                Review this move
              </button>
            ) : (
              <button className="btn btn-outline btn-md" disabled>
                Already your posture
              </button>
            )}
            <button className="btn btn-ghost btn-md" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              <Icon name="info" size={15} /> Why this?
            </button>
          </div>
          <div className={"whybd" + (open[i] ? " open" : "")}>
            {usingMock ? (
              <>
                Ranked against your mandate (lower risk, capital-preservation-first, steady yield).{" "}
                {r.best
                  ? `Raises yield without changing your risk tier; stays 100% in the audited Aave vault; satisfies your ${capNoun} and slippage guardrails.`
                  : "A conservative posture — less earning, more flexibility. Honest tradeoff, shown so you can choose."}
              </>
            ) : (
              <>
                {r.thesis ||
                  "Ranked against your mandate (lower risk, capital-preservation-first, steady yield)."}
                {r.citations.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Sources</div>
                    {r.citations.slice(0, 3).map((c, ci) => (
                      <div key={ci}>
                        {c.provider} · {c.field}: {c.value}
                        {c.url ? (
                          <>
                            {" "}
                            <a className="cite" href={c.url} target="_blank" rel="noreferrer">
                              View source <Icon name="ext" size={10} />
                            </a>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
