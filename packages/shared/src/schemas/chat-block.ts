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
    recipient: z.string().min(1).optional(),
  })
  .strict();
export type CrossChainQuoteBlock = z.infer<typeof CrossChainQuoteBlockSchema>;

/* ── 069 — data-driven Morpho earn registry ───────────────────────────────── */

/**
 * The rails the earn cards can report. 071 adds `oneclick_rhea`, the only way to reach Rhea
 * lending on NEAR; a missing rail is an honest "not here" reason.
 */
export const EarnRailSchema = z.enum([
  "direct",
  "oneclick_earn",
  "oneclick_rhea",
  "intents_connect",
]);
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

/** The protocol a vault/receipt belongs to. A missing value means the 069 Morpho default. */
export const EarnProtocolSchema = z.enum(["morpho", "kamino", "rhea"]);
export type EarnProtocol = z.infer<typeof EarnProtocolSchema>;

/** How a 1Click receipt relates to the vault share: a NEAR wrapper or the native share mint. */
export const EarnReceiptKindSchema = z.enum(["wrapper", "native_shares"]);
export type EarnReceiptKind = z.infer<typeof EarnReceiptKindSchema>;

/**
 * The 1Click receipt that can stand in for a vault's native share. 070 adds `protocol` and
 * `receiptKind`, both omitted for the 069 Morpho wrapper defaults so those fixtures stay valid.
 */
export const OneClickReceiptSchema = z
  .object({
    symbol: z.string(),
    assetId: z.string(),
    decimals: z.number().int().nonnegative(),
    chain: z.string(),
    wrapperAddress: z.string(),
    underlyingVault: z.string(),
    protocol: EarnProtocolSchema.optional(),
    receiptKind: EarnReceiptKindSchema.optional(),
  })
  .strict();
export type OneClickReceipt = z.infer<typeof OneClickReceiptSchema>;

/**
 * 070 — how the beta can accept a preview's recipient/deposit today. `paste_solana_address` is the
 * only recipient mode; `deposit` says whether the origin is a connected EVM wallet or the 068
 * copy-address flow. Present only on Solana receipt previews.
 */
export const EarnWalletSupportSchema = z
  .object({
    recipient: z.literal("paste_solana_address"),
    deposit: z.enum(["evm_wallet", "copy_address"]),
  })
  .strict();
export type EarnWalletSupport = z.infer<typeof EarnWalletSupportSchema>;

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
        // 071 Rhea rows name only a reason (there is no NEAR wallet path); 069/070 keep a note.
        note: z.string().optional(),
      })
      .strict(),
    // Present on 069/070 Morpho/Kamino rows; omitted for 071 Rhea (it uses `oneclickRhea`).
    oneclickEarn: z
      .object({
        available: z.boolean(),
        liveness: z.string().optional(),
        receipt: OneClickReceiptSchema.optional(),
        reason: z.string().nullable().optional(),
        note: z.string().optional(),
        feeNote: z.string().optional(),
      })
      .strict()
      .optional(),
    // 071 — the Rhea 1Click rail. `assetId` names the NEAR token id the quote supplies into.
    oneclickRhea: z
      .object({
        available: z.boolean(),
        liveness: z.string().optional(),
        reason: z.string().nullable().optional(),
        note: z.string().optional(),
        feeNote: z.string().optional(),
        assetId: z.string().optional(),
      })
      .strict()
      .optional(),
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
    protocol: EarnProtocolSchema.optional(),
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
 * 071 — where an APY/position came from. `stale` is only on preview sources (a positions read is
 * always live), so it is optional. The contract/method/field triple is *not* decoration: it is
 * what lets the UI say the rate is a contract read rather than a hard-coded guess.
 */
export const EarnSourceSchema = z
  .object({
    kind: z.string(),
    contract: z.string(),
    method: z.string(),
    field: z.string(),
    uiUrl: z.string(),
    fetchedAt: z.string(),
    stale: z.boolean().optional(),
  })
  .strict();
export type EarnSource = z.infer<typeof EarnSourceSchema>;

/** 071 — the one-off Rhea account (MCA) creation fee, taken from the first deposit only. */
export const EarnOneTimeFeeSchema = z
  .object({
    amount: z.string(),
    symbol: z.string(),
    reason: z.string(),
  })
  .strict();
export type EarnOneTimeFee = z.infer<typeof EarnOneTimeFeeSchema>;

/** 071 — Rhea withdraw is an external link-out in this phase, never an in-app transaction. */
export const EarnWithdrawSchema = z
  .object({
    kind: z.literal("external_link"),
    url: z.string(),
    note: z.string(),
  })
  .strict();
export type EarnWithdraw = z.infer<typeof EarnWithdrawSchema>;

/**
 * 079 — the UNSIGNED origin ERC-20 transfer plan for a cross-chain Rhea live commit.
 *
 * Data only: the agent never signs/sends it. The user's own wallet reviews and confirms the
 * `transfer(address,uint256)` calldata to the 1Click deposit address. A non-EVM origin is an
 * honest `unsupported` plan, never an invented transfer.
 */
