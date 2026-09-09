/**
 * Canonical policy enums + reason codes.
 *
 * SINGLE SOURCE OF TRUTH for the deterministic guardrail schema, mirrored 1:1 by
 * (a) the on-chain PolicyModule/SessionKeyValidator/vault deploy scripts,
 * (b) the off-chain deterministic policy layer, and
 * (c) the client policy mirror. T098 fails CI on any drift.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/contracts/policy-schema.md §2
 *   (§2.1 Protocol, §2.2 Asset, §2.3 ActionType, §2.4 Direction, §2.5 RiskProfile,
 *    §2.6 Reason codes). Values are the EXACT wire strings so they round-trip
 *    through the zod wire schemas and JSON without transformation.
 *
 * Style: TS string enums (named access + z.nativeEnum-compatible +
 *   Object.values-iterable for CI drift checks). One consistent style throughout.
 */

/** policy-schema.md §2.1 — closed protocol whitelist (G5). Anything else is unreachable. */
export enum Protocol {
  AaveV3 = "aave_v3",
  Aerodrome = "aerodrome",
  SparkPointVault = "sparkpoint_vault",
}

/**
 * policy-schema.md §2.2 — launch asset set.
 * `ETH` is the Aave path (native ETH via the WETH gateway, or WETH ERC-20 directly).
 * Vault deposit asset == USDC only.
 */
export enum Asset {
  USDC = "USDC",
  ETH = "ETH",
}

/**
 * policy-schema.md §2.3 — action taxonomy. Identical to agent-service-api.md §2.2
 * `ActionType`, so IntentBundle.kind and PolicyVerdict share this exact enum.
 */
export enum ActionType {
  VaultDeposit = "vault_deposit",
  VaultWithdraw = "vault_withdraw",
  VaultRedeem = "vault_redeem",
  AaveSupply = "aave_supply",
  AaveWithdraw = "aave_withdraw",
  AerodromeSwap = "aerodrome_swap",
  SessionKeyGrant = "session_key_grant",
  SessionKeyRevoke = "session_key_revoke",
}

/**
 * policy-schema.md §2.4 — the direction taxonomy that drives cap/pause gating.
 *
 *  - `Inflow`  : deposit / supply / grant  — cap- AND pause-gated.
 *  - `Outflow` : swap-out (aerodrome_swap) — cap- AND pause-gated, slippage-bounded.
 *  - `Exit`    : vault_withdraw / vault_redeem / aave_withdraw / session_key_revoke
 *                — NEVER cap- or pause-gated (N2, withdraw-is-sacred).
 *
 * NOTE: the three-value taxonomy is load-bearing. The evaluate() step machine
 * (§8) and the caps table (§4) both branch on `direction === Exit`; collapsing
 * this to a binary enter|exit would wrongly conflate a cap/pause-gated swap
 * (Outflow) with an ungated withdraw (Exit) and break N2.
 */
export enum Direction {
  Inflow = "inflow",
  Outflow = "outflow",
  Exit = "exit",
}

/**
 * policy-schema.md §2.5 — risk profile. Launch is conservative-only; the other
 * tiers are reserved for forward-compat (multi-strategy). The on-chain allowlist
 * already precludes non-conservative actions at launch.
 *
 * NOTE: data-model.md §5 `mandates.risk_tier` uses `moderate` where this policy
 * enum uses `balanced`; policy-schema.md §2.5 is authoritative for the policy
 * foundation, so the middle tier is `balanced` here.
 */
export enum RiskProfile {
  Conservative = "conservative",
  Balanced = "balanced",
  Growth = "growth",
}

/**
 * policy-schema.md §2.6 — the structured reason codes returned in `reasons[]`.
 * `OK` is the sole success code; every other value is a fail-closed rejection.
 * Mirrors the canonical error codes in agent-service-api.md §1.6.
 */
export enum ReasonCode {
  Ok = "OK",
  SchemaInvalid = "SCHEMA_INVALID",
  ProtocolNotAllowlisted = "PROTOCOL_NOT_ALLOWLISTED",
  SelectorNotAllowlisted = "SELECTOR_NOT_ALLOWLISTED",
  AssetNotAllowlisted = "ASSET_NOT_ALLOWLISTED",
  RecipientNotUser = "RECIPIENT_NOT_USER",
  CapPerUserExceeded = "CAP_PER_USER_EXCEEDED",
  CapTotalExceeded = "CAP_TOTAL_EXCEEDED",
  CapVaultExceeded = "CAP_VAULT_EXCEEDED",
  CapPerTxExceeded = "CAP_PER_TX_EXCEEDED",
  CapCumulativeExceeded = "CAP_CUMULATIVE_EXCEEDED",
  MandateRiskExceeded = "MANDATE_RISK_EXCEEDED",
  SlippageExceeded = "SLIPPAGE_EXCEEDED",
  MinOutBelowFloor = "MIN_OUT_BELOW_FLOOR",
  SimRevert = "SIM_REVERT",
  SimUnavailable = "SIM_UNAVAILABLE",
  DataStale = "DATA_STALE",
  KillSwitchPaused = "KILL_SWITCH_PAUSED",
  SessionExpired = "SESSION_EXPIRED",
  SessionRevoked = "SESSION_REVOKED",
}

/* ────────────────────────────────────────────────────────────────────────────
 * Value tuples — explicit, non-empty tuples for `z.enum([...])`, exhaustive
 * iteration, and CI drift assertions. Kept in the same declaration order as the
 * enums above so a reviewer can eyeball parity with policy-schema.md §2.
 * ──────────────────────────────────────────────────────────────────────────── */

export const PROTOCOL_VALUES = [
  Protocol.AaveV3,
  Protocol.Aerodrome,
  Protocol.SparkPointVault,
] as const;

export const ASSET_VALUES = [Asset.USDC, Asset.ETH] as const;

export const ACTION_TYPE_VALUES = [
  ActionType.VaultDeposit,
  ActionType.VaultWithdraw,
  ActionType.VaultRedeem,
  ActionType.AaveSupply,
  ActionType.AaveWithdraw,
  ActionType.AerodromeSwap,
  ActionType.SessionKeyGrant,
  ActionType.SessionKeyRevoke,
] as const;

export const DIRECTION_VALUES = [
  Direction.Inflow,
  Direction.Outflow,
  Direction.Exit,
] as const;

export const RISK_PROFILE_VALUES = [
  RiskProfile.Conservative,
  RiskProfile.Balanced,
  RiskProfile.Growth,
] as const;

export const REASON_CODE_VALUES = [
  ReasonCode.Ok,
  ReasonCode.SchemaInvalid,
  ReasonCode.ProtocolNotAllowlisted,
  ReasonCode.SelectorNotAllowlisted,
  ReasonCode.AssetNotAllowlisted,
  ReasonCode.RecipientNotUser,
  ReasonCode.CapPerUserExceeded,
  ReasonCode.CapTotalExceeded,
  ReasonCode.CapVaultExceeded,
  ReasonCode.CapPerTxExceeded,
  ReasonCode.CapCumulativeExceeded,
  ReasonCode.MandateRiskExceeded,
  ReasonCode.SlippageExceeded,
  ReasonCode.MinOutBelowFloor,
  ReasonCode.SimRevert,
  ReasonCode.SimUnavailable,
  ReasonCode.DataStale,
  ReasonCode.KillSwitchPaused,
  ReasonCode.SessionExpired,
  ReasonCode.SessionRevoked,
] as const;
