/**
 * SimulationResult — the self-hosted Anvil-fork Simulator preview attached to
 * every build/simulate response (§2.3). Closed wire ⇒ `.strict()`. Amounts are
 * base-unit strings, USD are decimal strings (§1.4).
 *
 * The sim-output legs are mutually exclusive by op kind and NULL when N/A:
 *   sharesOut → deposits · assetsOut → withdraws/redeems · outAmount/minOut → swaps.
 * `capHeadroom` is deposit-side only ⇒ null for exits/swaps.
 */

import { z } from "zod";

import {
  HexAddressSchema,
  HexQuantitySchema,
  IntAmountSchema,
  IsoDateTimeSchema,
  UintAmountSchema,
  UsdStringSchema,
} from "./primitives";

/**
 * §2.3 (rev 3.2 — self-hosted Simulator, no vendor): the engine that produced this preview.
 *   `anvil_fork`           — PRIMARY: the supervised Anvil Base-mainnet fork (spark-anvil); trace + before/after
 *                            asset diffs + snapshot/revert; the only engine that covers the fork-only Aerodrome swap.
 *   `bundler_gas_estimate` — ERC-4337 UserOp path: eth_estimateUserOperationGas + on-chain EntryPoint.simulateHandleOp.
 *   `viem_eth_call`        — lightweight live-chain revert/return check (Alchemy eth_call + state override).
 */
export const SimulationProviderSchema = z.enum(["anvil_fork", "bundler_gas_estimate", "viem_eth_call"]);
export type SimulationProvider = z.infer<typeof SimulationProviderSchema>;

/** §2.3 — one asset balance delta of the simulated tx. */
export const BalanceDeltaSchema = z
  .object({
    asset: HexAddressSchema,
    decimals: z.number().int().nonnegative(),
    delta: IntAmountSchema,
    deltaUsd: UsdStringSchema,
  })
  .strict();
export type BalanceDelta = z.infer<typeof BalanceDeltaSchema>;

/** §2.3 — gas estimate (hex quantity) + its USD projection. */
export const GasEstimateSchema = z
  .object({
    estimate: HexQuantitySchema,
    gasUsd: UsdStringSchema,
  })
  .strict();
export type GasEstimate = z.infer<typeof GasEstimateSchema>;

/** §2.3 — remaining deposit-side cap headroom (base units). Null for exits. */
export const CapHeadroomSchema = z
  .object({
    perUser: UintAmountSchema,
    total: UintAmountSchema,
    vault: UintAmountSchema,
  })
  .strict();
export type CapHeadroom = z.infer<typeof CapHeadroomSchema>;

export const SimulationResultSchema = z
  .object({
    provider: SimulationProviderSchema,
    willRevert: z.boolean(),
    revertReason: z.string().nullable(),
    balanceDeltas: z.array(BalanceDeltaSchema),
    sharesOut: UintAmountSchema.nullable(),
    assetsOut: UintAmountSchema.nullable(),
    outAmount: UintAmountSchema.nullable(),
    minOut: UintAmountSchema.nullable(),
    priceImpactBps: z.number().int(),
    slippageBps: z.number().int(),
    feesUsd: UsdStringSchema,
    gas: GasEstimateSchema,
    capHeadroom: CapHeadroomSchema.nullable(),
    asOfBlock: z.number().int().nonnegative(),
    asOf: IsoDateTimeSchema,
  })
  .strict();
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

/**
 * §018/US2 — the read-only pre-sign dry-run envelope returned by
 * `POST /vault/simulate/{deposit,withdraw}`. It wraps the canonical
 * {@link SimulationResultSchema} produced by the `viem_eth_call` dry-run of the REAL
 * mutating ERC-4626 calldata, plus two honesty signals the bare sim can't carry:
 *
 *  - `approvalRequired` — DEPOSIT only. When the user's live USDC allowance to the vault
 *    is below the deposit amount, the deposit `eth_call` would revert on `transferFrom`
 *    for a reason that is NOT a real problem — so we DEFER the dry-run (`simulation = null`)
 *    and tell the user to approve first, rather than showing a spurious "would revert".
 *  - `sharesOut` / `assetsOut` — the deterministic ERC-4626 `previewDeposit` / `previewRedeem`
 *    read straight from chain (the `viem_eth_call` leg diffs no balances, so it leaves the
 *    sim's own `sharesOut`/`assetsOut` null — these envelope fields carry the real amount).
 *
 * `.strict()` closed wire; the Python model mirrors it byte-for-byte (agent api/vault.py).
 * Non-custody: this is an eth_call + eth_estimateGas trace only — it NEVER signs, submits,
 * or gates the withdraw/exit path (N2); the withdraw dry-run is advisory only.
 */
export const VaultSimulateResponseSchema = z
  .object({
    kind: z.enum(["deposit", "withdraw"]),
    approvalRequired: z.boolean(),
    simulation: SimulationResultSchema.nullable(),
    sharesOut: UintAmountSchema.nullable(),
    assetsOut: UintAmountSchema.nullable(),
  })
  .strict();
export type VaultSimulateResponse = z.infer<typeof VaultSimulateResponseSchema>;
