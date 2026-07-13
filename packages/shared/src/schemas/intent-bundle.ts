/**
 * IntentBundle — the ONLY state-changing artifact the service emits (§2.1).
 * Inert, UNSIGNED calldata / PackedUserOperation (EntryPoint v0.7) + a Simulator
 * preview + a deterministic PolicyVerdict. Closed wire ⇒ `.strict()`.
 *
 * NON-CUSTODY INVARIANT (N1/N3, §0.2, §2.1): the service NEVER returns a
 * signature. `userOp.signature` is therefore modeled as `z.null().default(null)`
 * — it accepts null / an omitted field (→ null) and REJECTS any non-null value.
 * A signature only ever appears when the user's own wallet fills it, which
 * happens OUTBOUND at `/submit-signed-tx`, never on an IntentBundle from here.
 */

import { z } from "zod";

import { ActionTypeSchema } from "./action.js";
import { CitationSchema } from "./citation.js";
import { GuardrailCheckSchema } from "./guardrail.js";
import { PolicyVerdictSchema } from "./policy-verdict.js";
import {
  ChainIdSchema,
  HexAddressSchema,
  HexDataSchema,
  HexQuantitySchema,
  IsoDateTimeSchema,
  PolicyVersionSchema,
  UintAmountSchema,
} from "./primitives.js";
import { SimulationResultSchema } from "./simulation.js";

/** §2.1 — `userop` (ERC-4337) | `eoa_call` (direct). */
export const OpTypeSchema = z.enum(["userop", "eoa_call"]);
export type OpType = z.infer<typeof OpTypeSchema>;

/** §2.1 — one ordered, unsigned step (an allowlisted target ONLY; recipient forced to user). */
export const IntentStepSchema = z
  .object({
    chainId: ChainIdSchema,
    opType: OpTypeSchema,
    to: HexAddressSchema,
    value: UintAmountSchema,
    data: HexDataSchema,
    label: z.string(),
  })
  .strict();
export type IntentStep = z.infer<typeof IntentStepSchema>;

/**
 * §2.1 — an UNSIGNED PackedUserOperation (EntryPoint v0.7). `factory`/`factoryData`
 * are set only for a counterfactual account's first tx; `paymaster*` are optional
 * (gas-only, never a fund authority); `signature` is ALWAYS null (see file note).
 */
export const PackedUserOperationSchema = z
  .object({
    sender: HexAddressSchema,
    nonce: HexQuantitySchema,
    factory: HexAddressSchema.nullable(),
    factoryData: HexDataSchema.nullable(),
    callData: HexDataSchema,
    callGasLimit: HexQuantitySchema,
    verificationGasLimit: HexQuantitySchema,
    preVerificationGas: HexQuantitySchema,
    maxFeePerGas: HexQuantitySchema,
    maxPriorityFeePerGas: HexQuantitySchema,
    paymaster: HexAddressSchema.nullable(),
    paymasterData: HexDataSchema.nullable(),
    /** ALWAYS null from the service; a non-null value is a non-custody breach ⇒ rejected. */
    signature: z.null().default(null),
  })
  .strict();
export type PackedUserOperation = z.infer<typeof PackedUserOperationSchema>;

export const IntentBundleSchema = z
  .object({
    id: z.string(),
    userId: HexAddressSchema,
    kind: ActionTypeSchema,
    steps: z.array(IntentStepSchema).min(1),
    /** Present (unsigned) for opType=userop; null/omitted for a pure eoa_call bundle. */
    userOp: PackedUserOperationSchema.nullable().default(null),
    simulation: SimulationResultSchema,
    /** approved=true here — a rejected verdict never ships a bundle (§2.4). */
    policyVerdict: PolicyVerdictSchema,
    guardrailChecklist: z.array(GuardrailCheckSchema),
    rationale: z.string(),
    citations: z.array(CitationSchema),
    recommendationId: z.string().optional(),
    policyVersion: PolicyVersionSchema,
    /** Short-lived; a stale bundle must be rebuilt (§2.1). */
    expiresAt: IsoDateTimeSchema,
  })
  .strict();
export type IntentBundle = z.infer<typeof IntentBundleSchema>;
