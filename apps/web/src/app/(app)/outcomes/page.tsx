"use client";

/**
 * /outcomes — Outcome Log (§018/US5 + §020/US5): every realized result from acting on the AI's
 * advice, wins and losses alike, each with its own on-chain transaction as proof.
 *
 * REAL, never fabricated (Principle III — provable, not promised): figures come from `GET /outcomes`,
 * which reprojects the indexed Deposit/Withdraw flows by exact FIFO/average-cost replay and returns
 * them ONLY when the share history reconciles. Two honest views:
 *   • "By recommendation" — one row per recommendation the user ACTED on, its realized + unrealized
 *     PnL marked to market, linked to the exact transaction they signed (`intent_log`, never
 *     inferred). A blended position is labelled as the user's share, never a fabricated split.
 *   • "All withdrawals" — the position-level realized ledger (each withdrawal). Honest caveat kept:
 *     a withdrawal spanning multiple deposits isn't split per recommendation.
 * When nothing reconciles the page shows an honest empty/pending state — never a fabricated figure.
 */

import { useState } from "react";
import type { Hex } from "viem";
import {
  useOutcomes,
  useOutcomeDetail,
  type OutcomesView,
  type RecommendationOutcomeView,
  type OutcomeKind,
  type OutcomeLabel,
} from "@/lib/agent/useAgent";
import { Icon } from "@/lib/icons";
import { StatusTag } from "@/components/ui/status-tag";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import "@/components/screens/support.css";

type OutcomesState = ReturnType<typeof useOutcomes>;

function kindColor(kind: OutcomeKind): string {
  return kind === "gain" ? "var(--gain)" : kind === "loss" ? "var(--loss)" : "var(--foreground)";
}

export default function Page() {
  const outcomes = useOutcomes();
  const view = outcomes?.view;
  const recs = view?.recommendations ?? [];
  const hasRecs = !!view && view.reconciles && recs.length > 0;
  const hasRows = !!view && view.reconciles && view.rows.length > 0;
  const hasAnything = hasRecs || hasRows;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Outcome Log <OutcomeTag hasData={hasAnything} />
          </h1>
          <div className="sub">
            See how the AI&apos;s past suggestions actually performed — every result traced to the
            advice you acted on, wins and losses alike, each with its on-chain proof.
          </div>
        </div>
      </div>

      {hasAnything ? (
        <>
          {hasRecs && <ByRecommendation recs={recs} />}
          {hasRows && view ? <PositionLedger view={view} /> : null}
        </>
      ) : (
        <EmptyState outcomes={outcomes} />
      )}

      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, textAlign: "center" }}>
        We show losses as plainly as gains — no flattering windows, no euphemism.
      </div>
    </div>
  );
}

function OutcomeTag({ hasData }: { hasData: boolean }) {
  if (hasData) {
    return (
      <StatusTag
        variant="live"
        label="Live"
        works={[
          "Each acted-on recommendation is traced to the exact transaction you signed — the link is provable, never inferred",
          "Every figure is derived from your indexed on-chain flows by exact FIFO cost — wins and losses shown equally, never fabricated",
          "A blended position is labelled as your share of that position — never a fabricated split",
        ]}
        pending={[
          "The all-withdrawals ledger is position-level — a withdrawal that spans multiple deposits isn't split per recommendation",
        ]}
      />
    );
  }
  return (
    <StatusTag
      variant="partial"
      label="No data yet"
      works={["Reads your real indexed on-chain flows — no fabricated figures"]}
      pending={[
        "Outcomes appear once you act on a recommendation (or withdraw) and the history reconciles on-chain",
      ]}
    />
  );
}

/* ── §020/US5 — the "By recommendation" surface (the credibility loop) ─────── */

