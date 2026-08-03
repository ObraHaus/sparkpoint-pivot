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
import { clampProposedSlippageBps } from "@/lib/swap/math";
import type { InlineIntent } from "@/components/screens/chat/inline-confirm";
import { HandsOffAction } from "@/components/screens/chat/HandsOffAction";
import { isInlineExecutable, unsupportedIntent } from "@/lib/chat/actionSupport";
import { chatErrorCopy } from "@/lib/agent/chatError";
import { tipLabel } from "@/lib/agent/tipLabel";
import { planTranscript, type TranscriptItem } from "@/lib/chat/steps";
import { parseRichText } from "@/lib/chat/richText";
import type { ProposedAction } from "@sparkpoint/shared/schemas";

/**
 * Map a live block's `proposedAction` to the chat inline-confirm intent, carrying the LIVE amount so
 * the action drives a REAL execution path (never a mock amount). Vault deposit/withdraw/redeem →
 * the real vault gate; `aerodrome_swap` → the functional inline swap (user-signed via Uniswap,
 * independent of the agent's fail-closed swap policy); anything else → an honest inert notice.
 */
function inlineIntentFor(action: ProposedAction): InlineIntent {
  // Gate on the tested predicate FIRST so the "we can't run this" answer has exactly one source.
  if (!isInlineExecutable(action.type)) return unsupportedIntent(action.type);
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
    case "aerodrome_swap": {
      // Functional inline swap — executed via the web's own Uniswap path (user-signed), NOT the agent's
      // fail-closed swap policy. Forward an assistant-proposed token PAIR + chainId when present (007 · US4);
      // an OLD single-`asset` block has neither, so it falls back to the recommended ETH→USDC swap.
      const hasPair = !!action.tokenIn || !!action.tokenOut;
      return {
        kind: "swap",
        ethToUsdc: hasPair ? undefined : true,
        tokenIn: action.tokenIn ? { address: action.tokenIn.address, symbol: action.tokenIn.symbol } : undefined,
        tokenOut: action.tokenOut ? { address: action.tokenOut.address, symbol: action.tokenOut.symbol } : undefined,
        chainId: action.chainId,
        amountIn: amount > 0n ? amount : undefined,
        // R1 medium #1: clamp the ASSISTANT-proposed slippage to the policy ceiling (§5, 300 bps)
        // before it can reach `amountOutMinimum`. Unclamped, a prompt-injected or compromised agent
        // proposing e.g. 9900 bps yields minOut ≈ 0 — a sandwichable trade chosen by the model rather
        // than the user. `amountOutMinimum` clamps only to [0, 10000], which is no protection at all.
        // The wire schema now also rejects out-of-range values; this is the defence-in-depth half.
        slippageBps: clampProposedSlippageBps(action.params?.maxSlippageBps),
      };
    }
    default:
      // Unreachable — `isInlineExecutable` already gated every type without a real path. Kept as
      // defence-in-depth, and it must stay the INERT notice: answering `{ kind: "premium" }` here
      // is what made an un-executable `aave_supply` render as "Confirm: Premium subscription" (025).
      return unsupportedIntent(action.type);
  }
}

/**
 * Route an APPROVED action from a rec/action block: vault moves (deposit/withdraw/redeem) go to the
 * server-materialized ExecutionDrawer — the single signing chokepoint (feature 019 US2), which builds
 * one policy-approved IntentBundle and has you sign the server calldata verbatim. Swaps and anything
 * else keep the existing inline confirm (Uniswap / honest placeholder). The vault-SCREEN manual flow
 * and the /exit hatch are untouched.
 */
const VAULT_ACTIONS: ReadonlySet<string> = new Set([
  "vault_deposit",
  "vault_withdraw",
  "vault_redeem",
]);

