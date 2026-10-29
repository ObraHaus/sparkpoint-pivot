/**
 * 061 A9 — vault read cadence.
 *
 * The vault dashboard's reads used react-query's (wagmi) default polling, which refetched every
 * few seconds forever. On a page left open that is a constant stream of RPC calls for numbers that
 * move on the scale of a block, not a second — the live audit measured the /vault route never
 * going idle and pointed at it as a data/battery drain.
 *
 * Now: once a minute while the tab is visible; no background polling; and exponential backoff on
 * failure, stopping entirely after a handful of consecutive errors rather than hammering an RPC
 * that is already unwell. A manual refetch (or a window focus) still gets fresh numbers.
 */

/** Normal refresh cadence: one minute. */
export const VAULT_POLL_MS = 60_000;

/** Backoff ceiling between failed attempts. */
export const VAULT_MAX_BACKOFF_MS = 15 * 60_000;

/** Consecutive fetch failures after which polling stops (manual refetch still works). */
export const VAULT_MAX_CONSECUTIVE_FAILURES = 5;

/** How long to wait before the next poll, given the query's consecutive fetch-failure count. */
export function vaultRefetchInterval(failureCount: number): number | false {
  if (!Number.isFinite(failureCount) || failureCount <= 0) return VAULT_POLL_MS;
  if (failureCount >= VAULT_MAX_CONSECUTIVE_FAILURES) return false;
  return Math.min(VAULT_POLL_MS * 2 ** failureCount, VAULT_MAX_BACKOFF_MS);
}

/** Shared react-query options for every vault read. */
export function vaultQuery(enabled: boolean) {
  return {
    enabled,
    refetchInterval: (query: { state: { fetchFailureCount: number } }) =>
      vaultRefetchInterval(query.state.fetchFailureCount),
    // Never poll a tab the user is not looking at; a focus refetch covers the return.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
    retry: 2,
    retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 10_000),
  };
}
