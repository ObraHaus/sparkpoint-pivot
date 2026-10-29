/**
 * 061 A9 — whether Strategies has anything to show, as a pure rule.
 *
 * The nav must never hide a reachable page on a guess (N2), so this hides ONLY on a positive
 * empty result: a saved plan that ranked zero strategies. Unknown states (no wallet, a pending
 * mandate, a failed read) keep the entry visible and let the page explain itself.
 */

export type MandateStatus = "disconnected" | "loading" | "error" | "empty" | "ready";

export function strategiesNavVisible(input: {
  mandateStatus: MandateStatus;
  recommendations: readonly unknown[] | null;
}): boolean {
  if (input.mandateStatus === "empty") return false;
  if (input.recommendations === null) return true;
  return input.recommendations.length > 0;
}