function ByRecommendation({ recs }: { recs: RecommendationOutcomeView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>By recommendation</h2>
        <span className="badge badge-ai">
          <Icon name="spark" size={11} /> Credibility loop
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12.5, margin: "4px 0 14px", lineHeight: 1.5 }}>
        Each result traced to the specific advice you acted on — linked by the transaction you signed,
        never inferred.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {recs.map((r) => (
          <RecRow
            key={r.recId || r.actedTxHash}
            rec={r}
            open={!!r.recId && openId === r.recId}
            onToggle={() => setOpenId(openId === r.recId ? null : r.recId)}
          />
        ))}
      </div>
    </div>
  );
}

function RecRow({
  rec,
  open,
  onToggle,
}: {
  rec: RecommendationOutcomeView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border-soft)", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{rec.title}</span>
            <LabelBadge label={rec.label} />
            {rec.shared && <SharedBadge />}
          </div>
          {rec.attributionLabel ? (
            <div
              className="muted"
              style={{ fontSize: 11.5, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Icon name="shieldcheck" size={11} /> {rec.attributionLabel}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 16, flex: "none" }}>
          <Figure k="Realized" text={rec.realizedText} kind={rec.realizedKind} />
          <Figure k="Unrealized" text={rec.unrealizedText} kind={rec.unrealizedKind} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, fontSize: 12 }}>
        <span className="muted">Entry {rec.entryText}</span>
        {rec.actedTxHash ? (
          <a className="cite" href={explorerTxUrl(APP_DEFAULT_CHAIN_ID, rec.actedTxHash as Hex)} target="_blank" rel="noreferrer">
            acted tx <Icon name="ext" size={10} />
          </a>
        ) : null}
        {rec.recId ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--primary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {open ? "Hide details" : "Why this — full outcome"}
            <Icon name={open ? "up" : "down"} size={11} />
          </button>
        ) : null}
      </div>

      {open && rec.recId ? <RecDetail recId={rec.recId} /> : null}
    </div>
  );
}

function Figure({ k, text, kind }: { k: string; text: string; kind: OutcomeKind }) {
  return (
    <div className="stat" style={{ alignItems: "flex-end" }}>
      <span className="k">{k}</span>
      <span className="v tnum" style={{ fontSize: 15, color: kindColor(kind) }}>
        {text}
      </span>
    </div>
  );
}

function LabelBadge({ label }: { label: OutcomeLabel }) {
  const map: Record<OutcomeLabel, { text: string; color: string; bg: string }> = {
    open: { text: "Open", color: "var(--primary)", bg: "var(--spark-subtle)" },
    win: { text: "Win", color: "var(--gain)", bg: "var(--gain-subtle)" },
    loss: { text: "Loss", color: "var(--loss)", bg: "var(--loss-subtle)" },
    flat: { text: "Flat", color: "var(--muted-foreground)", bg: "var(--muted)" },
  };
  const s = map[label];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: s.color, background: s.bg }}>
      {s.text}
    </span>
  );
}

function SharedBadge() {
  return (
    <span
      title="Your share of a position blended across more than one deposit — never a fabricated split."
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color: "var(--muted-foreground)",
        background: "var(--muted)",
        border: "1px solid var(--border-soft)",
        cursor: "help",
      }}
    >
      Shared position
    </span>
  );
}

