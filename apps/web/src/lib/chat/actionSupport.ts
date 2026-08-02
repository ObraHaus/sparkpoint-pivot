/**
 * Which assistant-proposed action types the chat can actually drive to a real, user-signed
 * execution path — and the honest notice for every type it can't.
 *
 * WHY THIS MODULE EXISTS (025). The chat's intent mapper used to answer `{ kind: "premium" }` for
 * any action type it had no inline path for. That kind renders ConfirmFlow's **"Confirm: Premium
 * subscription"** card, so clicking "Review this move" on an `aave_supply` recommendation told the
 * user the move was behind a paid tier. It never was: there is no paywall on any proposed action.
 * A placeholder that invents a commercial reason for a purely technical gap is worse than no
 * answer at all, so the fallback now says the true thing — Sparky proposed it, the app can't
 * execute it yet, and nothing is signable here.
 *
 * Kept free of React/CSS/`@/`-value imports so it is unit-testable under the strip-types runner
 * (the one import is type-only and therefore erased).
 *
 * NON-CUSTODY: nothing here is signable. This module only decides which honest surface a proposal
 * gets; the sign gate stays `cards.isSignable` (policy `approved`) and is untouched.
 */

import type { ProposedAction } from "@sparkpoint/shared/schemas";

/** The §2.2 action-type STRINGS. `ProposedAction["type"]` is a TS string enum, so it is widened
 * through a template-literal type to its literal union — that keeps the compile-time check without
 * a VALUE import of the enum, which would make this module non-leaf and untestable. */
type ActionTypeValue = `${ProposedAction["type"]}`;

/** Every action type the chat's inline path can carry to a REAL execution surface.
 *
 * Typed against the wire enum, so a typo or a retired action type is a compile error rather than a
 * silent fall-through to the notice. Mirrors the `switch` in `live-blocks.inlineIntentFor` —
 * vault deposit/withdraw/redeem (the ExecutionDrawer / vault gate) and `aerodrome_swap` (the
 * web's own user-signed Uniswap path). Everything else in the §2.2 taxonomy — `aave_supply`,
 * `aave_withdraw`, `session_key_grant`, `session_key_revoke` — has no in-app execution path. */
export const INLINE_EXECUTABLE_ACTION_TYPES: readonly ActionTypeValue[] = [
  "vault_deposit",
  "vault_withdraw",
  "vault_redeem",
  "aerodrome_swap",
];

/** The chat intent for a proposal the app cannot execute — an inert, non-signable notice. */
export interface UnsupportedActionIntent {
  readonly kind: "unsupported";
  /** The raw wire action type, so the notice can name what was proposed instead of generalizing. */
  readonly actionType: string;
}

/** `true` iff the chat has a real, user-signed execution path for this action type. */
export function isInlineExecutable(actionType: string): boolean {
  return (INLINE_EXECUTABLE_ACTION_TYPES as readonly string[]).includes(actionType);
}

/** Build the inert intent. The ONLY fallback — it must never resolve to a paid/premium surface. */
export function unsupportedIntent(actionType: string): UnsupportedActionIntent {
  return { kind: "unsupported", actionType };
}

/** Human labels for the types that actually reach the notice. Unknown types are humanized. */
const ACTION_LABELS: Record<string, string> = {
  aave_supply: "Supplying directly to Aave",
  aave_withdraw: "Withdrawing directly from Aave",
  session_key_grant: "Granting a session key",
  session_key_revoke: "Revoking a session key",
};

/** `"aave_supply"` → `"Aave supply"`. Never returns an empty string. */
function humanize(actionType: string): string {
  const words = actionType.replace(/[_-]+/g, " ").trim();
  if (!words) return "This action";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function unsupportedActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? humanize(actionType);
}

/** Card title. States the gap plainly; makes no claim about tiers, plans, or payment. */
export function unsupportedActionTitle(actionType: string): string {
  return `${unsupportedActionLabel(actionType)} isn’t available in the app yet`;
}

/**
 * Card body. Says what Sparky did (proposed), what the app can't do (execute this type), and what
 * that means for the user's money (nothing moved, nothing will). No mention of premium, plans,
 * tiers, upgrades, or payment — the gap is technical, and implying otherwise is the bug.
 */
export function unsupportedActionBody(actionType: string): string {
  return (
    `Sparky can suggest this, but SparkPoint can’t execute ${
      ACTION_LABELS[actionType] ? "it" : "this action type"
    } in the app yet — there’s nothing to sign here. Nothing has moved, and your funds stay in ` +
    `your wallet. You can still act on it yourself, wherever you normally would.`
  );
}
