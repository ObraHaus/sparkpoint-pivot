/**
 * Pure helpers for the US6 session-key scope + caps — no React, no wallet (mirrors executionModel.ts).
 *
 * The load-bearing pieces: the ERC-4626 `(target, selector)` allowlist the "Aave vault only" toggle
 * grants (derived from the canonical signatures, not hand-typed hex), the USDC base-unit ⇄ display
 * parsers for the cap inputs, and a human label for an allowlist entry / countdown so the automation
 * card and the grant form speak one vocabulary.
 */

import { toFunctionSelector } from "viem";
import type { SessionKeyAllowlistEntry } from "./useSessionKey";

/** ERC-4626 vault selectors the rebalance scope covers — computed from the canonical signatures. */
export const VAULT_DEPOSIT_SELECTOR = toFunctionSelector("deposit(uint256,address)"); // 0x6e553f65
export const VAULT_REDEEM_SELECTOR = toFunctionSelector("redeem(uint256,address,address)"); // 0xba087652
export const VAULT_WITHDRAW_SELECTOR = toFunctionSelector("withdraw(uint256,address,address)"); // 0xb460af94

/** selector → short human label (lower-cased hex keys). Unknown selectors fall back to the raw hex. */
const SELECTOR_LABELS: Record<string, string> = {
  [VAULT_DEPOSIT_SELECTOR.toLowerCase()]: "Deposit",
  [VAULT_REDEEM_SELECTOR.toLowerCase()]: "Withdraw",
  [VAULT_WITHDRAW_SELECTOR.toLowerCase()]: "Withdraw",
};

/** A human label for one `(target, selector)` pair — the selector's verb, `vault` recognized by name. */
export function selectorLabel(selector: string): string {
  return SELECTOR_LABELS[selector.toLowerCase()] ?? selector;
}

/**
 * The allowlist for "auto-rebalance within the Aave vault only": deposit + redeem on the one vault.
 * Returns `[]` when the vault address is unknown (fail-closed — the build then honestly refuses).
 */
export function vaultAllowlist(vault: string | undefined): SessionKeyAllowlistEntry[] {
  if (!vault) return [];
  return [
    { target: vault, selector: VAULT_DEPOSIT_SELECTOR },
    { target: vault, selector: VAULT_REDEEM_SELECTOR },
  ];
}

/* ── USDC (6dp) base-unit ⇄ display ─────────────────────────────────────────── */

const USDC_DECIMALS = 6;

/**
 * Parse a user-typed USDC amount ("$5,000", "5000", "5,000.50") into 6dp base units ("5000000000").
 * Returns `null` for a non-positive or unparseable value — integer math only (no float drift).
 */
export function usdcToBaseUnits(input: string): string | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const [whole = "0", frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const base = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(base) || BigInt(base) <= 0n) return null;
  return base;
}

/** Format 6dp USDC base units ("5000000000") as a rounded dollar display ("$5,000"). `…` if absent. */
export function formatUsdcBaseUnits(base: string | undefined): string {
  if (base === undefined || base === "") return "…";
  let n: bigint;
  try {
    n = BigInt(base);
  } catch {
    return "…";
  }
  const dollars = Number(n) / 10 ** USDC_DECIMALS;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: dollars < 100 ? 2 : 0 })}`;
}

/* ── slippage (percent ⇄ bps) ───────────────────────────────────────────────── */

/** Parse a user-typed slippage ("0.5%", "0.5") into basis points (50). `null` if out of [0, 10000]. */
export function percentToBps(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const pct = Number(cleaned);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const bps = Math.round(pct * 100);
  return bps > 10_000 ? null : bps;
}

/** Format basis points (50) as a percent display ("0.5%"). */
export function bpsToPercent(bps: number | undefined): string {
  if (bps === undefined || !Number.isFinite(bps)) return "…";
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/* ── expiry countdown ───────────────────────────────────────────────────────── */

/**
 * A short "expires in" label from a unix-seconds `validUntil` and a `now` (ms). Pure: pass the clock in
 * (callers hold `now` in state to stay lint-clean — no `Date.now()` in render). Past-due → "expired".
 */
export function expiryCountdown(validUntil: number, nowMs: number): string {
  const secondsLeft = validUntil - Math.floor(nowMs / 1000);
  if (secondsLeft <= 0) return "expired";
  const d = Math.floor(secondsLeft / 86_400);
  const h = Math.floor((secondsLeft % 86_400) / 3_600);
  const m = Math.floor((secondsLeft % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = secondsLeft % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Days → a unix-seconds `validUntil` from a `now` (ms). Pure — callers pass the clock (lint-clean). */
export function validUntilFromDays(days: number, nowMs: number): number {
  return Math.floor(nowMs / 1000) + days * 86_400;
}
