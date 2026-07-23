"use client";

/**
 * /outcomes — Outcome Log (§018/US5): every realized result from the vault position, wins and
 * losses alike, each with its own on-chain transaction as proof.
 *
 * REAL, never fabricated (Principle III): rows come from `GET /outcomes`, which reprojects the
 * indexed Deposit/Withdraw flows into one realized outcome per withdrawal (exact average-cost
 * replay) and returns them ONLY when the share history reconciles. When there's no reconciled
 * data the page shows an honest empty/pending state — NOT the old hardcoded −$27.86 / fake tx
 * links. Position-level: not yet linked to the specific advice that caused it.
 */

import { useOutcomes, type OutcomesView } from "@/lib/agent/useAgent";
import { Icon } from "@/lib/icons";
import { StatusTag } from "@/components/ui/status-tag";
import "@/components/screens/support.css";

// The Aave Yield Vault — and therefore every realized outcome — lives on Base Sepolia (84532).
const EXPLORER = "https://sepolia.basescan.org";

type OutcomesState = ReturnType<typeof useOutcomes>;

export default function Page() {
  const outcomes = useOutcomes();
  const view = outcomes?.view;
  const hasRows = !!view && view.reconciles && view.rows.length > 0;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Outcome Log <LedgerTag hasRows={hasRows} />
          </h1>
          <div className="sub">
            Every realized result from your vault position — wins and losses alike, each with its
            on-chain proof. Position-level: not yet linked to the specific advice that caused it.
          </div>
        </div>
      </div>

      {hasRows && view ? <Ledger view={view} /> : <EmptyState outcomes={outcomes} />}

      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, textAlign: "center" }}>
        We show losses as plainly as gains — no flattering windows, no euphemism.
      </div>
    </div>
  );
}

function LedgerTag({ hasRows }: { hasRows: boolean }) {
  if (hasRows) {
    return (
      <StatusTag
        variant="live"
        label="Live"
        works={[
          "Each row is a real withdrawal, realized from your indexed on-chain flows (exact average cost)",
          "Every figure is derived, never fabricated; the tx link is the withdrawal's own proof",
        ]}
        pending={[
          "Position-level — not yet linked to the specific recommendation that caused each result",
        ]}
      />
    );
  }
  return (
    <StatusTag
      variant="partial"
      label="No data yet"
      works={["Reads your real indexed on-chain withdrawals — no fabricated figures"]}
      pending={[
        "Realized outcomes appear once you withdraw from the vault and the history reconciles on-chain",
      ]}
    />
  );
}

function Ledger({ view }: { view: OutcomesView }) {
  const netColor =
    view.netKind === "gain" ? "var(--gain)" : view.netKind === "loss" ? "var(--loss)" : "var(--foreground)";
  return (
    <div className="card card-pad">
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
                    href={`${EXPLORER}/tx/${o.txHash}`}
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
    "Once you connect, every realized result from your vault position shows here — computed from your on-chain flows, never fabricated.";

  if (outcomes) {
    if (outcomes.isError) {
      title = "Couldn't load your outcomes";
      body = "The outcomes read is temporarily unavailable. This is an advisory view — your funds and withdrawals are never affected.";
    } else if (!outcomes.loaded || outcomes.isLoading) {
      title = "Loading your outcomes…";
      body = "Reading your indexed on-chain withdrawals.";
    } else if (!outcomes.view.reconciles) {
      title = "Your on-chain history is still syncing";
      body =
        "Realized outcomes appear once your Deposit/Withdraw history reconciles with your on-chain balance. We'd rather show nothing than a partial figure.";
    } else {
      title = "No realized outcomes yet";
      body =
        "You haven't withdrawn from the vault yet. When you do, each withdrawal's realized result — win or loss — appears here with its on-chain proof.";
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
