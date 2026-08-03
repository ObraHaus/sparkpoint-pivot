/**
 * 037 — what to suggest next, once Sparky has answered.
 *
 * The chips under the composer are genuinely useful on an empty thread — they tell a new user what
 * this thing is for. But they never changed. After the first answer they still offered "What's in
 * my wallet?" to somebody who had just been told what was in their wallet, which is worse than
 * offering nothing: it says the assistant was not listening.
 *
 * The scripted demo paths already did this properly, chip by chip. A REAL turn never updated them
 * at all, so the feature existed and only the demo could see it.
 *
 * WHY THESE ARE DERIVED, NOT GENERATED. Asking a model for follow-ups costs a call, adds latency to
 * the moment the answer lands, and — the real problem — will cheerfully suggest things this product
 * cannot do. A suggestion that leads to "I can't help with that" is worse than silence, because the
 * user trusted the suggestion. Every line below is a question the assistant demonstrably answers
 * well: most of them are the deterministic routes 029 and 031 built precisely so these answers
 * could not drift.
 *
 * PURE and LEAF: no React, no imports.
 */

/** The projection this module needs from a finished turn. */
export interface TurnShape {
  /** What the user asked, verbatim. Used only to avoid suggesting it straight back. */
  readonly userMessage: string;
  /** Block types that arrived, in order (`text`, `tip`, `recommendation`, `citation`, …). */
  readonly blockTypes: readonly string[];
  /** `tip` topics that arrived, if any. */
  readonly tipTopics?: readonly string[];
  /** `tool_step` labels the agent streamed — which branch actually ran. */
  readonly stepLabels?: readonly string[];
}

/** How many to show. Enough to be useful, few enough to read without deciding. */
export const MAX_FOLLOW_UPS = 4;

/** The empty-thread chips: what this thing is for, for somebody who has never used it. */
export const STARTER_CHIPS = [
  "What's in my wallet?",
  "Find steady, lower-risk yield",
  "Put my idle USDC to work",
  "Swap ETH → USDC",
  "Bridge to Sui",
  "Is the Aave vault safe?",
  "Explain vault shares",
  "How do you keep my funds safe?",
] as const;

/**
 * Offered when the conversation leaves room, never at the cost of a relevant suggestion.
 *
 * The exit is the product's central promise, and it is ALREADY one tap away from every screen: the
 * left nav carries "Withdraw / Exit" permanently and the top banner carries "Exit anytime". So
 * reachability is not what these chips are for, and spending one of four contextual slots on it
 * after every single answer would cost relevance and buy nothing.
 *
 * It therefore takes the last slot only when fewer than four topical suggestions exist — which is
 * most turns — and never displaces one that is actually about the conversation.
 */
const EXIT = "How do I withdraw everything?";

/**
 * Follow-ups by tip topic — the assistant just explained a concept, so go one level deeper.
 *
 * Matched by SUBSTRING, not by exact key, and that is not laziness. The first version keyed off the
 * agent's internal Python constant names and silently matched almost nothing: the wire actually
 * carries `performance_fee` (not `what_is_a_performance_fee`) and `aave_vault_safety` (not
 * `vault_safety`), so every fee question fell through to the generic list while every test passed.
 * Only a live turn showed it.
 *
 * A substring rule survives the agent renaming a topic or adding a variant, and the fallback is
 * still a real question rather than nothing. The observed wire values are pinned by a test.
 */
const BY_TOPIC: readonly (readonly [RegExp, readonly string[]])[] = [
  [/fee/, ["When would I pay nothing?", "How does our fee compare?", "What's the high-water mark?"]],
  [/apy|yield|rate/, ["What's the vault paying now?", "Why is the alpha rate so low?", "Is that rate guaranteed?"]],
  [/safe|safety|risk/, ["What happens if you disappear?", "Can you move my funds?", "Show me the proof"]],
  [/custod/, ["Can you move my funds?", "Show me the proof", "What happens if you disappear?"]],
  [/slippage|swap/, ["What slippage do you use?", "Swap ETH → USDC"]],
  [/withdraw|exit/, ["Is there a fee to withdraw?", "How long does it take?", "Show my portfolio"]],
  [/vault|share/, ["Is the Aave vault safe?", "What's the vault paying now?", "Explain vault shares"]],
];

