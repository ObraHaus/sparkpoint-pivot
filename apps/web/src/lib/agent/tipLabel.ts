/**
 * tipLabel — turning an internal topic identifier into a heading a person can read.
 *
 * WHY THIS EXISTS (029). The agent keys a literacy card by a snake_case topic (`what_is_apy`,
 * `vault_safety`, `what_are_vault_shares`). That identifier is a routing key, not copy — but the
 * chat rendered it verbatim as the card's heading, so the Aug-3 battery has screenshots of
 * `vault_safety` sitting above an otherwise well-written explanation. It reads like a leaked
 * database column, and it is the kind of detail that makes a tester distrust everything else on
 * the screen.
 *
 * The identifier itself stays on the wire (analytics and the agent's own tests key on it); only
 * the DISPLAY is derived, here, where it can be unit-tested without a browser.
 *
 * Leaf module: no imports, no React — `node --test` loads it directly.
 */

/**
 * Headings for the topics the agent routes to today. Hand-written because "what_is_apy" should
 * read "What is APY?" — with the acronym cased correctly — and no general algorithm gets that
 * right. Anything unlisted is humanised by {@link humanise} rather than shown raw.
 */
const KNOWN: Readonly<Record<string, string>> = {
  what_is_apy: "What is APY?",
  what_is_a_vault: "What is a vault?",
  what_are_vault_shares: "What are vault shares?",
  what_is_slippage: "What is slippage?",
  what_is_a_performance_fee: "What is a performance fee?",
  what_is_non_custodial: "What does non-custodial mean?",
  vault_safety: "Vault safety",
  vault_apy: "Vault yield",
  general: "Good to know",
};

/** Words that must not be title-cased into "Apy" / "Usdc" / "Defi" when we fall back. */
const ACRONYMS = new Set(["apy", "apr", "usdc", "eth", "srk", "defi", "erc", "erc4626", "ai"]);

function humanise(topic: string): string {
  const words = topic
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  if (words.length === 0) return "Good to know";
  const [first, ...rest] = words;
  const head = ACRONYMS.has(first.toLowerCase()) ? first : first[0].toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/**
 * The heading to show for a literacy card's topic.
 *
 * Never returns the raw identifier: an unknown topic is humanised, and an empty or missing one
 * gets a neutral heading rather than an empty bar.
 */
export function tipLabel(topic: string | null | undefined): string {
  const key = (topic ?? "").trim();
  if (!key) return "Good to know";
  return KNOWN[key] ?? humanise(key);
}
