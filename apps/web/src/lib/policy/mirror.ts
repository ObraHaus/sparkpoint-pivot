/**
 * Client-side policy mirror — DISPLAY-ONLY (T028).
 *
 * Turns the versioned policy foundation (`@sparkpoint/shared/policy`) + the
 * per-chain address book (`@sparkpoint/shared/addresses`) into pure, framework-
 * agnostic labels for UI surfaces: the Trust Center, the caps meter, and the
 * confirm-gate. It formats the five caps, the slippage bounds, and the resolved
 * `(protocol, target, selector)` allowlist for humans.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ THIS NEVER GATES SIGNING.                                                    │
 * │ The on-chain SparkPoint PolicyModule and the ERC-4626 vault are the SOLE     │
 * │ source of truth; they re-check every action at sign time on-chain. This      │
 * │ module only LABELS — it holds no key, blocks nothing, and must NEVER be put  │
 * │ on the withdraw/exit path (N2, withdraw-is-sacred). See                      │
 * │ {@link POLICY_MIRROR_DISCLAIMER}.                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T028; policy-schema.md §3
 * (allowlist), §4 (caps), §5 (slippage); the `@sparkpoint/shared` SoT that T098
 * keeps drift-free. Pure TS — no React, no side effects.
 */

import {
  getPolicyConstants,
  Protocol,
  ActionType,
  Direction,
  type PolicyConstants,
  type PolicyCaps,
  type TokenAmount,
  type SlippageConfig,
  type AllowlistEntry,
  type Selector,
} from "@sparkpoint/shared/policy";
import { resolveTargetRef, type Address } from "@sparkpoint/shared/addresses";

/**
 * The single, prominent statement of this module's contract. Surface it verbatim
 * anywhere the mirror's numbers are shown so users know the chain — not the
 * client — enforces policy.
 */
export const POLICY_MIRROR_DISCLAIMER =
  "Display-only mirror of the on-chain policy. The SparkPoint PolicyModule and " +
  "the ERC-4626 vault are the sole source of truth and re-check every action at " +
  "sign time on-chain. Nothing here gates signing, and it never blocks the " +
  "withdraw/exit path.";

/* ────────────────────────────────────────────────────────────────────────────
 * Primitive formatters (exact — bigint base units, never floats).
 * ──────────────────────────────────────────────────────────────────────────── */

// bigint constants via `BigInt(...)` (not `123n` literals) — apps/web targets
// ES2017, under which bigint literal syntax is a type error (TS2737). The math is
// still exact bigint arithmetic.
const ZERO = BigInt(0);
const TEN = BigInt(10);
/** 10_000 bps = 100% — the fixed-point scale for the caps-meter percentage. */
const BPS_SCALE = BigInt(10_000);

/** Grouped decimal string for `amount` raw base units at `decimals` dp (e.g. 5_000_000_000 base units, 6 dp → "5,000"). */
function formatBaseUnits(amount: bigint, decimals: number): string {
  const negative = amount < ZERO;
  const abs = negative ? -amount : amount;
  const base = TEN ** BigInt(decimals);
  const whole = new Intl.NumberFormat("en-US").format(abs / base);
  const fracRaw = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fracRaw.length > 0 ? `${whole}.${fracRaw}` : whole;
  return negative ? `-${body}` : body;
}

/** A `TokenAmount` labelled for display, plus its immutable ceiling when one exists (§4). */
export interface FormattedAmount {
  /** Wire asset symbol, e.g. "USDC". */
  readonly asset: string;
  /** Grouped value without the symbol, e.g. "5,000". */
  readonly amount: string;
  /** Grouped value with the symbol, e.g. "5,000 USDC". */
  readonly display: string;
  /** Exact raw base units (for meter math — never re-derive from `amount`). */
  readonly raw: bigint;
  readonly decimals: number;
  /** The hard ceiling this cap may be raised UP TO (policy-schema.md §4), if defined. */
  readonly ceiling?: { readonly amount: string; readonly display: string; readonly raw: bigint };
}

/** Format one policy `TokenAmount` (and its optional ceiling) for display. */
export function formatTokenAmount(t: TokenAmount): FormattedAmount {
  const amount = formatBaseUnits(t.amount, t.decimals);
  const base: FormattedAmount = {
    asset: t.asset,
    amount,
    display: `${amount} ${t.asset}`,
    raw: t.amount,
    decimals: t.decimals,
  };
  if (t.ceiling === undefined) return base;
  const ceilingAmount = formatBaseUnits(t.ceiling, t.decimals);
  return {
    ...base,
    ceiling: { amount: ceilingAmount, display: `${ceilingAmount} ${t.asset}`, raw: t.ceiling },
  };
}

