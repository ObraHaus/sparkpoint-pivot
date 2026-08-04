/**
 * 040 — which time heading a conversation belongs under.
 *
 * The sidebar was one undifferentiated column of titles, newest first, saying nothing about when
 * anything happened. On the busiest wallet on alpha that column is fifty rows, forty-seven of them
 * from a single day, with "Explain the performance fee" appearing five times. A list you scroll
 * rather than read.
 *
 * PURE and LEAF: no React, no imports. Dates are the classic thing that is hard to test through a
 * UI and trivial to test as data — "a conversation from 23:59 yesterday, read at 00:01 today" is
 * one line here and a scheduling problem in a browser.
 */

/** The projection this module needs from a conversation row. */
export interface HistoryRow {
  readonly id: string;
  readonly title: string;
  /** ISO 8601, UTC, as the API sends it. */
  readonly updatedAt?: string;
  readonly createdAt?: string;
}

export interface HistoryGroup<T extends HistoryRow = HistoryRow> {
  /** Stable across renders — safe as a React key, unlike the label. */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly rows: readonly T[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Local midnight on the day `d` falls in.
 *
 * `setHours(0,0,0,0)` on a LOCAL Date, never `t - 86_400_000`. Subtracting a fixed day in
 * milliseconds is wrong twice a year in any zone that observes daylight saving — one day is 23
 * hours in spring and 25 in autumn — and the bug it produces is a conversation appearing under the
 * wrong heading for one day a year, which nobody would ever report.
 */
function startOfLocalDay(d: Date): number {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/** Whole local days between two instants — 0 for today, 1 for yesterday. */
export function daysAgo(then: Date, now: Date): number {
  const days = (startOfLocalDay(now) - startOfLocalDay(then)) / 86_400_000;
  return Math.round(days);
}

/** When this conversation was last active. Falls back to creation, then to nothing. */
export function activityDate(row: HistoryRow): Date | null {
  const raw = row.updatedAt || row.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface Bucket {
  key: string;
  label: string;
  /** Newest period first. */
  rank: number;
}

/**
 * The heading a date belongs under.
 *
 * Months of a previous year carry the year — "January" alone would mean two different things in a
 * list that spans a new year, and the reader has no way to tell which.
 */
export function bucketFor(when: Date, now: Date): Bucket {
  const age = daysAgo(when, now);

  if (age <= 0) return { key: "today", label: "Today", rank: 0 };
  if (age === 1) return { key: "yesterday", label: "Yesterday", rank: 1 };
  if (age <= 7) return { key: "7d", label: "Previous 7 days", rank: 2 };
  if (age <= 30) return { key: "30d", label: "Previous 30 days", rank: 3 };

  const year = when.getFullYear();
  const month = when.getMonth();
  const thisYear = now.getFullYear();

  if (year === thisYear) {
    // Rank descends with the month so a later month sorts above an earlier one.
    return { key: `m-${year}-${month}`, label: MONTHS[month], rank: 100 - month };
  }
  // Older years: still by month, but labelled with the year so the heading is unambiguous.
  return {
    key: `m-${year}-${month}`,
    label: `${MONTHS[month]} ${year}`,
    rank: 1000 + (thisYear - year) * 100 + (11 - month),
  };
}

/**
 * Conversations under their headings, newest period first, empty periods omitted.
 *
 * A row without a usable date is kept rather than dropped — a conversation you cannot date is still
 * a conversation you might want to open, and silently hiding it would be a worse bug than putting
 * it last.
 */
export function groupConversations<T extends HistoryRow>(
  rows: readonly T[],
  now: Date,
): HistoryGroup<T>[] {
  const buckets = new Map<string, { bucket: Bucket; rows: T[] }>();
  const undated: T[] = [];

  for (const row of rows) {
    const when = activityDate(row);
    if (!when) {
      undated.push(row);
      continue;
    }
    const bucket = bucketFor(when, now);
    const existing = buckets.get(bucket.key);
    if (existing) existing.rows.push(row);
    else buckets.set(bucket.key, { bucket, rows: [row] });
  }

  const groups = [...buckets.values()]
    .sort((a, b) => a.bucket.rank - b.bucket.rank)
    .map(({ bucket, rows: inGroup }) => ({
      key: bucket.key,
      label: bucket.label,
      count: inGroup.length,
      rows: inGroup,
    }));

  if (undated.length) {
    groups.push({ key: "undated", label: "Earlier", count: undated.length, rows: undated });
  }
  return groups;
}

/**
 * The time of last activity, for telling two identically-titled conversations apart.
 *
 * Today shows a clock time, because that is what distinguishes five threads all called "Explain the
 * performance fee" asked in one afternoon. Anything older shows a date, because by then the hour is
 * not what you remember.
 */
export function rowTimestamp(row: HistoryRow, now: Date): string {
  const when = activityDate(row);
  if (!when) return "";
  const age = daysAgo(when, now);
  if (age <= 0) {
    return when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (age < 365) {
    return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return when.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * What the "show older" control says — or `null` when it must not appear at all.
 *
 * Its absence is a statement: it means this is all of them. So it is `null` the moment nothing more
 * exists, and it always names the exact number remaining. "Show more" leaves you not knowing whether
 * you are near the end, which is the question the missing rows created in the first place.
 */
export function olderLabel(loaded: number, total: number): string | null {
  const remaining = total - loaded;
  if (remaining <= 0) return null;
  if (remaining === 1) return "Show 1 older conversation";
  return `Show ${remaining} older conversations`;
}
