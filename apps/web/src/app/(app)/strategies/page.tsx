"use client";

/**
 * /strategies — Strategy Recommendations, ranked against your mandate.
 *
 * Faithful 1:1 port of the design's `strategies` screen
 * (docs/design-handover/showcase/screens/strategies.js). Each card from data.recs
 * is ranked against the user's REAL mandate (030 — the risk tier and the fit line are derived,
 * not the constants this screen shipped with), shows net APY / risk / fit / what it costs, what
 * it would earn on the user's own balance, and carries a "Why this?" rationale that expands.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import { capNoun } from "@/lib/stage";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import { StatusTag } from "@/components/ui/status-tag";
import { useRecommendationsView, usePortfolioView, type RecView } from "@/lib/agent/useAgent";
import { isTestnetRate, projectAnnual, projectionSummary, TESTNET_RATE_NOTE } from "@/lib/strategy/projection";
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
  cost: "",
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
  // 030 — the user's own money, so a card can answer "what would this do for ME" instead of
  // showing a percentage and leaving the arithmetic to them. netWorth is a 2-dp USD figure;
  // USDC base units are 6 dp.
  const portfolio = usePortfolioView();
  const balanceBaseUnits =
    typeof portfolio?.netWorth === "number" ? Math.round(portfolio.netWorth * 1_000_000) : null;
  // useRecommendationsView returns null offline (→ MOCK_RECS) and [] when live-but-nothing-clears.
  const usingMock = liveRecs === null;

  // On a build whose app chain has no vault (the Robinhood Chain beta — VAULT_CHAIN_AVAILABLE=false),
  // strategy recommendations don't apply: they rank vault/lending strategies (Aave-based) that aren't
  // deployed on this network, so both reachable states here were wrong — the offline path showed Aave
  // 4.3% mock cards, and a signed-in [] showed a "Live"-tagged empty page asserting "the Aave vault is
  // live on this network". Show one honest "not available yet" state (mirrors /vault) instead. Alpha
  // (Base Sepolia registered ⇒ VAULT_CHAIN_AVAILABLE) is unchanged — the ranked cards still render.
  if (!VAULT_CHAIN_AVAILABLE) {
    return (
      <div className="page page-narrow">
        <div className="pagehead">
          <div>
            <h1>Strategies</h1>
            <div className="sub">Ranked against your plan</div>
          </div>
        </div>
        <div className="card card-pad" style={{ marginTop: 8 }}>
          <div className="card-hd">
            <span className="t">No strategies yet</span>
            <span className="lbl">coming soon</span>
          </div>
          <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            Strategy recommendations arrive with the AI vault, which isn&rsquo;t part of the Robinhood
            Chain beta yet. When it opens here, Sparky will rank moves against your mandate and show
            what each would earn on your own balance. Today you can swap on the{" "}
            <a
              style={{ color: "var(--primary)", cursor: "pointer" }}
              onClick={() => router.push(toHref("swap"))}
            >
              Swap page
            </a>{" "}
            — you sign every swap yourself — and see your position in{" "}
            <a
              style={{ color: "var(--primary)", cursor: "pointer" }}
              onClick={() => router.push(toHref("portfolio"))}
            >
              Portfolio
            </a>
            .
          </div>
        </div>
      </div>
    );
  }

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
        {/* 030 — this line used to claim one strategy unconditionally, which was true only
            because a second one was being silently dropped. It now describes what is actually
            on screen. */}
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          {recs.length > 1
            ? "Both options put USDC into the same Aave v3 market. What differs is the fee and who manages the position."
            : "Only the lower-risk Aave vault is live on this network. More strategies rank here as further vaults open."}
          {testnet ? ` ${TESTNET_RATE_NOTE}` : ""}
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
          {/* 030 — what it costs and who runs it: the only real difference between the live
              strategies, and the thing the page could never say before. */}
          {r.cost && (
            <div style={{ fontSize: 12.5, color: "var(--foreground)", marginBottom: 6 }}>{r.cost}</div>
          )}
          {/* 030 — money, not just percent. A missing balance or rate shows nothing rather than
              "$0.00/yr", which would read as a claim about the strategy. */}
          {(() => {
            const line = projectionSummary(
              projectAnnual(balanceBaseUnits, r.apyKnown ? Math.round(r.apy * 100) : null),
            );
            return line ? (
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 6 }}>
                {line}
              </div>
            ) : null;
          })()}
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 14 }}>
            Projection at today&apos;s rate — an estimate, not a guarantee.
            {isTestnetRate(chainId) ? " Test-network rates sit near zero." : ""}
          </div>
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            {r.signable ? (
              <button
                className="btn btn-primary btn-md"
                onClick={() => {
                  // 030/FR-009 — carry BOTH the amount and the recommendation id. This link used
                  // to be a bare route, so the user re-entered an amount they had just been shown
                  // AND the Outcome Log could not attribute the resulting deposit back to the
                  // recommendation it came from — the 020 rec→transaction→outcome chain was broken
                  // at this entry point.
                  const params = new URLSearchParams();
                  if (r.amountBaseUnits) params.set("assets", r.amountBaseUnits);
                  if (r.id) params.set("rec", r.id);
                  const qs = params.toString();
                  router.push(`${toHref("confirm/deposit")}${qs ? `?${qs}` : ""}`);
                }}
              >
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
                {/* Mock path only — example figures, no real mandate to contradict. */}
                Ranked against a lower-risk example plan.{" "}
                {r.best
                  ? `Raises yield without changing your risk tier; stays 100% in the audited Aave vault; satisfies your ${capNoun} and slippage guardrails.`
                  : "A conservative posture — less earning, more flexibility. Honest tradeoff, shown so you can choose."}
              </>
            ) : (
              <>
                {/* 030 — this fallback used to ASSERT the user's mandate was
                    "lower risk, capital-preservation-first" whatever they had actually set. The
                    same defect as the plan summary and the template rationale, in a third place.
                    `r.fit` is derived from the real plan. */}
                {r.thesis || r.fit}
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
