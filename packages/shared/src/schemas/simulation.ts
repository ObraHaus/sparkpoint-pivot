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