function forTopic(topic: string): readonly string[] {
  const key = (topic || "").toLowerCase();
  for (const [pattern, chips] of BY_TOPIC) if (pattern.test(key)) return chips;
  return [];
}

/** Follow-ups by what the agent was seen doing. */
const BY_STEP: Record<string, readonly string[]> = {
  "Reading your portfolio": ["Where's my risk concentrated?", "Put my idle USDC to work", "How am I doing overall?"],
  "Checking strategies against your guardrails": ["What's the risk?", "Vault vs direct supply?", "Explain net APY"],
  "Checking what shipped recently": ["What changed in the vault?", "What are you working on next?"],
  "Checking the knowledge base": ["How do you keep my funds safe?", "What's the vault paying now?"],
};

/** Follow-ups by block type — the coarsest signal, used when nothing more specific applies. */
const BY_BLOCK: Record<string, readonly string[]> = {
  recommendation: ["What's the risk?", "Vault vs direct supply?", "Why this one?"],
  portfolio_snapshot: ["Where's my risk concentrated?", "Put my idle USDC to work"],
  outcome: ["See all outcomes", "How am I doing overall?"],
  action: ["What exactly am I signing?", "What's the risk?"],
};

/** Shown when nothing specific fits — still real questions, never filler. */
const GENERIC = [
  "What's the vault paying now?",
  "How do you keep my funds safe?",
  "What shipped recently?",
] as const;

/** Loose match: the user just asked this, in whatever words. */
function alreadyAsked(candidate: string, userMessage: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const asked = norm(userMessage);
  const chip = norm(candidate);
  if (!asked || !chip) return false;
  if (asked.includes(chip) || chip.includes(asked)) return true;
  // Or shares most of its distinctive words — "what is a performance fee" vs "explain the
  // performance fee" are the same question and suggesting one after the other reads as deaf.
  const stop = new Set(["what", "is", "a", "the", "my", "do", "you", "how", "i", "of", "to", "s", "in", "me"]);
  const words = (s: string) => new Set(s.split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  const chipWords = words(chip);
  if (chipWords.size === 0) return false;
  const askedWords = words(asked);
  let shared = 0;
  for (const w of chipWords) if (askedWords.has(w)) shared += 1;
  return shared / chipWords.size >= 0.7;
}

/**
 * What to offer after this turn.
 *
 * Ordered most-specific first: what the assistant just explained, then what it was seen doing, then
 * what kind of answer it gave. The exit is appended last if there is room — never displacing a
 * suggestion that is actually about the conversation.
 */
export function followUps(turn: TurnShape): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (candidates: readonly string[]) => {
    for (const c of candidates) {
      if (out.length >= MAX_FOLLOW_UPS) return;
      if (seen.has(c)) continue;
      if (alreadyAsked(c, turn.userMessage)) continue;
      seen.add(c);
      out.push(c);
    }
  };

  for (const topic of turn.tipTopics ?? []) add(forTopic(topic));
  for (const label of turn.stepLabels ?? []) add(BY_STEP[label] ?? []);
  for (const type of turn.blockTypes) add(BY_BLOCK[type] ?? []);
  add(GENERIC);

  // One tap from the exit, always — but last, and only in the space left over.
  if (out.length < MAX_FOLLOW_UPS && !alreadyAsked(EXIT, turn.userMessage) && !seen.has(EXIT)) {
    out.push(EXIT);
  }
  return out;
}

/**
 * An errored turn gets no suggestions about the conversation — it did not have one.
 *
 * Offering "What's the risk?" under a failure reads as though nothing went wrong. The only useful
 * things here are trying again, or going somewhere that works.
 */
export const ERROR_FOLLOW_UPS = ["What's in my wallet?", "How do you keep my funds safe?"] as const;
