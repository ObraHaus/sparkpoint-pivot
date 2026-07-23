/**
 * Live-caps selection (US1) — the PURE glue between the on-chain `CapRegistry` reads
 * (surfaced by `useVault` as `perUserCap`/`totalCap`/`vaultCap`) and the display caps
 * meter. Kept framework-free with a TYPE-ONLY `@sparkpoint` import so it runs under the
 * web `node --experimental-strip-types --test` runner (which can't resolve extensionless
 * `@/…` / `@sparkpoint/…` ESM), mirroring the vaultConfirmModel.ts/.test.ts split.
 *
 * The rule: prefer the LIVE CapRegistry value; fall back to the versioned policy-mirror
 * constant when the on-chain read is unresolved or CapRegistry isn't deployed on the chain.
 * Never fabricates a cap — the fallback is the SoT mirror.
 */

import type { PolicyCaps } from "@sparkpoint/shared/policy";

/** The three TVL caps a live CapRegistry read can override (session caps have no CapRegistry slot). */
export type TvlCapKey = Extract<keyof PolicyCaps, "perUserTvl" | "totalProtocol" | "vaultDeposit">;

/**
 * The LIVE CapRegistry caps (raw USDC base units) as read by `useVault`. Each is `undefined`
 * until its read resolves (or where CapRegistry isn't deployed) ⇒ the meter uses the mirror.
 * Field names mirror the CapRegistry getters: `perUserCap()` / `totalCap()` / `vaultCap()`.
 */
export interface LiveVaultCaps {
  readonly perUserCap?: bigint;
  readonly totalCap?: bigint;
  readonly vaultCap?: bigint;
}

/** The live CapRegistry raw for a meter key (CapRegistry getter ↔ policy-cap key), or `undefined`. */
export function liveCapRawFor(key: TvlCapKey, live: LiveVaultCaps): bigint | undefined {
  switch (key) {
    case "perUserTvl":
      return live.perUserCap;
    case "totalProtocol":
      return live.totalCap;
    case "vaultDeposit":
      return live.vaultCap;
  }
}

/**
 * The effective cap for `key`: the LIVE CapRegistry value when resolved, else the compile-time
 * policy-mirror `fallbackRaw`. Never fabricates — the fallback is the versioned SoT.
 */
export function effectiveCapRaw(key: TvlCapKey, live: LiveVaultCaps, fallbackRaw: bigint): bigint {
  return liveCapRawFor(key, live) ?? fallbackRaw;
}
