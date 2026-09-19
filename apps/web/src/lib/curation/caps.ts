/**
 * Admin wrapper-request cap inputs → raw base units.
 *
 * The request form asks for human amounts ("5000" USDG); the agent and the factory speak raw
 * integer strings. This is the one place the conversion happens, so it is unit-tested rather than
 * trusted. Anything malformed or over-precise returns null and the form refuses to submit — a
 * wrongly scaled cap is a deposit-blocking typo (a 0 cap blocks everything; too many decimals
 * truncates).
 */

/** CapRegistry defaults (contracts/src/governance/CapRegistry.sol), in whole asset units. */
export const CAP_DEFAULTS = { perUser: "5000", total: "1000000", vault: "1000000" } as const;

/** "5,000" at 6 dp → "5000000000". Null when malformed or more precise than the asset's decimals. */
export function toRawCaps(value: string, decimals: number): string | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  return `${whole}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}
