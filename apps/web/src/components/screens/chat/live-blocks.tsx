"use client";

/**
 * LiveBlocks — renders the LIVE `/chat` SSE stream (§3.2) inside the assistant
 * thread, fail-closed. Each streamed block string is validated by `cards.parseCard`
 * (in the page) into a {@link ChatCard}; this component maps each result to markup
 * using the SAME chat design-system classes as the mock cards (`.ccard`, `.ch`,
 * `.cthesis`, `.badge`, `.cact`, `.think`, …) so the live path is visually identical
 * to the mock path (design parity).
 *
 * NON-CUSTODY (the sign gate): a `recommendation`/`action` block shows the actionable
 * "Review this move" affordance ONLY when `card.signable` (⟺ `cards.isSignable` ⟺
 * `policy.status === "approved"`). A rejected/out-of-policy block, an `error` block,
 * and any `inert` (invalid-JSON / schema-mismatch) card render as a NON-ACTIONABLE
 * notice — no sign path is ever offered off client state.
 */

import { Icon } from "@/lib/icons";
import { RiskChip } from "@/components/ui/risk-chip";
import type { ChatCard } from "@/lib/agent/cards";
import type { InlineIntent } from "@/components/screens/chat/inline-confirm";
import type { ProposedAction } from "@sparkpoint/shared/schemas";

/**
 * Map a live block's `proposedAction` to the chat inline-confirm intent, carrying the
 * LIVE amount so a vault action drives the REAL execution path (never a mock amount).
 * Vault deposit/withdraw/redeem resolve to the real vault gate; anything else is a
 * non-signable "ships at launch" placeholder.
 */
function inlineIntentFor(action: ProposedAction): InlineIntent {
  const amount = (() => {
    try {
      return BigInt(action.amount);
    } catch {
      return 0n;
    }
  })();
  switch (action.type) {
    case "vault_deposit":
      return { kind: "deposit", assets: amount };
    case "vault_withdraw":
      return { kind: "withdraw", assets: amount };
    case "vault_redeem":
      return { kind: "withdraw", shares: amount };
    default:
      // aerodrome_swap and any non-vault action are not on-chain-live yet.
      return { kind: "swap" };
  }
}

const REJECTED_FALLBACK =
  "This suggestion isn't cleared by your guardrails, so it can't be acted on.";

function InertNotice({ message }: { message: string }) {
  return (
    <div className="ccard" data-card="inert" style={{ opacity: 0.9 }}>
      <div className="cnote">{message}</div>
    </div>
  );
}

/** One trace row for a `tool_step` block — the summarized reasoning trace (never raw CoT). */
function ToolStepRow({ label, status }: { label: string; status: "running" | "done" | "error" }) {
  return (
    <div className="think">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontSize: 13,
          color: "var(--muted-foreground)",
          padding: "3px 0",
        }}
      >
        {status === "done" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : status === "error" ? (
          <span style={{ color: "var(--loss)", display: "flex" }}>
            <Icon name="alert" size={14} />
          </span>
        ) : (
          <span className="ai-dot" />
        )}
        <span>{status === "running" ? `${label}…` : label}</span>
      </div>
    </div>
  );
}

export interface LiveBlocksProps {
  cards: ChatCard[];
  streaming: boolean;
  /** Set when the stream failed pre-/mid-flight — rendered as an inert notice. */
  error?: string;
  /** Open the chat's inline confirm for a signable proposed action (with its live amount). */
  onReview: (intent: InlineIntent) => void;
  /** Open the citation source sheet. */
  onCite: () => void;
}

export function LiveBlocks({ cards, streaming, error, onReview, onCite }: LiveBlocksProps) {
  return (
    <>
      {cards.map((card, i) => (
        <LiveBlock key={i} card={card} onReview={onReview} onCite={onCite} />
      ))}
      {streaming && (
        <div className="think">
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted-foreground)", padding: "3px 0" }}>
            <span className="ai-dot" />
            <span>Working…</span>
          </div>
        </div>
      )}
      {error && <InertNotice message={error} />}
    </>
  );
}

