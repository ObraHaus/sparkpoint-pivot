/**
 * 072 — display-only formatting for the multi-chain portfolio card and panel.
 *
 * The agent already serializes every amount and USD figure as a display string (never a float the
 * UI can feed back into a quote). A missing/unpriced value renders as an em dash; the card never
 * invents a number to fill the gap. Nothing here mutates or re-derives a wire value.
 */

import type {
  PortfolioSectionKey,
  PortfolioSectionStatus,
  PortfolioRow,
} from "@sparkpoint/shared/schemas";

const DASH = "—";

/** `$2,300.00` from the API's decimal string; `—` when absent or unparseable. */
export function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** A human section status. `ok` is "Live" (a successful read), never "synced" or "safe". */
export function statusLabel(status: PortfolioSectionStatus): string {
  switch (status) {
    case "ok":
      return "Live";
    case "not_linked":
      return "Not linked yet";
    default:
      return "Unavailable";
  }
}

/** The five section titles, used for the panel headings and the chat card summary. */
export function sectionLabel(key: PortfolioSectionKey): string {
  switch (key) {
    case "balances":
      return "Wallet balances";
    case "morpho":
      return "Morpho";
    case "kamino":
      return "Kamino";
    case "rhea":
      return "Rhea";
    case "swaps":
      return "Cross-chain swaps";
  }
}

/**
 * The route a swap row describes. The wire's `route` is preferred; otherwise it is composed from
 * the labelled endpoints, and only then from the raw keys. `—` when nothing names the route.
 */
export function routeLabel(row: Pick<PortfolioRow, "route" | "originLabel" | "destinationLabel" | "originKey" | "destinationKey" | "symbol">): string {
  if (row.route) return row.route;
  if (row.originLabel && row.destinationLabel) {
    return `${row.originLabel} -> ${row.destinationLabel}`;
  }
  if (row.originKey && row.destinationKey) return `${row.originKey} -> ${row.destinationKey}`;
  return row.symbol || DASH;
}

/**
 * A short, human relative time from an ISO timestamp. `nowMs` is injected so the render/tests
 * never read the clock implicitly. A future or unparseable value is honest about it.
 */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return DASH;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return DASH;
  const seconds = Math.floor((nowMs - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** `0x1234…abcd` for a deposit address; a short value is returned unchanged. */
export function shortenAddress(value: string | null | undefined): string {
  if (!value) return DASH;
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** A swap status pill label. Unknown wire statuses are title-cased, never invented as success. */
export function swapStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  const normalised = status.trim().toUpperCase();
  switch (normalised) {
    case "SUCCESS":
    case "COMPLETED":
      return "Completed";
    case "PENDING":
    case "PROCESSING":
      return "Pending";
    case "FAILED":
    case "REFUNDED":
      return "Refunded";
    default:
      return status;
  }
}

/** True when a swap status is terminal (the pill can stop saying "in progress"). */
export function isSwapTerminal(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalised = status.trim().toUpperCase();
  return ["SUCCESS", "COMPLETED", "FAILED", "REFUNDED"].includes(normalised);
}

/** The honest empty copy for a section that read successfully but has no rows. */
export function sectionEmptyCopy(key: PortfolioSectionKey): string {
  switch (key) {
    case "balances":
      return "No non-zero balances in this wallet.";
    case "morpho":
      return "No Morpho vault positions for this wallet.";
    case "kamino":
      return "No Kamino share positions on a linked Solana address.";
    case "rhea":
      return "No supplied positions on Rhea.";
    case "swaps":
      return "You don't have any cross-chain swaps yet.";
  }
}

/** `4.41% net APY` / `APY unavailable` for an earn row. */
export function apyLine(apy: string | null | undefined, kind: "net" | "supply" = "net"): string {
  if (!apy || apy.trim() === "") return "APY unavailable";
  return `${apy}% ${kind === "supply" ? "supply APY" : "net APY"}`;
}
