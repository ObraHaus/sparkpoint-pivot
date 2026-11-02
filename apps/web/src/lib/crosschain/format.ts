/**
 * 068 — display-only formatting for a cross-chain quote.
 *
 * The agent serializes money as HUMAN decimal STRINGS (never floats), so the helpers here keep the
 * value as a string where they can. `formatUsd` and the countdown are display conveniences; they
 * are never fed back into a quote, a transfer amount, or a signing payload.
 */

/** Insert thousands separators into a run of digits. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a human decimal string for display, optionally truncating (never rounding up) the
 * fraction to `maxFractionDigits`. Invalid input is returned unchanged so a malformed wire value
 * is visible rather than silently rewritten.
 */
export function formatHumanAmount(value: string, maxFractionDigits?: number): string {
  if (typeof value !== "string" || value.trim() === "") return "—";
  const clean = value.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return clean;
  const whole = groupThousands(match[1] ?? "0");
  const rawFraction = match[2] ?? "";
  if (!rawFraction) return whole;
  const fraction =
    maxFractionDigits === undefined
      ? rawFraction
      : rawFraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, "");
  if (!fraction) return whole;
  return `${whole}.${fraction}`;
}

/** `$4,986.69` from `"4986.694350"`; `—` when absent/unparseable. Display only. */
export function formatUsd(value: string | undefined | null): string {
  if (value === undefined || value === null || value.trim() === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** A conservative, human ETA. `undefined` means 1Click did not quote one. */
export function formatEta(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "a short time";
  }
  if (seconds < 60) return "under a minute";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} min`;
}

/** `1.00%` from 100 bps — same presentation as the existing swap card. */
export function formatSlippage(bps: number | undefined | null): string {
  if (bps === undefined || bps === null || !Number.isFinite(bps)) return "—";
  return `${parseFloat((bps / 100).toFixed(2))}%`;
}

/**
 * `mm:ss` (or `h:mm:ss`) remaining until an ISO deadline. Returns `Expired` at/after the
 * deadline, and `—` when the deadline is absent or unparseable.
 */
export function formatCountdown(deadlineIso: string | undefined | null, nowMs: number): string {
  if (!deadlineIso) return "—";
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return "—";
  const remaining = deadline - nowMs;
  if (remaining <= 0) return "Expired";
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
