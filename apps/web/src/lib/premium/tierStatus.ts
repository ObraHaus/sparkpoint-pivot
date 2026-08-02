/**
 * tierStatus — pure mapping from the self-scoped `/usage/self` read to what the Premium
 * surfaces should SAY about the wallet's plan.
 *
 * WHY THIS EXISTS: the /premium plan cards hardcoded "Your current plan" onto the FREE card,
 * and /premium/pay's only model was balance-vs-price — so a wallet that had just PAID for
 * Premium was still told "You need N more SRK for the first month" (the client hit this with
 * the first real purchase). The tier truth was already served (`/usage/self` → tier/expiresAt);
 * these helpers make both pages consume it honestly.
 *
 * Leaf module (no `@/` value imports, no React) so the strip-types runner can test it.
 * Fail-open discipline: anything unknown/malformed reads as NOT premium, which renders the
 * pre-existing UI exactly — a failed tier read can never hide the upgrade path or invent an
 * active subscription.
 */

export interface PremiumStatus {
  /** True only on a positive, verified "premium" read. */
  readonly active: boolean;
  /** Human expiry ("Sep 2, 2026") when active and the wire date parses; null otherwise. */
  readonly untilLabel: string | null;
}

/** Map the `/usage/self` fields to a display status. Defensive on every field. */
export function premiumStatusView(
  tier: string | null | undefined,
  expiresAt: string | null | undefined,
): PremiumStatus {
  if (tier !== "premium") return { active: false, untilLabel: null };
  let untilLabel: string | null = null;
  if (typeof expiresAt === "string" && expiresAt) {
    const at = new Date(expiresAt);
    if (!Number.isNaN(at.getTime())) {
      untilLabel = at.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return { active: true, untilLabel };
}

/**
 * The low-balance banner's framing. An active subscriber short of SRK is short for an
 * EXTENSION — telling them they can't afford "the first month" reads as "you aren't premium",
 * which is exactly the confusion this module exists to kill.
 */
export function shortfallPurpose(status: PremiumStatus): string {
  return status.active ? "to extend Premium by a month" : "for the first month";
}