/** The lazy per-rec detail (`GET /outcomes/{recId}`) — rationale + realized APY + provenance. */
function RecDetail({ recId }: { recId: string }) {
  const detail = useOutcomeDetail(recId);
  const v = detail?.view;
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border-soft)" }}>
      {detail?.isLoading ? (
        <div className="muted" style={{ fontSize: 12 }}>
          Loading the full outcome…
        </div>
      ) : null}
      {detail?.isError ? (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {detail.errorCode === "DATA_STALE"
            ? "This outcome is still syncing on-chain — the figures above are live; the full detail returns shortly."
            : "Full detail is temporarily unavailable. The figures above are still real and live."}
        </div>
      ) : null}
      {v ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {v.rationale ? (
            <div>
              <div className="k" style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500, marginBottom: 3 }}>
                Why the AI suggested this
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{v.rationale}</div>
            </div>
          ) : null}
          {v.proposedActionSummary ? (
            <div className="muted" style={{ fontSize: 12 }}>
              Proposed: {v.proposedActionSummary}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Meta
              k="Realized APY"
              val={v.realizedApyText ?? "—"}
              hint={v.realizedApyText ? undefined : "Annualized realized return appears once this lot is fully closed."}
            />
            <Meta k="Entry block" val={v.entryBlock ? v.entryBlock.toLocaleString() : "—"} />
            <Meta k="As of block" val={v.asOfBlock ? v.asOfBlock.toLocaleString() : "—"} />
            {v.status ? <Meta k="Status" val={v.status} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Meta({ k, val, hint }: { k: string; val: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="k">{k}</span>
      <span className="v tnum" style={{ fontSize: 14 }}>
        {val}
      </span>
    </div>
  );
}

/* ── §018/US5 — the position-level realized ledger (all withdrawals) ───────── */

function PositionLedger({ view }: { view: OutcomesView }) {
  const netColor = kindColor(view.netKind);
  return (
    <div className="card card-pad">
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>All withdrawals</h2>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
        The position-level realized ledger — one row per withdrawal from your indexed flows. Not every
        withdrawal maps to a single recommendation.
      </div>
      <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
        <div className="stat">
          <span className="k">Net realized</span>
          <span className="v tnum" style={{ color: netColor }}>
            {view.netRealizedText ?? "—"}
          </span>
        </div>
        <div className="stat">
          <span className="k">Wins</span>
          <span className="v tnum">{view.wins}</span>
        </div>
        <div className="stat">
          <span className="k">Losses</span>
          <span className="v tnum">{view.losses}</span>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Withdrawal</th>
            <th className="num">Realized PnL</th>
            <th className="num">Proof</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((o) => (
            <tr key={o.txHash || o.blockNumber}>
              <td>
                <div style={{ fontWeight: 600 }}>Withdrawal · {o.amountText}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  block {o.blockNumber.toLocaleString()}
                </div>
              </td>
              <td className="num">
                <span
                  className={"delta " + (o.kind === "gain" ? "up" : o.kind === "loss" ? "down" : "flat")}
                  style={{ fontSize: 13 }}
                >
                  {o.kind !== "flat" && <Icon name={o.kind === "gain" ? "up" : "down"} size={13} />}
                  {o.realizedText}
                </span>
              </td>
              <td className="num">
                {o.txHash ? (
                  <a
                    className="cite"
                    href={explorerTxUrl(APP_DEFAULT_CHAIN_ID, o.txHash as Hex)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    tx <Icon name="ext" size={10} />
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ outcomes }: { outcomes: OutcomesState }) {
  let title = "Connect your wallet to see your realized outcomes";
  let body =
    "Once you connect, every realized result — from the advice you act on and from your vault position — shows here, computed from your on-chain flows, never fabricated.";

  if (outcomes) {
    if (outcomes.isError) {
      title = "Couldn't load your outcomes";
      body = "The outcomes read is temporarily unavailable. This is an advisory view — your funds and withdrawals are never affected.";
    } else if (!outcomes.loaded || outcomes.isLoading) {
      title = "Loading your outcomes…";
      body = "Reading your indexed on-chain flows.";
    } else if (!outcomes.view.reconciles) {
      title = "Your on-chain history is still syncing";
      body =
        "Realized outcomes appear once your Deposit/Withdraw history reconciles with your on-chain balance. We'd rather show nothing than a partial figure.";
    } else {
      title = "No outcomes yet";
      body =
        "When you act on a recommendation — or withdraw from the vault — its realized result, win or loss, appears here with its on-chain proof.";
    }
  }

  return (
    <div className="card card-pad" style={{ textAlign: "center", padding: "34px 20px" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
        {body}
      </div>
    </div>
  );
}
