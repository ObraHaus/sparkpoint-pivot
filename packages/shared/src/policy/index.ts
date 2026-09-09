/**
 * Policy foundation barrel — the deterministic guardrail schema's single source
 * of truth (policy-schema.md). Re-exports the canonical enums/reason codes and
 * the versioned policy constants (caps, slippage, allowlist, session bounds,
 * governance bound, `getPolicyConstants`).
 *
 * Consumed by the on-chain deploy scripts, the off-chain policy layer, and the
 * client policy mirror. T098 fails CI on any drift between them.
 */
export * from "./enums";
export * from "./constants";
