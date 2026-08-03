/**
 * 036 — what the chat shows while Sparky is still working.
 *
 * It showed a pulsing dot and the word "Working…", which answers none of the three questions
 * somebody actually has while they wait: *is it still alive*, *what is it doing*, and *how long has
 * this been going*. A single static word for a turn that can take thirty seconds reads as a stall.
 *
 * The agent already streams what it is doing — `tool_step(label, status)`, six labels, the same
 * ones that become the trace above the answer. None of it was used while the turn was in flight.
 *
 * PURE and LEAF: no React, no imports, so the formatting and the choice of step are unit-testable
 * without a browser.
 */

/** The projection this module needs from a streamed card. */
export interface StepLike {
  readonly type: string;
  readonly label?: string;
  readonly status?: string;
}

/** Shown before the first step arrives, and between steps. */
export const DEFAULT_LABEL = "Thinking";

/**
 * Elapsed time, the way a person reads a stopwatch.
 *
 * Seconds alone under a minute — "8s" is instantly legible and "0m 08s" is not. Past a minute the
 * seconds are zero-padded so the number stops jumping width as it counts, which is what makes a
 * ticking timer feel steady rather than twitchy.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Which step to name right now: the most recent one still running.
 *
 * A step that has FINISHED is deliberately not shown. The agent emits `running` then `done` for
 * each stage, so between stages the honest answer is "thinking", not the name of something it has
 * already stopped doing — a label with an ellipsis after it is a claim about the present tense.
 */
export function currentStep(items: readonly StepLike[]): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.type !== "tool_step" || !item.label) continue;
    return item.status === "running" ? item.label : null;
  }
  return null;
}

/** The full line: what it is doing, with the ellipsis that means "still". */
export function thinkingLabel(step: string | null): string {
  return `${step ?? DEFAULT_LABEL}…`;
}

/**
 * Whether the wait has gone on long enough to deserve saying something about it.
 *
 * Under ten seconds a turn feels responsive and needs no excuse. Past that, silence starts to read
 * as a stall, and naming the wait — however briefly — is what separates "slow" from "stuck".
 */
export const LONG_WAIT_MS = 10_000;

export function reassurance(ms: number): string | null {
  if (ms < LONG_WAIT_MS) return null;
  if (ms < 30_000) return "Still going — longer answers take a moment.";
  return "Still going. You can keep this open; nothing is lost if you wait.";
}
