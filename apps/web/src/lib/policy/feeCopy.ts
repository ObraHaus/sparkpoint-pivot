/**
 * feeCopy — the canonical, verbatim fee-disclosure copy for the vault surfaces.
 *
 * Single source of truth for the performance-fee disclosure so the trust panel
 * (NonCustodyBadge), the deposit confirm gate (useVaultConfirm → ConfirmFlow), and
 * any future surface render the EXACT same words (agent-service-api.md §3.7
 * `POST /vault/quote/deposit` → `performanceFee.disclosure`; mirror of the agent's
 * `_DEPOSIT_DISCLOSURE`). Plain strings, NO React and NO `@/` deps — importable from
 * both components and `lib/` hooks without a lib→component dependency.
 *
 * ── 024 / T024 — WHY THIS IS NOW KEYED ON A FEE BASIS ──────────────────────────────
 * Constitution v3.0.0 ratified Morpho Vault V2 **Fee Wrappers**, and ratification carried an
 * explicit DISCLOSURE obligation, not merely a wording tweak. The two fee mechanics genuinely
 * differ, and the difference is adverse to the user, so it may never be papered over:
 *
 *   * `high_water_mark` — SparkPoint's OWN ERC-4626s (the Aave launch vault and the deployed
 *     `SparkPointMorphoVault`) keep a real `_highWaterMark` in storage. A depositor who dips and
 *     recovers pays NOTHING until back above their previous peak.
 *   * `per_period_gain` — a Morpho Vault V2 keeps **no high-water-mark state at all**
 *     (`interest = newTotalAssets.zeroFloorSub(_totalAssets)`, i.e. max(0, new − last)). The fee is
 *     charged on each positive increment since the last accrual, with no memory of a prior peak. So
 *     a gain FOLLOWING an earlier loss IS charged, even while the depositor is still under water.
 *
 * What both bases share, and what we may therefore still promise unconditionally: the fee is never
 * charged on principal, never charged in a flat or falling period, and is taken as share dilution
 * rather than by withholding assets.
 *
 * `PERFORMANCE_FEE_DISCLOSURE` is retained as a byte-identical alias of the `high_water_mark`
 * string so 015/FR-006 (verbatim parity with the agent's `_DEPOSIT_DISCLOSURE`) keeps holding and
 * day-one rendering is unchanged. No Fee Wrapper is deployed yet; this makes the honest wording
 * exist BEFORE one can take a deposit, which is what the ratified obligation requires.
 */

/**
 * How a vault's performance fee accrues — the discriminator every fee surface keys on.
 *
 * Derived from the vault KIND (see `vaultFeeBasis`), never guessed per call site: T024 exists
 * because a forgotten per-site flag is exactly how the retired-wrapper bypass reached production.
 */
export type VaultFeeBasis = "high_water_mark" | "per_period_gain";

/** Registry/address-book vault kinds, mirroring migration 0026's `vault_kind` enum. */
export type VaultKindForFees = "first_party" | "legacy_wrapper" | "fee_wrapper" | "external_4626";

/**
 * The fee basis implied by a vault kind.
 *
 * `first_party` + `legacy_wrapper` are SparkPoint's own Solidity and both hold a real
 * `_highWaterMark`. `fee_wrapper` is a Morpho Vault V2 — no HWM state anywhere in the contract.
 * `external_4626` is a passthrough we do not charge on; it carries no SparkPoint fee, but the
 * conservative (non-HWM) basis is returned so a caller that renders a fee anyway cannot
 * accidentally over-promise.
 */
export function vaultFeeBasis(kind: VaultKindForFees): VaultFeeBasis {
  return kind === "first_party" || kind === "legacy_wrapper" ? "high_water_mark" : "per_period_gain";
}

/** The canonical pre-deposit fee disclosure for a high-water-mark vault (§3.7, VERBATIM). */
const HWM_DEPOSIT_DISCLOSURE =
  "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your " +
  "principal. We only earn when you earn — never on your principal, never by taking custody.";

/**
 * The pre-deposit disclosure for a Morpho Vault V2 Fee Wrapper.
 *
 * Ratified wording (constitution v3.0.0 amendment, "The SECOND genuine weakening"). The
 * under-water clause is the whole point of the string — do not trim it for length.
 */
const PER_PERIOD_DEPOSIT_DISCLOSURE =
  "SparkPoint performance fee: 10% of yield, charged only when the vault gains value over a " +
  "period — never on your principal, and never while it is flat or falling. Note a gain " +
  "following an earlier loss is charged, even if you are still below your previous high. We " +
  "only earn when you earn — never by taking custody.";

/**
 * The canonical pre-deposit fee disclosure.
 *
 * @deprecated Prefer {@link performanceFeeDisclosure} so the copy follows the vault's real fee
 *   mechanics. Retained (and byte-identical) for the 015/FR-006 verbatim-parity assertion and for
 *   surfaces that are structurally launch-vault-only.
 */
export const PERFORMANCE_FEE_DISCLOSURE = HWM_DEPOSIT_DISCLOSURE;

/** The pre-deposit fee disclosure for `basis`, rendered VERBATIM. */
export function performanceFeeDisclosure(basis: VaultFeeBasis): string {
  return basis === "high_water_mark" ? HWM_DEPOSIT_DISCLOSURE : PER_PERIOD_DEPOSIT_DISCLOSURE;
}

/**
 * The short parenthetical shown beside a fee rate in a breakdown row
 * (e.g. "Performance fee · 10% of yield (over high-water mark)").
 */
export function feeBasisShortLabel(basis: VaultFeeBasis): string {
  return basis === "high_water_mark" ? "over high-water mark" : "on each period's gain";
}

/**
 * The one-sentence "what happens if I dip and recover" answer.
 *
 * This sentence is the single most load-bearing difference between the two bases: on a HWM vault
 * the honest answer is "nothing", and on a Vault V2 it is not. Never render one for the other.
 */
export function feeBasisRecoverySentence(basis: VaultFeeBasis): string {
  return basis === "high_water_mark"
    ? "If your balance dips and recovers, you pay nothing until you’re back above your previous high."
    : "If your balance dips and recovers, the recovery still counts as a gain for that period — so a " +
        "gain after a loss is charged even while you are below your previous high.";
}

/**
 * How the ≤20% performance-fee ceiling is ENFORCED for `basis` — an honesty requirement, not a
 * flourish.
 *
 * On SparkPoint's own vaults the cap is a bytecode constant (`_MAX_PERFORMANCE_FEE_BPS = 2000`): a
 * higher fee is unrepresentable, so "immutable — governance can never exceed it" is literally true.
 * A Morpho Vault V2's own ceilings are 50% / 5%, so on a Fee Wrapper the ≤20% guarantee is a
 * POLICY commitment held by the 2-of-3 Safe owner + a ≥3-day timelock + a public Trust Center read
 * — weaker, and ratified as such (amendment, "The one genuine weakening"). Claiming immutability
 * there would be false.
 */
export function feeCapEnforcementLabel(basis: VaultFeeBasis): string {
  return basis === "high_water_mark"
    ? "immutable — governance can never exceed it"
    : "policy cap — enforced by the 2-of-3 Safe owner and a ≥3-day timelock, observable on-chain";
}
