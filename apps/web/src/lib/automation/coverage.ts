/**
 * Pure client-side eligibility for a hands-off (session-key) move (US6, feature 022) — no React.
 *
 * Decides whether the "Let Sparky do it" CTA should be offered for a `ProposedAction` under the user's
 * LIVE grant, by mirroring the checks the on-chain `SessionScopeLib` will enforce: the (target,selector)
 * is in the grant's allowlist, the grant is active + unexpired, and — for an inflow — the amount is
 * within the per-tx cap and the remaining cumulative budget. This is a UX gate to avoid offering a move
 * that would revert; the on-chain PolicyModule is the real, authoritative enforcer (a compromised client
 * can't widen scope). Exits are NEVER cap-gated (N2), matching the agent + contract.
 */

import { toFunctionSelector } from "viem";

import type { ProposedAction } from "@sparkpoint/shared/schemas";
import type { SessionKeyGrant } from "./useSessionKey";

// Vault (target,selector) pairs computed from the canonical signatures — identical to `scope.ts` (both
// derive from the same signature string, so no drift). Kept local so this stays a leaf, node:test module.
const VAULT_DEPOSIT_SELECTOR = toFunctionSelector("deposit(uint256,address)"); // 0x6e553f65
const VAULT_REDEEM_SELECTOR = toFunctionSelector("redeem(uint256,address,address)"); // 0xba087652
const VAULT_WITHDRAW_SELECTOR = toFunctionSelector("withdraw(uint256,address,address)"); // 0xb460af94

// `ActionType` wire values (from @sparkpoint/shared/policy) — as string literals so this module has no
// runtime barrel dependency. These are the stable §2.2 wire strings the agent emits.
const VAULT_DEPOSIT = "vault_deposit";
const VAULT_REDEEM = "vault_redeem";
const VAULT_WITHDRAW = "vault_withdraw";

export interface CoverageResult {
  /** Offer the hands-off CTA. When false, `reason` explains why (fall back to per-action signing). */
  ok: boolean;
  reason?: string;
}

/** Exit action kinds — allowlisted but never cap-gated (N2), mirroring executionModel/`isExitKind`. */
const EXIT_TYPES: ReadonlySet<string> = new Set([VAULT_WITHDRAW, VAULT_REDEEM]);

/** The vault selector an action type maps to, or `null` for a type no session grant can cover. */
export function actionSelector(type: string): string | null {
  switch (type) {
    case VAULT_DEPOSIT:
      return VAULT_DEPOSIT_SELECTOR;
    case VAULT_REDEEM:
      return VAULT_REDEEM_SELECTOR;
    case VAULT_WITHDRAW:
      return VAULT_WITHDRAW_SELECTOR;
    default:
      return null;
  }
}

function toBigIntOr(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

/**
 * Whether `action` can execute under `grant` with no wallet signature. `nowMs` is passed in (pure — no
 * `Date.now()` in render). Fail-closed: a missing grant, a non-vault action, an off-allowlist selector,
 * an inactive/expired grant, or an over-cap inflow all return `{ ok: false, reason }`.
 */
export function isEligibleForAutoExec(
  action: ProposedAction,
  grant: SessionKeyGrant | null,
  nowMs: number,
): CoverageResult {
  if (!grant) return { ok: false, reason: "No automation is active." };
  if (grant.status !== "active") return { ok: false, reason: `Automation is ${grant.status}.` };

  const nowSec = Math.floor(nowMs / 1000);
  if (grant.validUntil > 0 && nowSec >= grant.validUntil) {
    return { ok: false, reason: "Automation has expired — re-authorize to continue." };
  }
  if (grant.validAfter > 0 && nowSec < grant.validAfter) {
    return { ok: false, reason: "Automation isn't active yet." };
  }

  const selector = actionSelector(action.type);
  if (!selector) return { ok: false, reason: "This action can't run under automation." };
  const inScope = grant.allowlist.some((e) => e.selector.toLowerCase() === selector.toLowerCase());
  if (!inScope) return { ok: false, reason: "This move isn't in your automation allowlist." };

  // Exits are allowlisted but never cap-gated (N2) — no notional accounting.
  if (EXIT_TYPES.has(action.type)) return { ok: true };

  // Inflow: the amount is the notional debited against the caps (mirrors SessionScopeLib).
  const amount = toBigIntOr(action.amount, -1n);
  if (amount < 0n) return { ok: false, reason: "Couldn't read the amount." };
  const perTx = toBigIntOr(grant.perTxCap, 0n);
  if (perTx > 0n && amount > perTx) {
    return { ok: false, reason: "Above your per-transaction automation cap." };
  }
  const cumulative = toBigIntOr(grant.cumulativeCap, 0n);
  const spent = toBigIntOr(grant.spent, 0n);
  if (cumulative > 0n && spent + amount > cumulative) {
    return { ok: false, reason: "Would exceed your remaining automation budget." };
  }
  return { ok: true };
}
