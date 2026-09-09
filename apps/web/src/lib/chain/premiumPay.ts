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

/**
 * The chains on which a Premium purchase can actually be SETTLED — i.e. the chains the agent's
 * `PaymentVerifier` can see (`services/agent/src/sparkpoint_agent/chain/payment_verifier.py`).
 *
 * ⚠️ This list is deliberately POSITIVE and deliberately short. The verifier is constructed with ONE
 * `srk_address` and ONE RPC (`SRK_ADDRESS_84532`), so Base Sepolia is the only chain where a
 * transfer of SRK becomes Premium. Feature 043 phase 1 deployed a SECOND, unrelated SRK + faucet on
 * Robinhood testnet 46630 so a Sparky Broker can retire SRK on its own chain — that SRK is real, it
 * is spendable, and `/premium/pay` reads the address book for whatever chain the wallet is on. If
 * this gate did not exist, the only thing standing between a tester and an unverifiable payment
 * would be the ABSENCE of `premiumTreasury` in `robinhoodTestnet.ts` — and an absent field is not a
 * safety mechanism, it is a field nobody has filled in yet.
 *
 * Adding a chain here is a claim that the agent can credit a payment made on it. Do not add one
 * without changing the verifier to match.
 */
export const PREMIUM_SETTLEMENT_CHAIN_IDS: readonly number[] = [84532];

/** Whether a Premium payment made on `chainId` can be verified and credited. Fail-closed. */
export function canSettlePremium(chainId: number | undefined): boolean {
  return chainId !== undefined && PREMIUM_SETTLEMENT_CHAIN_IDS.includes(chainId);
}

export interface PremiumPayInputs {
  /** The SRK token address on the active chain — falsy ⇒ Premium is unavailable here. */
  readonly srk?: string;
  /** The disclosed treasury (fee Safe) — falsy ⇒ unavailable. */
  readonly treasury?: string;
  /**
   * The connected wallet's chain. `undefined`, or a chain the verifier cannot see, ⇒ NOT configured
   * however complete the addresses look. See `PREMIUM_SETTLEMENT_CHAIN_IDS`.
   */
  readonly chainId?: number;
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
  const configured = Boolean(i.srk) && Boolean(i.treasury) && canSettlePremium(i.chainId);
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
