/**
 * ChatBlock — the streamed SSE envelope validated by the frontend, fail-closed
 * (§2.7). A discriminated union on `type`; each member is `.strict()` so any
 * unknown/malformed block is rejected and the renderer can't act on it.
 *
 * Signability rule (§2.7): a `recommendation`/`action` block is signable ONLY
 * when `policy.status === "approved"`. Structured blocks are emitted as COMPLETE
 * JSON (never partially streamed), so a half-streamed action can't be acted on.
 */

import { z } from "zod/v3";

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

/* ── 068 — NEAR Intents 1Click cross-chain quote ───────────────────────────── */

/**
 * Human decimal string, e.g. `"5000"` / `"0.06439596"`. The agent serializes money as strings
 * (never floats), and `amountOut`/`minAmountOut` are HUMAN units — not base units.
 */
export const HumanAmountStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "expected a non-negative human decimal string");

/** The address families 1Click destinations can resolve to. */
export const CrossChainAddressKindSchema = z.enum(["evm", "btc", "sol", "tron", "near"]);
export type CrossChainAddressKind = z.infer<typeof CrossChainAddressKindSchema>;

/**
 * 068 — the origin leg of a cross-chain quote. Mirrors
 * `crosschain/config.py::CrossChainAsset.origin_wire()`. `evmChainId` is REQUIRED but
 * nullable: a non-EVM origin (BTC/SOL/NEAR) emits `null` rather than omitting the key.
 */
export const CrossChainOriginSchema = z
  .object({
    key: z.string(),
    chain: z.string(),
    chainLabel: z.string(),
    symbol: z.string(),
    amount: HumanAmountStringSchema,
    assetId: z.string(),
    evmChainId: z.number().int().nullable(),
  })
  .strict();
export type CrossChainOrigin = z.infer<typeof CrossChainOriginSchema>;

/**
 * 068 — the destination leg. Mirrors `CrossChainAsset.destination_wire()`; the destination
 * carries the address family the confirm screen must validate against.
 */
export const CrossChainDestinationSchema = z
  .object({
    key: z.string(),
    chain: z.string(),
    chainLabel: z.string(),
    symbol: z.string(),
    assetId: z.string(),
    addressKind: CrossChainAddressKindSchema,
  })
  .strict();
export type CrossChainDestination = z.infer<typeof CrossChainDestinationSchema>;

/**
 * 068 — `crosschain_quote`, a NON-SIGNABLE preview/unavailable card produced by the
 * deterministic cross-chain route. Mirrors `CrossChainQuoteBlock.to_wire()` exactly:
 * camelCase, and every optional field is OMITTED (never `null`) when absent. It carries no
 * calldata and no signature — confirm/deposit is a separate HTTP flow.
 */
export const CrossChainQuoteBlockSchema = z
  .object({
    type: z.literal("crosschain_quote"),
    state: z.enum(["preview", "unavailable"]),
    origin: CrossChainOriginSchema,
    destination: CrossChainDestinationSchema,
    amountOut: HumanAmountStringSchema.optional(),
    amountOutUsd: HumanAmountStringSchema.optional(),
    amountInUsd: HumanAmountStringSchema.optional(),
    minAmountOut: HumanAmountStringSchema.optional(),
    timeEstimateSec: z.number().int().nonnegative().optional(),
    slippageBps: z.number().int().nonnegative().optional(),
    feeNote: z.string().optional(),
    unavailableReason: z.string().optional(),
    quotedAt: z.string().optional(),
    expiresHint: z.string().optional(),
  })
  .strict();
export type CrossChainQuoteBlock = z.infer<typeof CrossChainQuoteBlockSchema>;

/* ── 069 — data-driven Morpho earn registry ───────────────────────────────── */

/** The three rails feature 069 can report. A missing rail is an honest "not here" reason. */
export const EarnRailSchema = z.enum(["direct", "oneclick_earn", "intents_connect"]);
export type EarnRail = z.infer<typeof EarnRailSchema>;

/** The underlying ERC-20 of a Morpho vault (`VaultAsset.wire()`). */
export const EarnVaultAssetSchema = z
  .object({
    address: z.string(),
    symbol: z.string(),
    decimals: z.number().int().nonnegative(),
  })
  .strict();
export type EarnVaultAsset = z.infer<typeof EarnVaultAssetSchema>;

