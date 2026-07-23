/**
 * feeCopy — the canonical, verbatim fee-disclosure copy for the vault surfaces.
 *
 * Single source of truth for the performance-fee disclosure so the trust panel
 * (NonCustodyBadge), the deposit confirm gate (useVaultConfirm → ConfirmFlow), and
 * any future surface render the EXACT same words (agent-service-api.md §3.7
 * `POST /vault/quote/deposit` → `performanceFee.disclosure`; mirror of the agent's
 * `_DEPOSIT_DISCLOSURE`). Plain strings, NO React and NO `@/` deps — importable from
 * both components and `lib/` hooks without a lib→component dependency.
 */

/** The canonical pre-deposit fee disclosure — rendered VERBATIM (agent-service-api.md §3.7). */
export const PERFORMANCE_FEE_DISCLOSURE =
  "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your " +
  "principal. We only earn when you earn — never on your principal, never by taking custody.";