/** Basis points → percent string, e.g. 50 → "0.50%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Human label maps (exhaustive over the SoT enums — a new enum member forces a
 * TS error here, so the UI copy can never silently miss an action/protocol).
 * ──────────────────────────────────────────────────────────────────────────── */

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  [Protocol.AaveV3]: "Aave v3",
  [Protocol.Aerodrome]: "Aerodrome",
  [Protocol.SparkPointVault]: "SparkPoint Vault",
};

export const ACTION_LABEL: Record<ActionType, string> = {
  [ActionType.VaultDeposit]: "Vault deposit",
  [ActionType.VaultWithdraw]: "Vault withdraw",
  [ActionType.VaultRedeem]: "Vault redeem",
  [ActionType.AaveSupply]: "Aave supply",
  [ActionType.AaveWithdraw]: "Aave withdraw",
  [ActionType.AerodromeSwap]: "Aerodrome swap",
  [ActionType.SessionKeyGrant]: "Grant session key",
  [ActionType.SessionKeyRevoke]: "Revoke session key",
};

export const DIRECTION_LABEL: Record<Direction, string> = {
  [Direction.Inflow]: "Deposit / inflow",
  [Direction.Outflow]: "Swap / outflow",
  [Direction.Exit]: "Withdraw / exit",
};

/**
 * Human gating summary for the confirm-gate. Exits are NEVER cap- or pause-gated
 * (N2) — the copy makes that explicit so the withdraw path reads as unblockable.
 */
