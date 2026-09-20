/**
 * 050 — the redesigned `/vault` board's PURE logic: the live-only filter, hero precedence (mirrors
 * the agent's `public_board`), the lazy-batch math, the sparkline path and the admin panel counts.
 *
 * PURE: no fetch, no React, no clock read. The component injects `nowMs` where time matters, so
 * the rules are unit-testable and the page cannot disagree with the server's own filter.
 */

import { newThisWeek, type CurationBoard, type CurationVault } from "./model.ts";

/** Cards revealed per lazy batch. */
export const LIVE_BATCH_SIZE = 6;

/** The public rule (feature 050): only a wrapped vault is depositable and therefore public. */
export function isLive(vault: CurationVault): boolean {
  return Boolean(vault.wrapped && vault.wrapperAddress);
}

export function liveVaults(board: CurationBoard): CurationVault[] {
  return board.vaults.filter(isLive);
}

function byScoreThenTvl(a: CurationVault, b: CurationVault): number {
  return (
    (b.score ?? -1) - (a.score ?? -1) ||
    (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) ||
    a.address.localeCompare(b.address)
  );
}

/**
 * The feature card's vault. The server already guarantees `board.pick` is live, but the client
 * re-checks (defensive) and falls back to the highest-score live vault so the card never shows an
 * in-flight row or an empty hero when something is depositable.
 */
export function heroPick(board: CurationBoard): CurationVault | null {
  if (board.pick && isLive(board.pick)) return board.pick;
  const live = liveVaults(board);
  if (live.length === 0) return null;
  return [...live].sort(byScoreThenTvl)[0] ?? null;
}

/** Chip filters for the live list (All / New this week / AI-curated). */
export interface BoardFilters {
  newOnly: boolean;
  aiOnly: boolean;
}

export function filterBoard(
  vaults: CurationVault[],
  filters: BoardFilters,
  nowMs: number,
): CurationVault[] {
  const fresh = new Set(newThisWeek(vaults, nowMs).map((v) => v.address));
  return vaults.filter((v) => {
    if (filters.newOnly && !fresh.has(v.address)) return false;
    if (filters.aiOnly && v.provenance !== "ai") return false;
    return true;
  });
}

/** Next reveal count for the lazy list (never past the end, never backwards). */
export function nextBatch(shown: number, total: number, size = LIVE_BATCH_SIZE): number {
  return Math.max(0, Math.min(total, shown + size));
}

export function hasMore(shown: number, total: number): boolean {
  return shown < total;
}

/**
 * An SVG path for the card sparkline. Chronological points, scaled to `width`×`height` with a 2px
 * inset; `null` when fewer than two finite observations exist (no chart beats a fake one).
 */
export function sparklinePath(
  points: Array<{ netApyBps: number }> | undefined,
  width: number,
  height: number,
): string | null {
  const values = (points ?? [])
    .map((p) => p.netApyBps)
    .filter((n): n is number => Number.isFinite(n));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const inset = 2;
  const usable = height - inset * 2;
  return values
    .map((value, i) => {
      const x = i * stepX;
      const y = height - inset - ((value - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** The sparkline's honest range label, or null when there is no chart. */
export function sparklineRange(points: Array<{ netApyBps: number }> | undefined): string | null {
  const values = (points ?? [])
    .map((p) => p.netApyBps)
    .filter((n): n is number => Number.isFinite(n));
  if (values.length < 2) return null;
  return `${(Math.min(...values) / 100).toFixed(2)}% – ${(Math.max(...values) / 100).toFixed(2)}%`;
}

// ── admin panel (050) ────────────────────────────────────────────────────────────────────────────

export interface InFlightCounts {
  /** Approved curated vaults with no wrapper deployed yet. */
  approvedUnwrapped: number;
  /** Pending admissions (whitelisted, not deployed): cooling + ready. */
  whitelisted: number;
  cooling: number;
  failed: number;
  /** Curator candidates awaiting an admin decision. */
  candidates: number;
  total: number;
}

export interface InFlightInput {
  entries: Array<{ status: string; ready: boolean }>;
  /** The whitelist endpoint's candidates = approved + unwrapped. */
  candidates: unknown[];
  /** The admin curation list (statuses: candidate/approved/hidden/denied). */
  curation: Array<{ status: string }>;
}

/** Counts for the admin-only panel; rendered only for an admin session, from admin endpoints. */
export function inFlightCounts(input: InFlightInput): InFlightCounts {
  const pending = input.entries.filter((e) => e.status === "pending");
  const cooling = pending.filter((e) => !e.ready).length;
  const failed = input.entries.filter((e) => e.status === "failed").length;
  const candidates = input.curation.filter((v) => v.status === "candidate").length;
  const approvedUnwrapped = input.candidates.length;
  return {
    approvedUnwrapped,
    whitelisted: pending.length,
    cooling,
    failed,
    candidates,
    total: approvedUnwrapped + pending.length + failed + candidates,
  };
}
