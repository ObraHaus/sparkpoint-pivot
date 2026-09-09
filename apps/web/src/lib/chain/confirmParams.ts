/**
 * confirmParams (FR-054) — the PURE, dependency-free parser that turns the standalone
 * /confirm/[intent] route's URL search params into the SAME `useVaultConfirm` amount inputs the
 * chat inline card carries from a live `proposedAction`. Kept import-free so it unit-tests directly
 * under the strip-types `node --test` runner (which can't resolve `@/…` / `@sparkpoint/…`).
 *
 * Amounts are RAW base units (a non-negative integer string, e.g. USDC 6-dp `"1000000"` = 1.00) —
 * identical to the chat path, which threads `exec.assets.toString()` / `exec.shares.toString()`.
 * A missing/empty/non-integer/zero value parses to `undefined` (never throws), so the route fails
 * safe to "no amount" and shows live amount entry rather than fabricating a gate.
 */

/** A minimal read-only view over URL params — satisfied by URLSearchParams + Next's ReadonlyURLSearchParams. */
export interface ParamSource {
  get(name: string): string | null;
}

export interface ConfirmParams {
  /** Deposit / withdraw-by-assets amount, base units. `undefined` when absent/invalid/zero. */
  readonly assets: bigint | undefined;
  /** Redeem-by-shares amount (withdraw only), base units. `undefined` when absent/invalid/zero. */
  readonly shares: bigint | undefined;
  /** The raw `?vault=` selection, forwarded verbatim to `resolveSelectedVault` (null ⇒ launch). */
  readonly vaultSelected: string | null;
  /**
   * 030 — the recommendation this confirm was started from, so the resulting transaction stays
   * attributable in the Outcome Log.
   *
   * `/strategies` used to link here with no amount and no recommendation id at all, so a deposit
   * begun from the strategies screen could never be linked back to the recommendation the user
   * acted on — the rec→transaction→outcome chain (feature 020) was broken at that entry point,
   * and the "by recommendation" view simply never saw those deposits.
   *
   * Validated as an opaque id: it is echoed into a request, so it is length-bounded and
   * restricted to id-safe characters rather than forwarded verbatim.
   */
  readonly recommendationId: string | undefined;
}

/** A recommendation id, or `undefined`. Ids are UUIDs or `rec_<slug>`; anything else is dropped. */
function parseRecommendationId(v: string | null): string | undefined {
  if (v === null) return undefined;
  const s = v.trim();
  if (!s || s.length > 64) return undefined;
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : undefined;
}

/** Parse one raw-base-unit param into a POSITIVE bigint, else `undefined`. Never throws. */
function parsePositiveBaseUnits(v: string | null): bigint | undefined {
  if (v === null) return undefined;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return undefined; // digits only — rejects sign, decimal, exponent, empty
  const n = BigInt(s);
  return n > 0n ? n : undefined;
}

/** Turn the route's `?assets=&shares=&vault=` into the `useVaultConfirm` amount inputs. */
export function parseConfirmParams(src: ParamSource): ConfirmParams {
  return {
    assets: parsePositiveBaseUnits(src.get("assets")),
    shares: parsePositiveBaseUnits(src.get("shares")),
    vaultSelected: src.get("vault"),
    recommendationId: parseRecommendationId(src.get("rec")),
  };
}