function LiveBlock({
  card,
  onReview,
  onCite,
}: {
  card: ChatCard;
  onReview: (intent: InlineIntent) => void;
  onCite: () => void;
}) {
  // Fail-closed: an unvalidated / malformed block renders inert, never actionable.
  if (card.status === "inert") return <InertNotice message={card.message} />;

  const { block, signable } = card;

  switch (block.type) {
    case "text":
      return <div className="ctext">{block.markdown}</div>;

    case "tool_step":
      return <ToolStepRow label={block.label} status={block.status} />;

    case "recommendation": {
      const rankLabel =
        block.rank === 1 ? "Best fit · #1 vs your goal" : `#${block.rank} vs your goal`;
      return (
        <div className="ccard" data-card="rec">
          <div className="ch">
            <span className="rank">{rankLabel}</span>
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          </div>
          <div className="cthesis">
            <b>{block.title}</b> — {block.rationale}
          </div>
          <div className="crow">
            <RiskChip tier={1} />
            {block.citations.length > 0 && (
              <span className="cite" onClick={onCite} style={{ cursor: "pointer" }}>
                <Icon name="check" size={10} /> {block.citations.length}{" "}
                {block.citations.length === 1 ? "source" : "sources"}
              </span>
            )}
          </div>
          <div className="cnote">Estimates, not guarantees.</div>
          {signable ? (
            <div className="cact">
              <button
                className="btn btn-primary btn-md"
                onClick={() => onReview(inlineIntentFor(block.proposedAction))}
              >
                Review this move
              </button>
            </div>
          ) : (
            <div className="cnote">{block.policy.reason ?? REJECTED_FALLBACK}</div>
          )}
        </div>
      );
    }

    case "action":
      return (
        <div className="ccard" data-card="action">
          <div className="ch">
            <span className="rank">Proposed action</span>
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          </div>
          {signable ? (
            <>
              <div className="cthesis">This action is ready — review every change and sign right here.</div>
              <div className="cact">
                <button
                  className="btn btn-primary btn-md"
                  onClick={() => onReview(inlineIntentFor(block.proposedAction))}
                >
                  Review this move
                </button>
              </div>
            </>
          ) : (
            <div className="cnote">{block.policy.reason ?? REJECTED_FALLBACK}</div>
          )}
        </div>
      );

    case "portfolio_snapshot":
      return (
        <div className="ccard" data-card="snap">
          <div className="ch">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Your portfolio</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {block.positions.map((p, k) => (
                <tr key={k}>
                  <td style={{ padding: "7px 0", fontSize: 13, fontWeight: 600 }}>{p.asset}</td>
                  <td style={{ padding: "7px 0", fontSize: 12, color: "var(--muted-foreground)", textAlign: "right" }}>
                    {p.venue}
                  </td>
                  <td style={{ padding: "7px 0 7px 8px", fontSize: 13, textAlign: "right" }} className="tnum">
                    ${p.valueUsd}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "tip":
      return (
        <div
          className="ccard"
          data-card="tip"
          style={{ background: "var(--info-subtle)", borderColor: "color-mix(in srgb,var(--info) 22%,transparent)" }}
        >
          <div className="ch">
            <span style={{ color: "var(--info)", display: "flex" }}>
              <Icon name="info" size={16} />
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{block.topic}</span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted-foreground)" }}>{block.body}</div>
        </div>
      );

    case "outcome": {
      const pnl = Number(block.realizedPnlUsd);
      const up = !(Number.isFinite(pnl) && pnl < 0);
      return (
        <div className="ccard" data-card="out">
          <div className="ch">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Outcome</span>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{block.status}</span>
          </div>
          <div className={"delta " + (up ? "up" : "down")} style={{ fontSize: 18 }}>
            <Icon name={up ? "up" : "down"} size={16} />
            {up ? "+" : ""}${block.realizedPnlUsd}
          </div>
        </div>
      );
    }

    case "citation":
      return (
        <div className="ccard" data-card="cite">
          <div className="ch">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Sources</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            {block.sources.map((s, k) => (
              <div key={k}>
                {s.provider} · {s.field}: {s.value}
              </div>
            ))}
          </div>
        </div>
      );

    case "error":
      return <InertNotice message={block.message} />;

    default:
      return <InertNotice message={REJECTED_FALLBACK} />;
  }
}
