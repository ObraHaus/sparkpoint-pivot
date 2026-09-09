/**
 * chatError — deciding what a failed turn is allowed to SAY to the user.
 *
 * WHY THIS EXISTS (029). The chat rendered the agent's §1.5 error envelope in the same slot as
 * prose, so a header-validation failure appeared in the transcript as though Sparky had said it:
 *
 *     "X-Account/X-Owner/X-Chain-Id are malformed or mismatched."
 *
 * That is our plumbing talking, and to a tester it reads as a broken product with a broken
 * assistant. Two rules follow, and both live here so they are unit-testable without a browser:
 *
 *  1. {@link isInternalEnvelope} — an internal/validation/transport message is never shown raw.
 *  2. {@link chatErrorCopy} — every failure maps to plain, honest, ACTIONABLE copy. It admits the
 *     failure (never a cheerful non-answer) and never blames the user for our defect.
 *
 * Leaf module: no React, no `@/` value imports, so `node --test` can load it directly.
 */

/** The §1.6 codes the chat can receive. Open (`string`) for forward-compat. */
export type ChatErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_HEADERS_INVALID"
  | "VALIDATION_ERROR"
  | "BETA_NOT_ENABLED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL"
  | (string & {});

/**
 * Phrases that are unmistakably OUR internals rather than an answer. Matching is deliberately
 * narrow — these are strings the agent emits, not things a user would ever type.
 */
const INTERNAL_MARKERS = [
  /x-account/i,
  /x-owner/i,
  /x-chain-id/i,
  /malformed or mismatched/i,
  /account_headers_invalid/i,
  /\bpolicyversion\b/i,
  /\brequestid\b/i,
  /\btraceback\b/i,
  /\bnonetype\b/i,
  // Observed during the 029 verification run, rendered to the user verbatim:
  //   "The vault RPC is unreachable; the quote is temporarily unavailable (retryable)."
  // Every word after "The vault" is ours, not theirs. A user does not know what an RPC is and
  // cannot act on "(retryable)" — the honest, actionable version is that something on our side
  // failed, nothing was signed, and they can try again.
  /\brpc\b/i,
  /\(retryable\)/i,
  /\bfail-closed\b/i,
];

/** Codes that always indicate plumbing, whatever the message says. */
const INTERNAL_CODES = new Set(["ACCOUNT_HEADERS_INVALID", "INTERNAL", "VALIDATION_ERROR"]);

/** `true` when this failure must NOT be shown to the user verbatim. */
export function isInternalEnvelope(message: string | null | undefined, code?: string): boolean {
  if (code && INTERNAL_CODES.has(code)) return true;
  const text = (message ?? "").trim();
  if (!text) return true;
  return INTERNAL_MARKERS.some((re) => re.test(text));
}

export interface ChatErrorView {
  /** One honest sentence for the user. Never the raw envelope. */
  readonly message: string;
  /** Whether offering "Try again" makes sense (a retry could plausibly succeed). */
  readonly retryable: boolean;
}

/**
 * The user-facing view of a failed turn.
 *
 * Safe messages from the agent (an honest refusal, a quota notice) are passed through — those are
 * written FOR users. Anything internal is replaced. The copy admits what happened in the user's
 * terms and, where a retry helps, says so.
 */
export function chatErrorCopy(
  message: string | null | undefined,
  code?: ChatErrorCode,
): ChatErrorView {
  if (code === "RATE_LIMITED") {
    return {
      message: (message ?? "").trim() || "You've reached today's limit for the assistant.",
      retryable: false,
    };
  }
  if (code === "UNAUTHENTICATED" || code === "BETA_NOT_ENABLED") {
    return {
      message: (message ?? "").trim() || "Sign in with your wallet to use the assistant.",
      retryable: false,
    };
  }
  if (isInternalEnvelope(message, code)) {
    return {
      message:
        "Something on our side stopped that message going through — nothing was signed or " +
        "changed. Try again in a moment.",
      retryable: true,
    };
  }
  if (code === "UPSTREAM_UNAVAILABLE") {
    return {
      message:
        (message ?? "").trim() ||
        "I couldn't reach my model just then — nothing was signed or changed. Try again.",
      retryable: true,
    };
  }
  return { message: (message ?? "").trim(), retryable: true };
}

/* ── 041b · which turns may offer "Try again" ───────────────────────────────── */

/**
 * The projection this rule needs from a rendered turn.
 *
 * Structural on purpose — naming the card type here would drag `@sparkpoint/shared/schemas` in
 * and this module would stop being loadable by `node --test`.
 */
export interface RetryableTurn {
  /** The turn is still being written. */
  readonly streaming: boolean;
  /** Set when the REQUEST itself failed, so no stream ever started. */
  readonly error?: string;
  /** The `type` of each block this turn streamed, in order. Inert cards contribute nothing. */
  readonly blockTypes: readonly string[];
}

/**
 * Whether a finished turn should offer to send its message again.
 *
 * THE BUG THIS FIXES. A turn fails in two quite different ways, and only one of them was wired to
 * the button. If the REQUEST fails there is no stream, the page catches it, and "Try again"
 * appears. But when the agent reaches its model and the model does not answer — an HTTP 502 from
 * the gateway, which is one turn in six on the free pool — the agent catches that itself and
 * streams an `error` BLOCK. That arrives as an ordinary card on a perfectly successful HTTP
 * response, so the page had no failed message to offer and the button never rendered.
 *
 * The card still said *"please try again"*. It just gave you nothing to press — and it was the
 * common failure, not the rare one.
 *
 * Streaming turns are excluded: until the stream ends there may still be an answer coming, and a
 * retry offered mid-turn invites a second message about a question that is still being answered.
 */
export function turnCanRetry(turn: RetryableTurn): boolean {
  if (turn.streaming) return false;
  if (turn.error) return true;
  // ONLY an explicit error block. An inert card is a block we could not validate — it renders its
  // own deliberately non-actionable notice (fail-closed), and the rest of the turn may be a
  // perfectly good answer that nobody should be invited to re-ask.
  return turn.blockTypes.includes("error");
}
