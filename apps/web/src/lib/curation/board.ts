/**
 * 048 / T301 — the `/vault` curated board's display decisions, PURE and testable.
 *
 * The board renders what the agent stored (approved vaults + a published pick); this module owns
 * the questions a component would otherwise answer inline and untestably: which provenance chip a
 * row earns, how the board filters, what the honest empty state says, and where "Ask Sparky" goes.
 * No fetch, no React, no clock read.
 */

import { newThisWeek, type CurationBoard, type CurationVault } from "./model.ts";

/** The exact question the /vault entry point prefills — one string, one place. */
export const ASK_SPARKY_QUESTION = "What's the best vault right now?";

/** The chat deep link with the question prefilled (chat reads `?ask=` once on mount). */
export function chatAskHref(question: string = ASK_SPARKY_QUESTION): string {
  return `/chat?ask=${encodeURIComponent(question)}`;
}

/** A per-vault deep link back to the board, so chat answers can point at a specific row. */
export function vaultDeepLink(address: string): string {
  return `/vault?vault=${encodeURIComponent(address)}`;
}

export type ProveanceChip = {
  label: string;
  tone: "ok" | "info" | "ghosty";
};

/** The provenance chip: who put this row here, and whether an admin has touched it. */
export function provenanceChip(vault: CurationVault): ProveanceChip {
  if (vault.pinned) return { label: "Admin pick", tone: "ok" };
  if (vault.provenance === "admin") return { label: "Admin", tone: "info" };
  return { label: "AI pick", tone: "ghosty" };
}

/** "AI pick · last updated 18 Sep 2026, 12:00" — the board's as-of line, or an honest absence. */
export function boardProvenance(board: CurationBoard): string {
  if (board.lastRunOk === false && !board.lastRunAt) return "Last update failed";
  if (!board.lastRunAt) return "No updates yet";
  const when = new Date(board.lastRunAt);
  if (!Number.isFinite(when.getTime())) return "Last update time unavailable";
  return `Last updated ${when.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export interface BoardFilter {
  query?: string;
  newOnly?: boolean;
}

/**
 * Filter the board's rows. Query matches label, symbol and address; `newOnly` keeps vaults first
 * seen this week. Order is preserved (the server ranked it) — filtering never re-ranks.
 */
export function filterVaults(
  vaults: CurationVault[],
  filter: BoardFilter,
  nowMs: number,
): CurationVault[] {
  let rows = vaults;
  const query = (filter.query ?? "").trim().toLowerCase();
  if (query) {
    rows = rows.filter(
      (v) =>
        v.label.toLowerCase().includes(query) ||
        (v.asset.symbol ?? "").toLowerCase().includes(query) ||
        v.address.toLowerCase().includes(query),
    );
  }
  if (filter.newOnly) {
    const fresh = new Set(newThisWeek(vaults, nowMs).map((v) => v.address));
    rows = rows.filter((v) => fresh.has(v.address));
  }
  return rows;
}

export interface EmptyBoardCopy {
  title: string;
  body: string;
}

/**
 * The honest empty state. Four different causes must not read as one, because "nothing here" is
 * otherwise indistinguishable from "we're broken".
 */
export function boardEmptyCopy(board: CurationBoard): EmptyBoardCopy {
  if (board.lastRunOk === false) {
    return {
      title: "Discovery failed on its last run",
      body:
        "The curator couldn't reach its vault source, so there's no fresh list to show — and " +
        "nothing was changed. The last good record still stands and the next run will retry.",
    };
  }
  if (!board.lastRunAt) {
    return {
      title: "Discovery hasn't run yet",
      body:
        "The curator runs daily against this chain's vault source. As soon as it reports a " +
        "screened vault, it appears here. Nothing is hidden — there is simply nothing yet.",
    };
  }
  return {
    title: "No curated vaults on this network yet",
    body:
      "The curator is configured for this chain and scans it daily, but no vault has passed " +
      "screening yet. This page fills in by itself when one does — an empty board here is the " +
      "honest answer, not a missing feature.",
  };
}

/** True when a board has nothing to render at all (no pick and no approved vaults). */
export function boardIsEmpty(board: CurationBoard): boolean {
  return board.pick === null && board.vaults.length === 0;
}
