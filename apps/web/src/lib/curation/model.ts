/**
 * 048 — the curated-vault wire model + display helpers, shared by the public `/vault` board and
 * the Admin → Vaults → Curated panel. PURE: no fetch, no React, no clock read. Everything here is
 * deterministic so the surfaces decide the same way and the tests assert the real rules.
 *
 * The server is the source of truth for status/provenance/publish policy; this module only renders
 * it faithfully. Where a figure is unknown it stays null and renders as "—" — never 0.
 */

export type CurationStatus = "candidate" | "approved" | "hidden" | "denied";
export type CurationProvenance = "ai" | "admin";

export interface CurationAsset {
  address: string | null;
  symbol: string | null;
  decimals: number | null;
}

/** One stored net-APY observation (feature 050) — a point on the card's sparkline. */
export interface ApyPoint {
  /** ISO timestamp of the scan that observed it. */
  at: string;
  netApyBps: number;
}

export interface ScreeningVerdict {
  code: string;
  ok: boolean;
  detail: string;
}

export interface CurationVault {
  chainId: number;
  address: string;
  source: string;
  label: string;
  asset: CurationAsset;
  curator: string | null;
  curatorVerified: boolean;
  listed: boolean;
  status: CurationStatus;
  provenance: CurationProvenance;
  score: number | null;
  scoreInputs: Record<string, unknown>;
  screening: ScreeningVerdict[];
  netApyBps: number | null;
  tvlUsd: number | null;
  liquidityUsd: number | null;
  ageSeconds: number | null;
  wrapped: boolean;
  wrapperAddress: string | null;
  depositMode: "direct" | "wrapper";
  adminNote: string | null;
  pinned: boolean;
  pinnedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  firstSeenAt: string;
  lastScanAt: string | null;
  updatedAt: string;
  /** Merged from the recommendation for the public pick/alternates. */
  reason?: string;
  asOf?: string | null;
  /** 050 — the last ~30 stored APY observations (oldest → newest); absent ⇒ no chart. */
  apyHistory?: ApyPoint[];
}

export interface RecommendationItem {
  address: string;
  reason: string;
  score?: number | null;
}

export interface CurationRecommendation {
  runKey: string | null;
  asOf: string;
  source: string;
  pickAddress: string;
  pickReason: string;
  alternates: RecommendationItem[];
  published: boolean;
  provenance: CurationProvenance;
}

export interface CurationAuditEntry {
  action: string;
  chainId: number | null;
  address: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  at: string;
}

export interface CurationBoard {
  chainId: number;
  source: string;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  autoPublish: boolean;
  pick: CurationVault | null;
  alternates: CurationVault[];
  vaults: CurationVault[];
  note: string | null;
}

export interface CurationAdminData {
  chainId: number;
  source: string;
  autoPublish: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastRunKey: string | null;
  lastFailedAt: string | null;
  lastFailedDetail: Record<string, unknown>;
  runRequestedAt: string | null;
  runRequestedBy: string | null;
  recommendation: CurationRecommendation | null;
  vaults: CurationVault[];
  audit: CurationAuditEntry[];
}

// ── formatting ───────────────────────────────────────────────────────────────────────────────────

/** Basis points → "4.41%". Unknown stays an em dash, never "0.00%". */
export function fmtApyBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

/** Compact USD: $12k, $1.4M, $420.7M. Unknown stays an em dash. */
export function fmtUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

/** A vault's age, in whole units. Unknown stays an em dash. */
export function fmtAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86_400);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 1) return `${days}d`;
  return `${Math.floor(seconds / 3_600)}h`;
}

export function shortAddr(address: string, size = 4): string {
  if (address.length <= 2 + size * 2) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

/** ISO timestamp → a short local date-time, or "—". */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function curationStatusLabel(status: CurationStatus): string {
  switch (status) {
    case "candidate":
      return "Candidate";
    case "approved":
      return "Approved";
    case "hidden":
      return "Hidden";
    case "denied":
      return "Denied";
  }
}

/** Semantic tone for pills: approved = ok, denied = bad, hidden = muted, candidate = info. */
export function curationStatusTone(status: CurationStatus): "ok" | "bad" | "info" | "ghosty" {
  switch (status) {
    case "approved":
      return "ok";
    case "denied":
      return "bad";
    case "hidden":
      return "ghosty";
    case "candidate":
      return "info";
  }
}

/** The failed screening verdicts for a vault — what the reviewer needs, not the whole list. */
export function screeningFailures(vault: CurationVault): ScreeningVerdict[] {
  return (vault.screening ?? []).filter((v) => !v.ok);
}

export function curatorLabel(vault: CurationVault): string {
  if (!vault.curator) return "Unattributed";
  return vault.curatorVerified ? `${vault.curator} · verified` : vault.curator;
}

// ── selection of what to show ────────────────────────────────────────────────────────────────────

/** Ranked candidates for the review queue: score desc, TVL desc, address — total and stable. */
export function candidateQueue(vaults: CurationVault[]): CurationVault[] {
  return vaults
    .filter((v) => v.status === "candidate")
    .slice()
    .sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      if ((b.tvlUsd ?? 0) !== (a.tvlUsd ?? 0)) return (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0);
      return a.address < b.address ? -1 : 1;
    });
}

/** Vaults first seen within the last 7 days — the board's "new this week" marker. */
export function newThisWeek(vaults: CurationVault[], nowMs: number): CurationVault[] {
  const cutoff = nowMs - 7 * 86_400_000;
  return vaults.filter((v) => {
    const seen = Date.parse(v.firstSeenAt);
    return Number.isFinite(seen) && seen >= cutoff;
  });
}

export type CuratorRunState = "never-run" | "failed" | "requested" | "ok";

/** The one-line health of the daily loop, for the panel header and the board's provenance row. */
export function curatorRunState(data: {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  runRequestedAt?: string | null;
}): CuratorRunState {
  if (data.runRequestedAt) return "requested";
  if (!data.lastRunAt) return "never-run";
  return data.lastRunOk === false ? "failed" : "ok";
}

export function curatorRunLabel(data: {
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  runRequestedAt?: string | null;
}): string {
  switch (curatorRunState(data)) {
    case "requested":
      return "Run requested — waiting for the curator";
    case "never-run":
      return "Discovery hasn't run yet";
    case "failed":
      return "Last discovery run failed";
    case "ok":
      return `Last updated ${fmtWhen(data.lastRunAt)}`;
  }
}

// ── audit ────────────────────────────────────────────────────────────────────────────────────────

const AUDIT_VERB: Record<string, string> = {
  approve: "Approved",
  denied: "Denied",
  denied_by_admin: "Denied",
  hidden: "Hid",
  pin: "Pinned",
  unpin: "Unpinned",
  edit: "Edited",
  add: "Added by address",
  "run-now": "Requested a run",
  "auto-publish": "Auto-publish changed",
};

export function auditLine(entry: CurationAuditEntry): string {
  const verb = AUDIT_VERB[entry.action] ?? entry.action;
  const who = entry.actor ? shortAddr(entry.actor) : "curator";
  const what = entry.address ? ` ${shortAddr(entry.address)}` : "";
  return `${verb}${what} · ${who}`;
}
