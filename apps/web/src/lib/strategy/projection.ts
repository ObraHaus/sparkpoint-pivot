/**
 * projection — what a strategy would actually do to the user's money.
 *
 * WHY THIS EXISTS (030). The strategies screen showed "0.4% net APY · estimate" and nothing else.
 * On the test wallet's $1,503.26 balance that is about **$6.01 a year** — and neither number was
 * on screen, nor was the alternative of leaving the money idle, which earns exactly nothing. A
 * screen whose whole job is "where should I put this?" was asking the user to do the arithmetic
 * that is the reason they opened it.
 *
 * Two honesty rules are baked in, because both were violated by the obvious implementation:
 *
 *  1. **No balance is not zero.** Showing "$0.00/yr" to someone who holds nothing reads as "this
 *     strategy earns nothing", which is a claim about the strategy rather than about the wallet.
 *     Absence returns `null` and the caller renders a dash.
 *  2. **No rate is no projection.** A missing rate must never resolve to 0% — the same rule the
 *     agent already follows when the feed is unreadable.
 *
 * Exact integer arithmetic throughout. USDC is 6 dp and rates are basis points; doing this in
 * floating point invites a cent of drift in a number the user will check against their own
 * balance.
 *
 * Leaf module: no imports, no React — `node --test` loads it directly.
 */

/** A projection over one year at today's rate. All amounts are USDC base units (6 dp). */
export interface Projection {
  /** Projected earnings over 12 months at the current rate, in USDC base units. */
  readonly earningsBaseUnits: number;
  /** The same figure formatted as dollars, e.g. `"6.01"`. */
  readonly earnings: string;
  /** What the same balance earns if left idle. Always zero — stated, not implied. */
  readonly idleEarnings: string;
  /** The balance this was computed on, formatted, e.g. `"1,503.26"`. */
  readonly balance: string;
}

/** USDC has 6 decimals; every amount below is in base units. */
const USDC_DECIMALS = 6;

/** Format USDC base units as a 2-dp dollar string with thousands separators. Exact integer math. */
export function formatUsdc(baseUnits: number): string {
  const cents = Math.trunc(Math.abs(baseUnits) / 10 ** (USDC_DECIMALS - 2));
  const sign = baseUnits < 0 ? "-" : "";
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/**
 * Project a year of earnings for `balanceBaseUnits` at `netApyBps`.
 *
 * Returns `null` when there is nothing honest to say — no balance, or no rate. A zero or negative
 * rate is NOT nothing: a rate that really is ~0% is a true and useful fact about a test network,
 * and suppressing it would hide the thing the user most needs to understand.
 */
export function projectAnnual(
  balanceBaseUnits: number | null | undefined,
  netApyBps: number | null | undefined,
): Projection | null {
  if (typeof netApyBps !== "number" || !Number.isFinite(netApyBps)) return null;
  if (typeof balanceBaseUnits !== "number" || !Number.isFinite(balanceBaseUnits)) return null;
  if (balanceBaseUnits <= 0) return null;

  // basis points → earnings, integer-only: balance × bps / 10_000.
  const earnings = Math.trunc((balanceBaseUnits * Math.max(0, netApyBps)) / 10_000);
  return {
    earningsBaseUnits: earnings,
    earnings: formatUsdc(earnings),
    idleEarnings: formatUsdc(0),
    balance: formatUsdc(balanceBaseUnits),
  };
}

/**
 * The one-line summary a card shows beneath its rate.
 *
 * Deliberately mentions the idle alternative in the same breath: the comparison is the point, and
 * splitting it across two lines lets the eye skip it.
 */
export function projectionSummary(projection: Projection | null): string | null {
  if (!projection) return null;
  return `≈ $${projection.earnings}/yr on your $${projection.balance} · leaving it idle: $${projection.idleEarnings}`;
}

/**
 * Whether displayed rates come from a test network, where they are near zero and mean nothing
 * about the real thing. Saying so is the difference between "this product earns nothing" and
 * "these are test numbers" — the honest reading was unavailable on the page before 030.
 */
export function isTestnetRate(chainId: number | null | undefined): boolean {
  return chainId === 84532 || chainId === 46630 || chainId === 31337;
}

/** The caveat to show alongside any figure on a test network. */
export const TESTNET_RATE_NOTE =
  "These are Base Sepolia test-network rates. They sit near zero and are not indicative of real ones.";