function openAction(
  action: ProposedAction,
  onReview: (intent: InlineIntent) => void,
  onSign: (action: ProposedAction) => void,
): void {
  if (VAULT_ACTIONS.has(action.type)) onSign(action);
  else onReview(inlineIntentFor(action));
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

/**
 * A FAILED turn (029). Deliberately not shaped like an answer: its own tinted card, an alert
 * glyph, a "Something went wrong" heading and a Try again control. Before this, the agent's §1.5
 * envelope was rendered in the prose slot, so "X-Account/X-Owner/X-Chain-Id are malformed or
 * mismatched." appeared to be Sparky talking. `chatErrorCopy` guarantees the raw envelope never
 * reaches the user; this component guarantees the failure never LOOKS like an answer.
 */
function TurnError({
  message,
  code,
  onRetry,
}: {
  message: string;
  code?: string;
  onRetry?: () => void;
}) {
  const view = chatErrorCopy(message, code);
  return (
    <div
      className="ccard"
      data-card="turn-error"
      role="status"
      style={{
        borderColor: "color-mix(in srgb, var(--caution) 32%, transparent)",
        background: "color-mix(in srgb, var(--caution) 8%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <span style={{ color: "var(--caution)", display: "flex", marginTop: 1 }}>
          <Icon name="alert" size={16} />
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Something went wrong</div>
          <div className="cnote" style={{ marginTop: 3 }}>
            {view.message}
          </div>
          {view.retryable && onRetry && (
            <button
              className="btn btn-outline btn-sm"
              style={{ marginTop: 10 }}
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          )}
        </div>
      </div>
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
  /** Set when the stream failed pre-/mid-flight — rendered as a distinct ERROR state (029),
   * never as assistant prose. */
  error?: string;
  /** The §1.6 code behind `error`, so internal envelopes can be recognised and replaced. */
  errorCode?: string;
  /** Re-send the failed message (renders "Try again" when the failure is retryable). */
  onRetry?: () => void;
  /** Open the chat's inline confirm for a signable proposed action (with its live amount). */
  onReview: (intent: InlineIntent) => void;
  /** Open the ExecutionDrawer (server IntentBundle chokepoint) for an approved VAULT action. */
  onSign: (action: ProposedAction) => void;
  /** Open the citation source sheet. */
  onCite: () => void;
}

export function LiveBlocks({ cards, streaming, error, errorCode, onRetry, onReview, onSign, onCite }: LiveBlocksProps) {
  // 029/FR-012 — the trace is progress feedback, not transcript. Deduplicate the running/done
  // pair each stage emits, and once the turn is finished collapse the whole run behind one line
  // so the ANSWER is what the eye lands on. Planned by a pure, unit-tested function.
  const plan = planTranscript(cards.map(toTranscriptItem), { streaming });
  return (
    <>
      {plan.map((entry, i) =>
        entry.kind === "card" ? (
          <LiveBlock
            key={i}
            card={cards[entry.index]}
            onReview={onReview}
            onSign={onSign}
            onCite={onCite}
            onRetry={onRetry}
          />
        ) : (
          <StepGroup key={i} entry={entry} cards={cards} />
        ),
      )}
      {streaming && (
        <div className="think">
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted-foreground)", padding: "3px 0" }}>
            <span className="ai-dot" />
            <span>Working…</span>
          </div>
        </div>
      )}
      {error && <TurnError message={error} code={errorCode} onRetry={onRetry} />}
    </>
  );
}

/**
 * An assistant answer, with the little formatting it is allowed (029).
 *
 * The block's field is called `markdown` and was rendered as a raw string, so `**bold**` showed
 * its asterisks and blank lines collapsed — the advice boundary and the automation answer, both
 * deliberately multi-paragraph, arrived as one unbroken wall of text. Parsed by a pure function
 * into data and mapped to elements here: no HTML is ever interpreted, so model-authored text
 * cannot inject markup.
 */
function AnswerText({ markdown }: { markdown: string }) {
  const paragraphs = parseRichText(markdown);
  if (paragraphs.length === 0) return null;
  return (
    <div className="ctext">
      {paragraphs.map((para, i) => (
        <p key={i} style={{ margin: i === 0 ? 0 : "0.7em 0 0" }}>
          {para.map((seg, j) => (seg.bold ? <strong key={j}>{seg.text}</strong> : <span key={j}>{seg.text}</span>))}
        </p>
      ))}
    </div>
  );
}

/** The projection {@link planTranscript} needs, taken from a validated card. */
function toTranscriptItem(card: ChatCard): TranscriptItem {
  if (card.status === "inert") return { type: "inert" };
  const block = card.block;
  return block.type === "tool_step"
    ? { type: "tool_step", label: block.label, status: block.status }
    : { type: block.type };
}

/** A run of progress rows: expanded while the turn is live, one summary line once it is done. */
function StepGroup({
  entry,
  cards,
}: {
  entry: { indices: readonly number[]; collapsed: boolean; summary: string };
  cards: ChatCard[];
}) {
  const rows = entry.indices.map((index) => {
    const card = cards[index];
    if (card.status === "inert" || card.block.type !== "tool_step") return null;
    return <ToolStepRow key={index} label={card.block.label} status={card.block.status} />;
  });
  if (!entry.collapsed) return <>{rows}</>;
  return (
    <details className="think" data-card="steps">
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontSize: 12.5,
          color: "var(--muted-foreground)",
          padding: "3px 0",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
          <path d="M5 13l4 4L19 7" />
        </svg>
        {entry.summary}
      </summary>
      {rows}
    </details>
  );
}

function LiveBlock({
  card,
  onReview,
  onSign,
  onCite,
  onRetry,
}: {
  card: ChatCard;
  onReview: (intent: InlineIntent) => void;
  onSign: (action: ProposedAction) => void;
  onCite: () => void;
  /** Re-send the message this turn failed on — offered on an `error` block (029/FR-001). */
  onRetry?: () => void;
}) {
  // Fail-closed: an unvalidated / malformed block renders inert, never actionable.
  if (card.status === "inert") return <InertNotice message={card.message} />;

  const { block, signable } = card;

  switch (block.type) {
    case "text":
      return <AnswerText markdown={block.markdown} />;

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
          {signable || block.proposedAction.type === "aerodrome_swap" ? (
            <>
              <div className="cact">
                <button
                  className="btn btn-primary btn-md"
                  onClick={() => openAction(block.proposedAction, onReview, onSign)}
                >
                  {block.proposedAction.type === "aerodrome_swap" ? "Review swap" : "Review this move"}
                </button>
              </div>
              {/* US6: optional hands-off run — renders only with a live in-scope grant + on-device key. */}
              {signable && <HandsOffAction action={block.proposedAction} />}
            </>
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
          {signable || block.proposedAction.type === "aerodrome_swap" ? (
            <>
              <div className="cthesis">
                {block.proposedAction.type === "aerodrome_swap"
                  ? "Swap ETH ↔ USDC on Uniswap — review the live quote and sign right here."
                  : "This action is ready — review every change and sign right here."}
              </div>
              <div className="cact">
                <button
                  className="btn btn-primary btn-md"
                  onClick={() => openAction(block.proposedAction, onReview, onSign)}
                >
                  {block.proposedAction.type === "aerodrome_swap" ? "Review swap" : "Review this move"}
                </button>
              </div>
              {/* US6: optional hands-off run — renders only with a live in-scope grant + on-device key. */}
              {signable && <HandsOffAction action={block.proposedAction} />}
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
            {/* 029/FR-010 — the topic is a ROUTING key (`vault_safety`); never show it raw. */}
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{tipLabel(block.topic)}</span>
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
      // 029/FR-001 — an error BLOCK is a failed turn just as much as a failed request is, and
      // must read the same way: a distinct card that admits the failure and offers a retry. It
      // used to render as a flat inert notice with no way forward, so the honest general-branch
      // error and the mid-stream failure both looked like an assistant that had given up.
      return <TurnError message={block.message} code={block.code} onRetry={onRetry} />;

    default:
      return <InertNotice message={REJECTED_FALLBACK} />;
  }
}
