/**
 * premiumPay — pure, DOM-free helpers for the Premium pay screen so its money math is unit-testable
 * without a wallet/DOM. The price is the single configured value (NOT the retired mock 320/500). The
 * payment is a single plain `transfer`, so there is NO allowance / approve leg (SC-007 — the flow
 * grants no standing pull-approval). See SC-006, FR-020/FR-022.
 */

/**
 * Premium price in whole SRK — MUST match the agent's `PREMIUM_PRICE_SRK`, which is expressed in
 * BASE UNITS (so the env value is `10000000000000000000000`, i.e. 10000e18 — NOT `10000`).
 *
 * Client-decided 2026-08-02: 500 → 10,000 SRK/month, alongside the 5,000-SRK/24h faucet on
 * /premium. Web and agent must flip together at deploy — the verifier accepts `value >= price`, so
 * a web price BELOW the agent's is what breaks a purchase.
 */
export const PREMIUM_PRICE_SRK_WHOLE = 10_000n;
export const PREMIUM_PRICE_SRK_BASE = PREMIUM_PRICE_SRK_WHOLE * 10n ** 18n;

export interface PremiumPayInputs {
  /** The SRK token address on the active chain — falsy ⇒ Premium is unavailable here. */
  readonly srk?: string;
  /** The disclosed treasury (fee Safe) — falsy ⇒ unavailable. */
  readonly treasury?: string;
  /** On-chain `balanceOf(owner)`; `undefined` = not yet read (do NOT show a low-balance state yet). */
  readonly balance?: bigint;
  /** Price override for tests; defaults to the configured value. */
  readonly price?: bigint;
}

export interface PremiumPayState {
  readonly configured: boolean;
  readonly price: bigint;
  readonly balance: bigint;
  /** true once the on-chain balance has actually been read (gates the low-balance UI). */
  readonly balanceKnown: boolean;
  /** balance < price. */
  readonly low: boolean;
  /** max(0, price − balance). */
  readonly shortfall: bigint;
}

export function derivePremiumPayState(i: PremiumPayInputs): PremiumPayState {
  const price = i.price ?? PREMIUM_PRICE_SRK_BASE;
  const configured = Boolean(i.srk) && Boolean(i.treasury);
  const balanceKnown = i.balance !== undefined;
  const balance = i.balance ?? 0n;
  return {
    configured,
    price,
    balance,
    balanceKnown,
    low: balance < price,
    shortfall: balance < price ? price - balance : 0n,
  };
}