/** The NEAR-issued 1Click receipt that can stand in for a vault's native share. */
export const OneClickReceiptSchema = z
  .object({
    symbol: z.string(),
    assetId: z.string(),
    decimals: z.number().int().nonnegative(),
    chain: z.string(),
    wrapperAddress: z.string(),
    underlyingVault: z.string(),
  })
  .strict();
export type OneClickReceipt = z.infer<typeof OneClickReceiptSchema>;

/** One read-only EVM step in an Aurora Intents Connect plan (never executed by this card). */
export const IntentsConnectStepSchema = z
  .object({
    to: z.string(),
    functionSignature: z.string(),
    parameters: z.array(z.string()),
    value: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type IntentsConnectStep = z.infer<typeof IntentsConnectStepSchema>;

/**
 * 069 — the per-vault rail detail. Mirrors `earn/rails.py::RailResolution.wire()`:
 * camelCase, optional fields are OMITTED (never `null`) when the backend has no value.
 */
export const EarnRailsSchema = z
  .object({
    available: z.array(EarnRailSchema),
    direct: z
      .object({
        available: z.boolean(),
        reason: z.string().nullable(),
        note: z.string(),
      })
      .strict(),
    oneclickEarn: z
      .object({
        available: z.boolean(),
        liveness: z.string().optional(),
        receipt: OneClickReceiptSchema.optional(),
        reason: z.string().nullable().optional(),
        note: z.string().optional(),
        feeNote: z.string().optional(),
      })
      .strict(),
    intentsConnect: z
      .object({
        available: z.boolean(),
        reason: z.string().nullable().optional(),
        steps: z.array(IntentsConnectStepSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type EarnRails = z.infer<typeof EarnRailsSchema>;

/**
 * 069 — one normalized vault row (`VaultEntry.wire()` + `curatedDefault` + `rails`). `tvlUsd` and
 * `netApy` are REQUIRED but nullable: the UI shows an em dash rather than inventing a figure.
 */
export const EarnVaultSchema = z
  .object({
    chain: z.string(),
    chainId: z.number().int().nonnegative(),
    address: z.string(),
    version: z.string(),
    name: z.string(),
    symbol: z.string(),
    asset: EarnVaultAssetSchema,
    listed: z.boolean(),
    tvlUsd: z.string().nullable(),
    netApy: z.string().nullable(),
    source: z.string(),
    fetchedAt: z.string(),
    curatedDefault: z.boolean(),
    rails: EarnRailsSchema,
  })
  .strict();
export type EarnVault = z.infer<typeof EarnVaultSchema>;

/**
 * 069 — `earn_vaults`, the deterministic Morpho vault list. Non-signable: it carries no calldata
 * and no action. `state="unavailable"` is an honest empty/failed snapshot, not an error.
 */
export const EarnVaultsBlockSchema = z
  .object({
    type: z.literal("earn_vaults"),
    state: z.enum(["ready", "unavailable"]),
    vaults: z.array(EarnVaultSchema),
    snapshotAgeMinutes: z.number().int().nonnegative().optional(),
    snapshotSource: z.string().optional(),
    unavailableReason: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type EarnVaultsBlock = z.infer<typeof EarnVaultsBlockSchema>;

/**
 * 069 — `earn_quote`, a DRY preview (1Click receipt, direct same-chain hint or an Intents Connect
 * step plan). NON-SIGNABLE: there is no confirm/send button in Phase B. Every optional field is
 * omitted when absent, matching `EarnQuoteBlock.to_wire()`.
 */
export const EarnQuoteBlockSchema = z
  .object({
    type: z.literal("earn_quote"),
    state: z.enum(["preview", "unavailable"]),
    rail: EarnRailSchema,
    vault: EarnVaultSchema,
    origin: CrossChainOriginSchema.optional(),
    amountIn: HumanAmountStringSchema.optional(),
    amountOut: HumanAmountStringSchema.optional(),
    amountOutUsd: HumanAmountStringSchema.optional(),
    timeEstimateSec: z.number().int().nonnegative().optional(),
    feeNote: z.string().optional(),
    receiptNote: z.string().optional(),
    unavailableReason: z.string().optional(),
    steps: z.array(IntentsConnectStepSchema).optional(),
    quotedAt: z.string().optional(),
    expiresHint: z.string().optional(),
  })
  .strict();
export type EarnQuoteBlock = z.infer<typeof EarnQuoteBlockSchema>;

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
  CrossChainQuoteBlockSchema,
  EarnVaultsBlockSchema,
  EarnQuoteBlockSchema,
]);
export type ChatBlock = z.infer<typeof ChatBlockSchema>;
