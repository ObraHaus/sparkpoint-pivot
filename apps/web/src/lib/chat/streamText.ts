/**
 * 059/A2 — the pure reducer behind streamed prose.
 *
 * The SSE `text-delta` events are PAINT ONLY. The agent still sends the complete, post-processed
 * `text` / `tip` block afterwards, and that block is authoritative: it replaces the paint even
 * when a guardrail rewrote it, the clamp shortened it, a retry produced a different answer, or
 * the turn degraded to an error. Keeping this logic here (rather than in the page) makes the
 * replacement/retry rules testable without a browser.
 */

import type { ChatTextDelta } from "@/lib/agent/client";

export interface StreamTextState {
  /** The provisional prose currently painted. */
  readonly text: string;
  /** Which slot it belongs to; `undefined` before the first delta. */
  readonly target?: "text" | "tip";
  /** The attempt id. A change means a retry — RESET, never append. */
  readonly streamId?: string;
}

export const EMPTY_STREAM_TEXT: StreamTextState = { text: "" };

/**
 * Fold one delta into the provisional text.
 *
 * A different `streamId` (or target) is a NEW attempt, so the buffer is replaced rather than
 * concatenated — otherwise a retried answer would read as attempt one followed by attempt two.
 * A missing `streamId` is treated as "same stream" for forward compatibility with an agent that
 * chooses not to send one.
 */
export function reduceTextDelta(
  state: StreamTextState,
  delta: ChatTextDelta,
): StreamTextState {
  const sameStream =
    state.target === delta.target &&
    (delta.streamId === undefined || state.streamId === delta.streamId);
  return {
    text: sameStream ? `${state.text}${delta.delta}` : delta.delta,
    target: delta.target,
    streamId: delta.streamId,
  };
}

/**
 * Drop the provisional paint. Called when the authoritative `text` / `tip` block lands, when the
 * turn finishes, or when it fails — a partial answer must never survive as if it were the answer.
 */
export function clearStreamText(): StreamTextState {
  return EMPTY_STREAM_TEXT;
}