export const EarnXchainTransferPlanSchema = z
  .object({
    kind: z.enum(["erc20_transfer", "unsupported"]),
    unsigned: z.literal(true),
    chain: z.string(),
    chainId: z.number().int().nullable(),
    tokenAddress: z.string().nullable(),
    from: z.string(),
    to: z.string(),
    amount: z.string(),
    amountRaw: z.string(),
    symbol: z.string(),
    functionSignature: z.string().nullable(),
    calldata: z.string().nullable(),
    note: z.string(),
  })
  .strict();
export type EarnXchainTransferPlan = z.infer<typeof EarnXchainTransferPlanSchema>;

/**
 * 069 — `earn_quote`, a DRY preview (1Click receipt, direct same-chain hint or an Intents Connect
 * step plan). NON-SIGNABLE: there is no confirm/send button in Phase B. Every optional field is
 * omitted when absent, matching `EarnQuoteBlock.to_wire()`.
 *
 * 071 adds the Rhea preview fields (all optional so 069/070 fixtures are byte-identical). `mca` is
 * explicitly nullable: on a first deposit it is `null` and the recipient is the Rhea account
 * manager (`multica.near`).
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
    receiptKind: EarnReceiptKindSchema.optional(),
    walletSupport: EarnWalletSupportSchema.optional(),
    unavailableReason: z.string().optional(),
    steps: z.array(IntentsConnectStepSchema).optional(),
    quotedAt: z.string().optional(),
    expiresHint: z.string().optional(),
    protocol: EarnProtocolSchema.optional(),
    firstDeposit: z.boolean().optional(),
    mca: z.string().nullable().optional(),
    recipient: z.string().optional(),
    customRecipientMsg: z.string().optional(),
    messageToSign: z.string().optional(),
    oneTimeFee: EarnOneTimeFeeSchema.optional(),
    netSupplied: HumanAmountStringSchema.optional(),
    supplyApy: z.string().optional(),
    source: EarnSourceSchema.optional(),
    withdraw: EarnWithdrawSchema.optional(),
    // 079 — Phase C cross-chain review. `live` is only true for a gated `dry=false` quote; the
    // transfer plan is unsigned and the agent never signs/sends it.
    live: z.boolean().optional(),
    depositAddress: z.string().optional(),
    transferPlan: EarnXchainTransferPlanSchema.optional(),
    requiresSignature: z.boolean().optional(),
  })
  .strict();
export type EarnQuoteBlock = z.infer<typeof EarnQuoteBlockSchema>;

/** One supplied row from `get_account_all_positions`, already unit-converted by the agent. */
export const EarnPositionSchema = z
  .object({
    symbol: z.string(),
    amount: HumanAmountStringSchema,
    apy: z.string().nullable().optional(),
  })
  .strict();
export type EarnPosition = z.infer<typeof EarnPositionSchema>;

/**
 * 071 — `earn_positions`, a read-only view of the signed-in wallet's Rhea (Burrow) account.
 * `state="empty"` is an honest "no Rhea account yet", not an error; nothing here is signable.
 */
