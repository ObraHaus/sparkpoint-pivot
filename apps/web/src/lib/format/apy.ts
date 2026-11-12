/**
 * One APY formatter for every user-facing surface.
 *
 * The agent/wire may carry a full-precision decimal (e.g. `10.2023855120367229327150527`). A card
 * must never print that raw string: two decimal places, truncated (never rounded UP) so a shown
 * APY can't claim more than the source figure.
 */

/** A percentage value (with or without a trailing `%`) rendered at exactly 2 dp, or `null`. */
export function formatApyPercent(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/%$/, "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const truncated = Math.trunc(n * 100) / 100;
  return `${truncated.toFixed(2)}%`;
}