export function gatingLabel(entry: AllowlistEntry): string {
  if (entry.direction === Direction.Exit) return "Exit — never cap- or pause-gated (N2)";
  const parts: string[] = [];
  if (entry.capGated) parts.push("Cap-gated");
  if (entry.pauseGated) parts.push("Pause-gated");
  if (entry.slippageBound === true) parts.push("Slippage-bounded");
  return parts.length > 0 ? parts.join(" · ") : "Ungated";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Caps (Trust Center + caps meter).
 * ──────────────────────────────────────────────────────────────────────────── */

const CAP_META: Record<keyof PolicyCaps, { readonly label: string; readonly description: string }> = {
  perUserTvl: { label: "Per-user cap", description: "Maximum vault balance a single user may hold." },
  totalProtocol: { label: "Total protocol cap", description: "Aggregate cap across all users." },
  vaultDeposit: { label: "Vault deposit cap", description: "Maximum total assets the vault accepts." },
  sessionPerTx: { label: "Per-transaction cap", description: "Maximum notional for one session-key transaction." },
  sessionCumulative: { label: "Session lifetime cap", description: "Cumulative spend ceiling for a session key." },
};

/** One cap, labelled for the Trust Center. */
export interface LabeledCap {
  readonly key: keyof PolicyCaps;
  readonly label: string;
  readonly description: string;
  readonly value: FormattedAmount;
}

/** All five policy caps for `chainId`, labelled for display. */
export function describeCaps(chainId: number): LabeledCap[] {
  const { caps } = getPolicyConstants(chainId);
  return (Object.keys(CAP_META) as (keyof PolicyCaps)[]).map((key) => ({
    key,
    label: CAP_META[key].label,
    description: CAP_META[key].description,
    value: formatTokenAmount(caps[key]),
  }));
}

/**
 * DISPLAY-ONLY caps-meter math for a UI progress bar. Given the current position
 * `usedRaw` (raw base units, read independently from chain) and a policy cap,
 * returns the utilisation for the meter fill. It computes a ratio — it does NOT
 * decide whether an action is allowed (the chain does that).
 */
export interface CapMeter {
  readonly usedRaw: bigint;
  readonly capRaw: bigint;
  /** `max(cap - used, 0)`. */
  readonly remainingRaw: bigint;
  /** Meter fill percentage, clamped to 0..100. */
  readonly pct: number;
  /** `used > cap` — a display flag only; never an enforcement signal. */
  readonly overCap: boolean;
  readonly used: string;
  readonly cap: string;
  readonly remaining: string;
}

/** Compute display-only utilisation of `cap` by `usedRaw`. Never gates anything. */
export function capUtilization(usedRaw: bigint, cap: TokenAmount): CapMeter {
  const capRaw = cap.amount;
  const used = usedRaw < ZERO ? ZERO : usedRaw;
  const overCap = used > capRaw;
  const remainingRaw = overCap ? ZERO : capRaw - used;
  let pct = 0;
  if (capRaw > ZERO) {
    pct = Number((used * BPS_SCALE) / capRaw) / 100;
    if (pct > 100) pct = 100;
  }
  const suffix = ` ${cap.asset}`;
  return {
    usedRaw: used,
    capRaw,
    remainingRaw,
    pct,
    overCap,
    used: formatBaseUnits(used, cap.decimals) + suffix,
    cap: formatBaseUnits(capRaw, cap.decimals) + suffix,
    remaining: formatBaseUnits(remainingRaw, cap.decimals) + suffix,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Slippage (Trust Center + swap confirm-gate).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Slippage bounds for `chainId`, labelled for display. Swaps only (§5). */
export interface SlippageLabels {
  readonly userMax: string;
  readonly protocolFloor: string;
  readonly absoluteCeiling: string;
  readonly userMaxBps: number;
  readonly protocolFloorBps: number;
  readonly absoluteCeilingBps: number;
  /** Actions slippage applies to (aerodrome_swap only). */
  readonly appliesTo: readonly ActionType[];
  readonly summary: string;
}

export function describeSlippage(chainId: number): SlippageLabels {
  const s: SlippageConfig = getPolicyConstants(chainId).slippage;
  return {
    userMax: formatBps(s.userMaxBps),
    protocolFloor: formatBps(s.protocolFloorBps),
    absoluteCeiling: formatBps(s.absoluteCeilingBps),
    userMaxBps: s.userMaxBps,
    protocolFloorBps: s.protocolFloorBps,
    absoluteCeilingBps: s.absoluteCeilingBps,
    appliesTo: s.appliesTo,
    summary: `Swaps capped at ${formatBps(s.userMaxBps)} slippage (protocol floor ${formatBps(
      s.protocolFloorBps,
    )}, absolute ceiling ${formatBps(s.absoluteCeilingBps)}).`,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Allowlist (Trust Center).
 * ──────────────────────────────────────────────────────────────────────────── */

/** One resolved allowlist entry, labelled for display. */
export interface AllowlistRow {
  readonly protocol: Protocol;
  readonly protocolLabel: string;
  readonly action: ActionType;
  readonly actionLabel: string;
  readonly direction: Direction;
  readonly directionLabel: string;
  /**
   * Concrete on-chain target resolved from the symbolic `TargetRef` via the
   * address book. `undefined` ⇒ not deployed / not yet known on this chain
   * (fail-closed: an unresolvable target forms no `(target, selector)` pair).
   */
  readonly target?: Address;
  readonly targetResolved: boolean;
  readonly selector: Selector;
  readonly assets: readonly string[];
  readonly gatingLabel: string;
  readonly capGated: boolean;
  readonly pauseGated: boolean;
  readonly slippageBounded: boolean;
}

/**
 * The resolved `(protocol, target, selector)` allowlist for `chainId`. Mirrors
 * exactly what the on-chain PolicyModule permits (undeployed entries are already
 * filtered out by `getPolicyConstants`). For display in the Trust Center only.
 */
export function describeAllowlist(chainId: number): AllowlistRow[] {
  const { allowlist } = getPolicyConstants(chainId);
  return allowlist.map((e) => {
    const target = resolveTargetRef(chainId, e.targetRef);
    return {
      protocol: e.protocol,
      protocolLabel: PROTOCOL_LABEL[e.protocol],
      action: e.action,
      actionLabel: ACTION_LABEL[e.action],
      direction: e.direction,
      directionLabel: DIRECTION_LABEL[e.direction],
      target,
      targetResolved: target !== undefined,
      selector: e.selector,
      assets: e.assets.map((a): string => a),
      gatingLabel: gatingLabel(e),
      capGated: e.capGated,
      pauseGated: e.pauseGated,
      slippageBounded: e.slippageBound === true,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Aggregate (one call for the Trust Center).
 * ──────────────────────────────────────────────────────────────────────────── */

/** The complete display-only policy mirror for one chain. */
export interface PolicyMirror {
  /** {@link POLICY_MIRROR_DISCLAIMER} — surface verbatim. */
  readonly disclaimer: string;
  readonly policyVersion: string;
  readonly chainId: number;
  readonly caps: LabeledCap[];
  readonly slippage: SlippageLabels;
  readonly allowlist: AllowlistRow[];
}

/**
 * Everything the Trust Center needs to render the policy, labelled and resolved.
 * DISPLAY-ONLY: the returned numbers describe what the chain enforces; they do
 * not themselves enforce anything.
 *
 * @throws if `chainId` is unsupported (via `getPolicyConstants` — fail-closed).
 */
export function describePolicy(chainId: number): PolicyMirror {
  const constants: PolicyConstants = getPolicyConstants(chainId);
  return {
    disclaimer: POLICY_MIRROR_DISCLAIMER,
    policyVersion: constants.policyVersion,
    chainId: constants.chainId,
    caps: describeCaps(chainId),
    slippage: describeSlippage(chainId),
    allowlist: describeAllowlist(chainId),
  };
}
