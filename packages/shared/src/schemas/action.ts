/**
 * ActionType + the canonical (proposed / normalized) Action wire schema.
 *
 * Grounding: agent-service-api.md §2.2 (ActionType enum), §3.5 (the `/build-tx`
 * request `action` shape — the canonical action), §2.7 (`proposedAction` carried
 * by recommendation/action ChatBlocks), §2.4 (`normalizedAction`).
 *
 * NOTE on `asset`: on the wire an action's `asset` is a 0x TOKEN ADDRESS
 * (`"0xUSDC"` in the spec examples), NOT the symbolic `Asset` enum ("USDC"/"ETH")
 * used by the policy layer. So this schema reuses the foundation `ActionType`
 * enum (per instructions) but types `asset` as an address, not `Asset`.
 */

import { z } from "zod";

import { ActionType } from "../policy/enums";
import { HexAddressSchema, UintAmountSchema } from "./primitives";

/** agent-service-api.md §2.2 — reuses the foundation `ActionType` string enum. */
export const ActionTypeSchema = z.nativeEnum(ActionType);

/** §3.5 — action params; `maxSlippageBps` is REQUIRED for swaps, absent for custody ops. */
export const ActionParamsSchema = z
  .object({
    maxSlippageBps: z.number().int().nonnegative(),
  })
  .strict();
export type ActionParams = z.infer<typeof ActionParamsSchema>;

/**
 * A token reference on a proposed swap (universal swap, feature 007 · US4 chat parity). `decimals`/
 * `symbol` are UNTRUSTED HINTS for display only — the web ALWAYS re-reads `decimals()` on-chain before
 * scaling any amount (a wrong `decimals` on the input leg would mis-scale what the user pays).
 */
export const TokenRefSchema = z
  .object({
    address: HexAddressSchema,
    decimals: z.number().int().nonnegative().optional(),
    symbol: z.string().optional(),
  })
  .strict();
export type TokenRef = z.infer<typeof TokenRefSchema>;

/**
 * §3.5 / §2.7 — the canonical, NOT-yet-signable action. Reused for
 * `PolicyVerdict.normalizedAction` (§2.4) and ChatBlock `proposedAction` (§2.7).
 */
export const ProposedActionSchema = z
  .object({
    type: ActionTypeSchema,
    /** Token address (`"0xUSDC"`), not the symbolic Asset enum — see file note. */
    asset: HexAddressSchema,
    decimals: z.number().int().nonnegative(),
    /** Raw base units; for redeem the caller may drive by shares (§3.5). */
    amount: UintAmountSchema,
    params: ActionParamsSchema.optional(),
    recommendationId: z.string().optional(),
    // ── universal swap (007 · US4) — an OPTIONAL token pair + chain for a swap proposal. Additive so an
    // OLD single-`asset` block still validates (fields absent); the web MUST deploy this tolerant schema
    // before the agent emits the pair (the agent redeploys independently). tokenIn is constrained to a
    // known-decimals recommended token agent-side; tokenOut may be an arbitrary ERC-20. ──
    tokenIn: TokenRefSchema.optional(),
    tokenOut: TokenRefSchema.optional(),
    chainId: z.number().int().positive().optional(),
  })
  .strict();
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
