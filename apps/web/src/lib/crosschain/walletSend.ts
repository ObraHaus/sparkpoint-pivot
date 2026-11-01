/**
 * 068 — pure helpers for the optional "Send from wallet" deposit path.
 *
 * The card may offer a wallet transfer ONLY when the origin's EVM chain is one THIS build's wagmi
 * config actually registered (the beta build registers Robinhood Chain 4663 only), and the exact
 * human amount must be converted to base units without a float.
 */

/**
 * True iff the origin is an EVM chain the app can talk to. A non-EVM origin (`evmChainId` null)
 * never gets a wallet button — the user sends from their own chain's wallet instead.
 */
export function canSendFromWallet(
  originEvmChainId: number | null | undefined,
  registeredChainIds: readonly number[],
): boolean {
  return (
    typeof originEvmChainId === "number" &&
    registeredChainIds.includes(originEvmChainId)
  );
}

/**
 * Convert a human decimal string (commas allowed) to token base units. Returns null for anything
 * malformed, over-precise for the token, or not strictly positive — never a silently rounded
 * transfer amount.
 */
export function humanToBaseUnits(amount: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) return null;
  const padded = fraction.padEnd(decimals, "0");
  try {
    const value = BigInt(`${whole}${padded}`);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}
