/**
 * What's New visibility — pure, leaf logic so it can be unit-tested without a browser.
 *
 * The greeting used to be a modal with a full-screen scrim: it blocked the app until dismissed,
 * on the one screen a returning user opened to do something. It is now a dismissible panel, and
 * "once per release" is keyed to the newest entry's SLUG (a stable release identity) rather than
 * to a raw row id — so it survives a re-seed that renumbers rows and is readable in localStorage.
 */

export interface WhatsNewEntryLike {
  /** The seed slug when present; older/operator rows may only have an id. */
  readonly slug?: string | null;
  readonly id?: number;
}

/** The stable release identity: slug, else a namespaced id for legacy rows. */
export function releaseKey(entry: WhatsNewEntryLike): string | null {
  const slug = entry.slug?.trim();
  if (slug) return slug;
  return typeof entry.id === "number" ? `id:${entry.id}` : null;
}

/** localStorage key holding the slug of the newest release the user has seen. */
export const WHATS_NEW_SEEN_KEY = "sp.whats-new.seen.v1";

/** First visit shows a bounded welcome, never the whole backlog. */
export const FIRST_VISIT_CAP = 4;

/** Later visits show at most this many unseen entries. */
export const UNSEEN_CAP = 8;

/**
 * Entries to show for this visit (newest first), or `[]` when there is nothing new.
 *
 * - No marker yet (brand-new user, or active before this shipped) → a capped welcome.
 * - A marker that matches the newest slug → nothing: this release has been acknowledged.
 * - A marker on an older entry → only the entries above it (newest-first).
 * - An unknown marker (cleared/renamed release) → the capped welcome, never a blank panel.
 */
export function selectFreshEntries<T extends WhatsNewEntryLike>(
  entries: readonly T[],
  seenSlug: string | null,
): T[] {
  if (entries.length === 0) return [];
  const newest = releaseKey(entries[0]);
  if (!seenSlug) return entries.slice(0, FIRST_VISIT_CAP);
  if (seenSlug === newest) return [];
  const idx = entries.findIndex((e) => releaseKey(e) === seenSlug);
  if (idx <= 0) return entries.slice(0, FIRST_VISIT_CAP);
  return entries.slice(0, idx).slice(0, UNSEEN_CAP);
}
