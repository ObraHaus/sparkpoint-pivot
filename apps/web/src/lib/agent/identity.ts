/**
 * identity — resolving the network id the agent is told about (§1.2 `X-Chain-Id`).
 *
 * WHY THIS EXISTS (029). The identity builder guarded a missing chain with
 * `chainId ?? DEFAULT_CHAIN_ID`. In JavaScript `??` catches `null` and `undefined` — and NOT
 * `NaN`, which sails through into `String(...)` and reaches the wire as the literal text
 * `"NaN"`. The agent rejects that (correctly), so the Aug-3 regression saw a malformed header on
 * 7 of 7 requests and the raw validation error rendered in the transcript as if Sparky had said
 * it. The chat, portfolio, tips, notifications and mandate reads were ALL affected.
 *
 * The rule is therefore stated once, here, and covers every way a chain id can be wrong: absent,
 * non-numeric, non-finite, or simply a network SparkPoint does not support.
 *
 * Leaf module: `@sparkpoint/shared/chains` is a dependency-free value import (deliberately kept
 * that way so web unit tests can load it), and there is no React here — `node --test` runs this.
 */

import { SWITCHABLE_CHAINS, isSupportedChain } from "@sparkpoint/shared/chains";

/**
 * Where reads land when the wallet hasn't told us a usable chain yet.
 *
 * DERIVED, not hardcoded. This was `8453` (Base mainnet) — and Base mainnet is exactly the chain
 * SparkPoint does NOT operate on today: `CHAIN_META[8453]` is `offersVault: false` and
 * `switchable: false`, pending the external audit. While the `NaN` bug was live the fallback never
 * actually fired (`??` skipped it), so the wrong value was invisible; the moment the guard started
 * working, every read asserted a chain with no deployment and the agent 503'd the lot. A default
 * has to be a chain the product is actually on, so it is read from the chain metadata: the first
 * chain the app both offers a vault on and lets a user switch to (Base Sepolia today). When Base
 * mainnet opens, it becomes switchable and this follows automatically.
 */
export const DEFAULT_CHAIN_ID: number =
  SWITCHABLE_CHAINS.find((c) => c.offersVault)?.chainId ?? SWITCHABLE_CHAINS[0]?.chainId ?? 84532;

/**
 * The chain id to send, given whatever the wallet layer currently reports.
 *
 * Returns a supported chain id ALWAYS — never `NaN`, never a string, never an unsupported
 * network. A wallet mid-reconnect (the observed `NaN` case) reads as "not known yet" and falls
 * back, which keeps the app working instead of emitting a request the agent must refuse.
 */
export function resolveChainId(raw: unknown, fallback: number = DEFAULT_CHAIN_ID): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return isSupportedChain(n) ? n : fallback;
}
