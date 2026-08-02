/**
 * memoryView — the pure, dependency-free mapper for "Sparky's memory" (feature 027,
 * `GET /memory/self`). Wire → the rows the Settings card renders.
 *
 * HONESTY IS THE POINT of this surface: it shows what the assistant is actually given, so the
 * mapper deliberately does NOT rewrite, summarize, or prettify a line. It only decides ORDER
 * (newest first, because that is what a person scanning the list wants) and formats the
 * timestamp. If a line is unreadable, the honest fix is a better line at the source, not a
 * friendlier one here.
 *
 * No `@/` runtime imports (type-only) so it stays a leaf module unit-testable under
 * `node --experimental-strip-types`.
 */

/** One remembered line off the wire (fields optional — defensive parsing). */
export interface MemoryLineDto {
  at?: string; // ISO-8601
  line?: string;
}

/** `GET /memory/self` body off the wire (all optional). */
export interface MemoryResponseDto {
  lines?: MemoryLineDto[];
  updatedAt?: string | null;
}

/** One display row. `text` is the stored line VERBATIM. */
export interface MemoryRow {
  /** Stable key for React — the wire carries no id, so index+line is the identity. */
  key: string;
  text: string;
  dateText: string; // "Aug 2" | "" when the timestamp is missing/unparseable
}

/** The whole card view. */
export interface MemoryView {
  rows: MemoryRow[];
  /** `true` when there is genuinely nothing remembered — the card's honest empty state. */
  isEmpty: boolean;
  count: number;
  updatedText: string;
}

/** A short absolute date label ("Aug 2"). Absolute, not relative: memory spans days-to-weeks,
 * where "5d ago" is harder to place than a date. Empty string for a missing/unparseable value. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Map the wire body into the card view. Newest FIRST (the agent stores oldest-first, since that
 * is the order the model reads them in). Blank/malformed entries are dropped rather than rendered
 * as empty rows; `undefined` (not loaded, or an offline agent) maps to the empty view, which is
 * exactly what a brand-new user sees — the card never invents a memory.
 */
export function toMemoryView(dto: MemoryResponseDto | undefined | null): MemoryView {
  const raw = Array.isArray(dto?.lines) ? dto.lines : [];
  const rows: MemoryRow[] = [];
  raw.forEach((entry, index) => {
    const text = typeof entry?.line === "string" ? entry.line.trim() : "";
    if (!text) return;
    rows.push({ key: `${index}:${text}`, text, dateText: shortDate(entry?.at) });
  });
  rows.reverse(); // stored oldest-first; read newest-first
  const updated = shortDate(dto?.updatedAt);
  return {
    rows,
    isEmpty: rows.length === 0,
    count: rows.length,
    updatedText: updated ? `Last updated ${updated}` : "",
  };
}
