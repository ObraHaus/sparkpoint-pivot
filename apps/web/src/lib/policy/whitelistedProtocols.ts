/**
 * whitelistedProtocols — pure derivation of the Trust Center "Whitelisted protocols"
 * card from the deterministic policy allowlist (the G5 closed set).
 *
 * JSX-free + framework-free with a TYPE-ONLY `@sparkpoint` import so it runs under the web
 * `node --experimental-strip-types --test` runner (which can't resolve extensionless
 * `@sparkpoint/…` ESM at runtime) — mirroring liveCaps.ts / vaultOptions.ts. The page owns the
 * runtime `@sparkpoint/shared` reads (`getPolicyConstants` + `resolveTargetRef`) and passes the
 * resolved data in, so this module stays pure and unit-testable.
 *
 * Fail-closed + no fabrication (Principle III): an allowlist entry whose `targetRef` does NOT
 * resolve to a concrete on-chain address on this chain is DROPPED — never displayed. Every
 * address shown is the real SoT join (policy allowlist → address book), so the card can never
 * drift from what the on-chain PolicyModule actually permits.
 */

import type { TargetRef } from "@sparkpoint/shared/policy";

/**
 * The minimal shape this module reads from a policy `AllowlistEntry`. Typed structurally (not as
 * the full `AllowlistEntry`) so the strip-types test runner can build fixtures with no
 * `@sparkpoint` runtime import — `readonly AllowlistEntry[]` is assignable to `readonly AllowlistRow[]`.
 */
export interface AllowlistRow {
  /** `Protocol` enum value, e.g. "aave_v3". */
  readonly protocol: string;
  readonly targetRef: TargetRef;
  /** `ActionType` enum value, e.g. "aave_supply". */
  readonly action: string;
}

/** One display row: a unique allowlisted (protocol, target) resolved to a concrete address. */
export interface WhitelistedProtocol {
  readonly protocol: string;
  readonly label: string;
  readonly targetRef: TargetRef;
  /** Concrete on-chain address (0x…) — the real allowlist → address-book join. */
  readonly address: string;
  /** Permitted `ActionType` values on this target, in allowlist order. */
  readonly actions: readonly string[];
}

/** Display names for the closed protocol set (policy-schema.md §2.1). Falls back to the raw value. */
const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: "Aave v3 Pool",
  aerodrome: "Aerodrome Router",
  sparkpoint_vault: "SparkPoint Vault",
};

/** Friendly protocol name; falls back to the raw enum value (never fabricates). */
export function protocolLabel(protocol: string): string {
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

/** Friendly verb for an `ActionType`; falls back to the raw value. */
export function actionLabel(action: string): string {
  const LABELS: Record<string, string> = {
    vault_deposit: "Deposit",
    vault_withdraw: "Withdraw",
    vault_redeem: "Redeem",
    aave_supply: "Supply",
    aave_withdraw: "Withdraw",
    aerodrome_swap: "Swap",
  };
  return LABELS[action] ?? action;
}

/**
 * Group the policy allowlist into one display row per resolved on-chain target, preserving
 * first-seen order and accumulating the permitted actions. `resolve` joins a `targetRef` to its
 * concrete address (the page passes `resolveTargetRef(chainId, ref)`); an entry whose target does
 * not resolve is DROPPED (fail-closed — no placeholder address).
 */
export function whitelistedProtocols(
  allowlist: readonly AllowlistRow[],
  resolve: (ref: TargetRef) => string | undefined,
): WhitelistedProtocol[] {
  const rows = new Map<TargetRef, { protocol: string; targetRef: TargetRef; address: string; actions: string[] }>();
  const order: TargetRef[] = [];
  for (const entry of allowlist) {
    const address = resolve(entry.targetRef);
    if (!address) continue; // fail-closed: an unresolved target is never displayed
    const found = rows.get(entry.targetRef);
    if (found) {
      found.actions.push(entry.action);
      continue;
    }
    order.push(entry.targetRef);
    rows.set(entry.targetRef, {
      protocol: entry.protocol,
      targetRef: entry.targetRef,
      address,
      actions: [entry.action],
    });
  }
  return order.map((ref) => {
    const r = rows.get(ref)!;
    return {
      protocol: r.protocol,
      label: protocolLabel(r.protocol),
      targetRef: r.targetRef,
      address: r.address,
      actions: r.actions,
    };
  });
}