export const EarnPositionsBlockSchema = z
  .object({
    type: z.literal("earn_positions"),
    state: z.enum(["ready", "empty", "unavailable"]),
    mca: z.string().nullable(),
    supplied: z.array(EarnPositionSchema),
    totalUsd: HumanAmountStringSchema.optional(),
    source: EarnSourceSchema.optional(),
    appUrl: z.string().optional(),
    explainer: z.string().optional(),
    unavailableReason: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type EarnPositionsBlock = z.infer<typeof EarnPositionsBlockSchema>;

/* ── 072 — read-only multi-chain portfolio ────────────────────────────────── */

/**
 * 072 — the five independently-degradable sources. `not_linked` is Kamino's honest "no Solana
 * address is bound to this owner yet"; `unavailable` is a failed read, never a fabricated zero.
 */
export const PortfolioSectionStatusSchema = z.enum(["ok", "unavailable", "not_linked"]);
export type PortfolioSectionStatus = z.infer<typeof PortfolioSectionStatusSchema>;

export const PortfolioSectionKeySchema = z.enum([
  "balances",
  "morpho",
  "kamino",
  "rhea",
  "swaps",
]);
export type PortfolioSectionKey = z.infer<typeof PortfolioSectionKeySchema>;

/** A balances-only per-chain status entry (an unconfigured Ethereum RPC says so here). */
export const PortfolioChainStatusSchema = z
  .object({
    chain: z.string(),
    label: z.string(),
    status: PortfolioSectionStatusSchema,
    reason: z.string().nullable(),
  })
  .strict();
export type PortfolioChainStatus = z.infer<typeof PortfolioChainStatusSchema>;

/**
 * 072 — one display row. The common identity fields are required; everything source-specific is
 * optional and OMITTED (never `null`) when absent, exactly as `PortfolioRow.to_wire()` emits it.
 * `valueUsd` is absent when the row cannot be priced honestly (e.g. a Kamino share with no price).
 */
export const PortfolioRowSchema = z
  .object({
    chain: z.string(),
    chainLabel: z.string(),
    protocol: z.string(),
    kind: z.string(),
    symbol: z.string(),
    amount: HumanAmountStringSchema.optional(),
    valueUsd: UsdStringSchema.optional(),
    priceSource: z.string().optional(),
    // balances
    address: z.string().optional(),
    decimals: z.number().int().nonnegative().optional(),
    priceUsd: z.string().optional(),
    // morpho
    vaultAddress: z.string().optional(),
    vaultName: z.string().optional(),
    assetSymbol: z.string().optional(),
    netApy: z.string().optional(),
    shares: z.string().optional(),
    rail: z.string().optional(),
    receiptAddress: z.string().optional(),
    underlyingVault: z.string().optional(),
    note: z.string().optional(),
    // kamino
    sharesMint: z.string().optional(),
    wallet: z.string().optional(),
    // rhea
    apy: z.string().optional(),
    mca: z.string().optional(),
    // swaps
    originKey: z.string().optional(),
    originLabel: z.string().optional(),
    destinationKey: z.string().optional(),
    destinationLabel: z.string().optional(),
    route: z.string().optional(),
    amountOut: z.string().optional(),
    depositAddress: z.string().optional(),
    createdAt: z.string().optional(),
    lastStatus: z.string().optional(),
  })
  .strict();
export type PortfolioRow = z.infer<typeof PortfolioRowSchema>;

/**
 * 072 — one section. `totalUsd` is present only when at least one row is priced; `chains` is the
 * balances-only additive field, and `mca`/`appUrl` are Rhea's additive fields.
 */
export const PortfolioSectionSchema = z
  .object({
    key: PortfolioSectionKeySchema,
    label: z.string(),
    status: PortfolioSectionStatusSchema,
    rows: z.array(PortfolioRowSchema),
    reason: z.string().optional(),
    source: z.string().optional(),
    asOf: z.string().optional(),
    totalUsd: UsdStringSchema.optional(),
    chains: z.array(PortfolioChainStatusSchema).optional(),
    mca: z.string().optional(),
    appUrl: z.string().optional(),
    // Rhea's empty account ("no Rhea account yet") and its one-time fee explanation.
    explainer: z.string().optional(),
    // Kamino's meta count of Solana addresses already linked to this wallet.
    linkedAddresses: z.number().int().nonnegative().optional(),
    note: z.string().optional(),
  })
  .strict();
export type PortfolioSection = z.infer<typeof PortfolioSectionSchema>;

/** 072 — the per-chain and per-protocol sums (only rows in `ok` sections contribute). */
export const PortfolioChainTotalSchema = z
  .object({ chain: z.string(), label: z.string(), valueUsd: UsdStringSchema })
  .strict();
export type PortfolioChainTotal = z.infer<typeof PortfolioChainTotalSchema>;

export const PortfolioProtocolTotalSchema = z
  .object({ protocol: z.string(), valueUsd: UsdStringSchema })
  .strict();
export type PortfolioProtocolTotal = z.infer<typeof PortfolioProtocolTotalSchema>;

/** `totalUsd` is `null` when nothing is priced; `priced` distinguishes "no value" from "$0". */
export const PortfolioTotalsSchema = z
  .object({
    totalUsd: UsdStringSchema.nullable(),
    priced: z.boolean(),
    byChain: z.array(PortfolioChainTotalSchema),
    byProtocol: z.array(PortfolioProtocolTotalSchema),
  })
  .strict();
export type PortfolioTotals = z.infer<typeof PortfolioTotalsSchema>;

/**
 * 072 — `portfolio_overview`, the session wallet's read-only multi-chain portfolio. It carries no
 * calldata, no signature and no policy stamp; every section degrades on its own.
 *
 * `wallet` and `text` are ADDITIVE API fields: `GET /portfolio/multichain` returns the same shape
 * plus the deterministic prose, while the chat block omits both. Optional here so the one schema
 * validates the endpoint response AND the streamed block, without the renderer depending on either.
 */
export const PortfolioOverviewBlockSchema = z
  .object({
    type: z.literal("portfolio_overview"),
    state: z.enum(["ready", "empty", "unavailable"]),
    focus: z.enum(["all", "swaps", "earn"]),
    asOf: z.string(),
    sections: z.array(PortfolioSectionSchema),
    totals: PortfolioTotalsSchema,
    sources: z.array(z.string()).optional(),
    note: z.string().optional(),
    wallet: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();
export type PortfolioOverviewBlock = z.infer<typeof PortfolioOverviewBlockSchema>;

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
  EarnPositionsBlockSchema,
  PortfolioOverviewBlockSchema,
]);
export type ChatBlock = z.infer<typeof ChatBlockSchema>;
