/**
 * ChatBlock — the streamed SSE envelope validated by the frontend, fail-closed
 * (§2.7). A discriminated union on `type`; each member is `.strict()` so any
 * unknown/malformed block is rejected and the renderer can't act on it.
 *
 * Signability rule (§2.7): a `recommendation`/`action` block is signable ONLY
 * when `policy.status === "approved"`. Structured blocks are emitted as COMPLETE
 * JSON (never partially streamed), so a half-streamed action can't be acted on.
 */

import { z } from "zod";

import { Protocol } from "../policy/enums";
import { ProposedActionSchema } from "./action";
import { CitationSchema } from "./citation";
import { GuardrailCheckSchema } from "./guardrail";
import { PolicyStatusSchema } from "./policy-verdict";
import { UsdStringSchema } from "./primitives";

/**
 * §2.7 — the policy stamp on a recommendation/action block. `checks` accompanies
 * an approved recommendation; `reason` accompanies a rejection. Both optional so
 * one shape covers both cases.
 */
export const ChatPolicyStampSchema = z
  .object({
    status: PolicyStatusSchema,
    checks: z.array(GuardrailCheckSchema).optional(),
    reason: z.string().optional(),
  })
  .strict();
export type ChatPolicyStamp = z.infer<typeof ChatPolicyStampSchema>;

/**
 * §2.7 — the trimmed position echoed inside a `portfolio_snapshot` block. The
 * contract only enumerates the FULL position (§3.3); core identity fields are
 * required and the rest optional. Non-strict (strip) because "PositionLite" is
 * not exhaustively pinned in the contract — over-strictness would wrongly reject
 * a valid enriched position.
 */
export const PositionLiteSchema = z.object({
  venue: z.string(),
  asset: z.string(),
  valueUsd: UsdStringSchema,
  shares: z.string().optional(),
  underlying: z.string().optional(),
  priceSource: z.string().optional(),
  costBasisUsd: UsdStringSchema.optional(),
  unrealizedPnlUsd: UsdStringSchema.optional(),
  riskTier: z.string().optional(),
});
export type PositionLite = z.infer<typeof PositionLiteSchema>;

/* ── discriminated-union members (type ∈ §2.7) ─────────────────────────────── */

/** Only `text` and `tool_step` stream incrementally (§2.7). */
export const TextBlockSchema = z
  .object({ type: z.literal("text"), markdown: z.string() })
  .strict();

export const ToolStepBlockSchema = z
  .object({
    type: z.literal("tool_step"),
    label: z.string(),
    status: z.enum(["running", "done", "error"]),
  })
  .strict();

export const RecommendationBlockSchema = z
  .object({
    type: z.literal("recommendation"),
    recId: z.string(),
    title: z.string(),
    rank: z.number().int().positive(),
    rationale: z.string(),
    /** Whitelisted protocol only (foundation `Protocol` enum). */
    protocol: z.nativeEnum(Protocol),
    proposedAction: ProposedActionSchema,
    policy: ChatPolicyStampSchema,
    citations: z.array(CitationSchema),
    /**
     * 030 — the strategy's OWN risk tier (1..5), its fee stance and who manages the position.
     *
     * OPTIONAL, and that is load-bearing in both directions: this schema is `.strict()`, so a
     * NEW agent talking to an OLD web build would have every recommendation card rejected and
     * rendered inert if these were unknown keys — and an OLD agent talking to a new build must
     * still validate, which it does because they are optional. The renderer falls back to the
     * pre-030 display when they are absent.
     */
    riskTier: z.number().int().min(1).max(5).optional(),
    feeStance: z.string().optional(),
    managedBy: z.string().optional(),
  })
  .strict();

export const ActionBlockSchema = z
  .object({
    type: z.literal("action"),
    proposedAction: ProposedActionSchema,
    policy: ChatPolicyStampSchema,
  })
  .strict();

export const PortfolioSnapshotBlockSchema = z
  .object({
    type: z.literal("portfolio_snapshot"),
    positions: z.array(PositionLiteSchema),
  })
  .strict();

export const TipBlockSchema = z
  .object({ type: z.literal("tip"), topic: z.string(), body: z.string() })
  .strict();

export const OutcomeBlockSchema = z
  .object({
    type: z.literal("outcome"),
    recId: z.string(),
    realizedPnlUsd: UsdStringSchema,
    status: z.enum(["open", "closed"]),
  })
  .strict();

export const CitationBlockSchema = z
  .object({
    type: z.literal("citation"),
    sources: z.array(CitationSchema),
  })
  .strict();

export const ErrorBlockSchema = z
  .object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  })
  .strict();

export const ChatBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ToolStepBlockSchema,
  RecommendationBlockSchema,
  ActionBlockSchema,
  PortfolioSnapshotBlockSchema,
  TipBlockSchema,
  OutcomeBlockSchema,
  CitationBlockSchema,
  ErrorBlockSchema,
]);
export type ChatBlock = z.infer<typeof ChatBlockSchema>;
