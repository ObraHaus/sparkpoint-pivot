/**
 * Critical-operation signal (feature 006, US2). A dependency-free ref-counter that flow owners
 * increment while a funds- or data-loss-sensitive operation is in flight, so the force-refresh can
 * PAUSE around it. PURE store (no React) — the hooks live in useCriticalOp.ts — so the counting is
 * unit-testable and importable from the non-React chunkGuard.
 *
 * Severities:
 *  - LOCKED — funds at risk: a signature in progress, or a broadcast txHash without a terminal
 *    receipt (the double-submit window). Reload is BLOCKED while locked. (N2-adjacent safety.)
 *  - BUSY  — data loss: chat streaming, an unsent draft, a dirty admin editor, SIWE pending.
 */

export type Severity = "locked" | "busy";

export interface CriticalSnapshot {
  readonly locked: boolean;
  readonly busy: boolean;
}

const counts: Record<Severity, number> = { locked: 0, busy: 0 };
const listeners = new Set<() => void>();

/** Stable snapshot reference between changes (required by useSyncExternalStore). */
let snapshot: CriticalSnapshot = { locked: false, busy: false };
export const SERVER_SNAPSHOT: CriticalSnapshot = { locked: false, busy: false };

function recompute(): void {
  const locked = counts.locked > 0;
  const busy = counts.busy > 0;
  if (locked !== snapshot.locked || busy !== snapshot.busy) {
    snapshot = { locked, busy };
    listeners.forEach((fn) => fn());
  }
}

/** Increment `severity`; returns an idempotent release. */
export function beginCriticalOp(severity: Severity): () => void {
  counts[severity] += 1;
  recompute();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts[severity] = Math.max(0, counts[severity] - 1);
    recompute();
  };
}

export function subscribeCriticalOp(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCriticalSnapshot(): CriticalSnapshot {
  return snapshot;
}

/** Non-hook readers (for the global chunkGuard listener). */
export function isLocked(): boolean {
  return counts.locked > 0;
}
export function isBusy(): boolean {
  return counts.busy > 0;
}

/** Test-only: reset all counters. */
export function __resetCriticalOp(): void {
  counts.locked = 0;
  counts.busy = 0;
  snapshot = { locked: false, busy: false };
}
