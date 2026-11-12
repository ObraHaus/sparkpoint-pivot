/**
 * Phrases that must not reach a user's eyes, and the surfaces checked for them (feature 044).
 *
 * ⚠️ **Why this exists as a separate module.** Two pieces of retired copy survived a source grep and
 * were only caught by rendering the deployed page:
 *
 *   * The Premium card read **"10,000 SRK /mo"**. The sweep searched for `per month`; the markup
 *     says `/mo` in its own `<span>`, so neither the phrase nor the pattern matched the source.
 *   * `/srk` said the faucet **"lives on Premium"** — on the page that now hosts the faucet.
 *
 * Both share one cause: **the visible sentence is not a substring of any single source line.** A
 * grep over raw TSX cannot see it, because the words are split across elements and separated by
 * tags, attributes and braces.
 *
 * `copy-audit.test.ts` therefore strips the markup first and matches against the resulting text, so
 * a phrase broken across elements is still found. That is an approximation of the rendered page —
 * it cannot see text that arrives from an API, and it does not replace
 * `e2e/pw/visual-audit.spec.ts` running against the deployed app. It closes the specific hole that
 * let both of those ship.
 */

/** Surfaces a user reads that describe Premium, brokers, SRK or revenue. */
export const AUDITED_SOURCES = [
  "src/app/(app)/swap/page.tsx",
  "src/app/(app)/premium/page.tsx",
  "src/app/(app)/brokers/page.tsx",
  "src/app/(app)/brokers/[id]/activate/page.tsx",
  "src/app/(app)/brokers/revenue/page.tsx",
  "src/app/(app)/srk/page.tsx",
  "src/app/(app)/fees/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/lib/chain/brokers.ts",
] as const;

/** Surfaces where revenue share is described. A rate here would be a fabrication. */
export const BROKER_SURFACES = ["brokers", "premium", "chain/brokers.ts"] as const;

export interface RetiredPhrase {
  readonly pattern: RegExp;
  readonly why: string;
  /**
   * Path fragments this rule applies to. Omitted ⇒ every audited surface.
   *
   * ⚠️ Scoping is not a loophole, it is the difference between a lie and a fact. `/fees` says
   * "shown in every net-APY breakdown" about the VAULT's real, measured Aave yield — that is a
   * number the product genuinely reports and must keep reporting. The same three letters next to a
   * broker would be a projection nothing can back. Banning the string globally would have forced
   * the honest page to stop telling the truth.
   */
  readonly only?: readonly string[];
}

/**
 * Copy that is no longer true of the product.
 *
 * Each entry names what it is protecting against, because a bare regex list rots: the next person
 * needs to know whether a match is a real regression or a rule that has outlived the product.
 */
export const RETIRED_PHRASES: readonly RetiredPhrase[] = [
  { pattern: /buy a month/i, why: "the monthly SRK subscription is retired (043 phase F)" },
  { pattern: /cancel anytime/i, why: "nothing renews, so there is nothing to cancel" },
  { pattern: /10,?000 SRK per month/i, why: "activation is a one-off, and tiered since 043c" },
  { pattern: /premium subscription/i, why: "Premium comes from an activated broker, not a plan" },
  { pattern: /SRK\s*\/\s*mo\b/i, why: "the exact string that survived a source grep and shipped" },
  { pattern: /per month/i, why: "there is no monthly anything" },
  { pattern: /comes from a subscription/i, why: "post-sunset a stored tier is an admin grant" },
  {
    pattern: /faucet[^.]{0,40}(on|lives on) premium/i,
    why: "the faucet moved to /srk; this claim was made ON the page that now hosts it",
  },
  // 044: a weight is not an income stream, and nothing pays out yet.
  { pattern: /weight in every revenue/i, why: "promises a payout that does not exist" },
  { pattern: /passive income|monthly income|\bdividends?\b/i, why: "not an income product" },
  {
    pattern: /\bAPY\b|\bAPR\b/i,
    why: "a broker has no rate and no oracle to back one (the vault's measured APY is fine)",
    only: BROKER_SURFACES,
  },
  {
    pattern: /\bearn(s|ing|ings)?\b/i,
    why: "a weight is a share of whatever arrives; today nothing does (the vault's fee copy is fine)",
    only: BROKER_SURFACES,
  },
  {
    pattern: /\$\s*\d|\d+\s*%/,
    why: "no figure may be projected for a broker; only what the chain says is claimable now",
    only: ["brokers/revenue"],
  },
  {
    pattern: /not faked/i,
    why: "engineering voice shown to users; describe what the page does instead",
    only: ["swap/page.tsx"],
  },
  {
    pattern: /run through Sparky/i,
    why: "the manual swap page now runs cross-chain swaps itself instead of deferring to chat",
    only: ["swap/page.tsx"],
  },
] as const;

/** Whether a rule applies to a given audited path. */
export function appliesTo(phrase: RetiredPhrase, path: string): boolean {
  return phrase.only === undefined || phrase.only.some((frag) => path.includes(frag));
}

/**
 * Strip TSX down to roughly what a user would read.
 *
 * Deliberately crude and deliberately over-inclusive: it removes tags, attributes, imports and
 * comments, then collapses whitespace, so text split across elements becomes one string. The point
 * is that `{price}<span>/mo</span>` collapses to `... /mo` and is therefore greppable.
 *
 * ⚠️ Over-inclusion is the safe direction here. A false positive is a five-second look at a diff; a
 * false negative is retired copy shipping to users, which has already happened twice.
 */
export function visibleText(source: string): string {
  return source
    // Block comments carry the reasoning, including quoted examples of the very phrases banned
    // below. Stripping them first stops a comment explaining a rule from tripping it.
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?/gm, " ")
    // Attributes hold classNames and hrefs, not prose.
    .replace(/<[A-Za-z][^>]*?>/g, " ")
    .replace(/<\/[A-Za-z][^>]*>/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
