/**
 * premiumPay — pure, DOM-free helpers for the Premium pay screen so its money math is unit-testable
 * without a wallet/DOM. The price is the single configured value (NOT the retired mock 320/500), and
 * the approve leg is derived ONLY from `allowance < price`. See contracts §8, SC-006, FR-020/FR-022.
 */

/** Premium price in whole SRK — MUST match the agent's `PREMIUM_PRICE_SRK` (500e18). */
export const PREMIUM_PRICE_SRK_WHOLE = 500n;
export const PREMIUM_PRICE_SRK_BASE = PREMIUM_PRICE_SRK_WHOLE * 10n ** 18n;

export interface PremiumPayInputs {
  /** The SRK token address on the active chain — falsy ⇒ Premium is unavailable here. */
  readonly srk?: string;
  /** The disclosed treasury (fee Safe) — falsy ⇒ unavailable. */
  readonly treasury?: string;
  /** On-chain `balanceOf(owner)`; `undefined` = not yet read (do NOT show a low-balance state yet). */
  readonly balance?: bigint;
  /** On-chain `allowance(owner, treasury)`; `undefined` = not yet read (treat as 0 ⇒ needs approve). */
  readonly allowance?: bigint;
  /** Price override for tests; defaults to the configured value. */
  readonly price?: bigint;
}

export interface PremiumPayState {
  readonly configured: boolean;
  readonly price: bigint;
  readonly balance: bigint;
  readonly allowance: bigint;
  /** true once the on-chain balance has actually been read (gates the low-balance UI). */
  readonly balanceKnown: boolean;
  /** balance < price. */
  readonly low: boolean;
  /** allowance < price ⇒ present the approve leg; otherwise only the pay leg. */
  readonly needsApprove: boolean;
  /** max(0, price − balance). */
  readonly shortfall: bigint;
}

export function derivePremiumPayState(i: PremiumPayInputs): PremiumPayState {
  const price = i.price ?? PREMIUM_PRICE_SRK_BASE;
  const configured = Boolean(i.srk) && Boolean(i.treasury);
  const balanceKnown = i.balance !== undefined;
  const balance = i.balance ?? 0n;
  const allowance = i.allowance ?? 0n;
  return {
    configured,
    price,
    balance,
    allowance,
    balanceKnown,
    low: balance < price,
    needsApprove: allowance < price,
    shortfall: balance < price ? price - balance : 0n,
  };
}
