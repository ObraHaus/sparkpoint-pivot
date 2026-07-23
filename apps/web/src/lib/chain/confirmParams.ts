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
  };
}
