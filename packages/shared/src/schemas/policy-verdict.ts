/**
 * PolicyVerdict — the deterministic, LLM-free verdict stamped on every
 * state-changing artifact (§2.4). Reasons use the foundation `ReasonCode` enum.
 * When `approved=false` the endpoint returns a non-2xx error and NO IntentBundle
 * (§2.4); the `reasons[]` are surfaced to the user. Closed wire ⇒ `.strict()`.
 */

import { z } from "zod";

import { ReasonCode } from "../policy/enums";
import { ProposedActionSchema } from "./action";
import { PolicyVersionSchema } from "./primitives";
import { SimulationResultSchema } from "./simulation";

/** §2.4 / §1.5 — one structured reason (foundation `ReasonCode` + message). */
export const ReasonSchema = z
  .object({
    code: z.nativeEnum(ReasonCode),
    message: z.string(),
  })
  .strict();
export type Reason = z.infer<typeof ReasonSchema>;

/**
 * §2.7 — the policy stamp status carried by ChatBlocks. A recommendation/action
 * block is signable ONLY when this is `approved`.
 */
export const PolicyStatusSchema = z.enum(["approved", "rejected"]);
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;

export const PolicyVerdictSchema = z
  .object({
    approved: z.boolean(),
    policyVersion: PolicyVersionSchema,
    /** Always ≥ 1 (OK on success; ≥ 1 rejection code otherwise). */
    reasons: z.array(ReasonSchema).min(1),
    /** Canonical action; null when rejected (§2.4). */
    normalizedAction: ProposedActionSchema.nullable(),
    /** Mirrored SimulationResult; null when rejected before simulation. */
    simulation: SimulationResultSchema.nullable(),
  })
  .strict();
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
