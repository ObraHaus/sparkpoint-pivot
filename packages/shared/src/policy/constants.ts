/**
 * Policy constants — the SINGLE SOURCE OF TRUTH for caps, slippage, the
 * (target,selector) allowlist, session-scope bounds, and governance bounds.
 *
 * Consumed once by (a) the on-chain deploy/arm scripts (`ArmGuardrails`),
 * (b) the off-chain deterministic policy layer, and (c) the client policy
 * mirror. T098 asserts the on-chain reads equal these values; any drift fails CI.
 *
 * Grounding:
 *   policy-schema.md §1 (policyVersion), §3 (allowlist grammar), §4 (caps),
 *   §4.1 (performance-fee governance bound), §5 (slippage), §6 (session scope).
 *   smart-contracts.md §6.1 (MAX_PERFORMANCE_FEE_BPS == 2000, default 1000).
 *
 * Numeric policy: token amounts are `bigint` raw base units (exact, EVM-parity,
 * never floats). `decimals` is carried alongside per policy-schema.md §4.
 *
 * Address policy: this file carries NO concrete addresses. The allowlist keys
 * each entry by a symbolic `TargetRef`; the concrete `(target, selector)` pair
 * the on-chain `PolicyModule.isAllowedTarget` and the T098 drift check compare
 * is formed at consumption time by joining `targetRef` → `addresses[chainId]`
 * (the address book, owned by ./addresses). Addresses live in exactly one place
 * so they can never drift, and this file stays import-free of network state and
 * of the deploy-time-determined vault address.
 */

import { ActionType, Asset, Direction, Protocol } from "./enums";

/** policy-schema.md §1 — pinned, monotonic, logged with every verdict/outcome (N5). */
export const POLICY_VERSION = "policy@2026.06.0" as const;
export type PolicyVersion = typeof POLICY_VERSION;

/** Chain ids this policy foundation is parameterized for (R14). */
export const CHAIN_ID = {
  /** Base mainnet. */
  base: 8453,
  /** Base Sepolia testnet. */
  baseSepolia: 84532,
  /** Local Anvil fork of Base mainnet — reuses the Base-mainnet targets. */
  localFork: 31337,
  /**
   * Robinhood Chain Testnet (§B3). The SparkPoint vault stays BASE-ONLY — 46630 is supported for
   * chat + read-only portfolio, but its allowlist is EMPTY, so every vault/swap action fails closed
   * (we NEVER point the adapter at the unofficial Robinhood "stock market" pilot pool).
   */
  robinhoodTestnet: 46630,
} as const;
export type ChainId = (typeof CHAIN_ID)[keyof typeof CHAIN_ID];

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

/** A 4-byte function selector, e.g. `0x6e553f65`. */
export type Selector = `0x${string}`;

/**
 * Symbolic reference to an on-chain target, resolved to a concrete address via
 * `addresses[chainId]` (./addresses). Keeps addresses defined in exactly one
 * place (drift-safe) and lets the allowlist reference the deploy-time-determined
 * vault without hardcoding it here.
 */
export type TargetRef =
  | "sparkpoint_vault"
  | "aave_v3_pool"
  | "aerodrome_router"
  | "aerodrome_factory";

/**
 * policy-schema.md §3 / §3b — every fund-moving recipient is pinned to the
 * user's own account/owner (N1). No SparkPoint or arbitrary external recipient
 * is ever nameable.
 */
export type RecipientPin = "user_account";

/** policy-schema.md §4 — a cap/amount expressed in raw base units + decimals. */
export interface TokenAmount {
  readonly asset: Asset;
  /** Raw integer base units (never a float). */
  readonly amount: bigint;
  readonly decimals: number;
  /**
   * Immutable hard maximum the (pause-only, timelocked) multisig may raise this
   * cap UP TO — never exceedable even by a compromised multisig (§4). Omitted
   * where policy-schema.md §4 gives no separate ceiling (session caps).
   */
  readonly ceiling?: bigint;
}

/** policy-schema.md §4 — the five caps (G2). */
export interface PolicyCaps {
  /** Per-user vault TVL cap; checked against post-action position. Inflow only. */
  readonly perUserTvl: TokenAmount;
  /** Aggregate protocol cap; checked against `Vault.totalAssets()`. Inflow only. */
  readonly totalProtocol: TokenAmount;
  /** Vault deposit cap; checked against `Vault.totalAssets()`. Inflow only. */
  readonly vaultDeposit: TokenAmount;
  /** Per-UserOp notional cap for the session-key path. Session inflow/outflow. */
  readonly sessionPerTx: TokenAmount;
  /** Running `spent + notional` ceiling for the session-key path. */
  readonly sessionCumulative: TokenAmount;
}

/** policy-schema.md §5 — slippage config (G4). Applies to swaps only. */
export interface SlippageConfig {
  /** Default per-user max slippage (from mandate.riskParams); overridable DOWN only. */
  readonly userMaxBps: number;
  /** Hard floor honored by the session-key path (PolicyModule). */
  readonly protocolFloorBps: number;
  /** A user can never set an automated-swap max above this. */
  readonly absoluteCeilingBps: number;
  /** Actions slippage applies to — swaps only; custody ops have no price dependency. */
  readonly appliesTo: readonly ActionType[];
}

/**
 * policy-schema.md §3 — one closed `(protocol, target, selector, constraints)`
 * allowlist entry. Matched by decoded calldata off-chain and by
 * `PolicyModule.isAllowedTarget(target, selector)` on-chain — address+selector
 * level, never name level (§0.3).
 */
export interface AllowlistEntry {
  readonly protocol: Protocol;
  /** Symbolic target; resolve to a concrete address via `addresses[chainId]`. */
  readonly targetRef: TargetRef;
  /** 4-byte selector of the single permitted entrypoint. */
  readonly selector: Selector;
  readonly action: ActionType;
  readonly direction: Direction;
  /** Assets valid for this (target, selector). */
  readonly assets: readonly Asset[];
  /** Recipient field forced to the user's account (N1). */
  readonly recipientMustBe: RecipientPin;
  /** True ⇒ cap-gated on inflow/outflow (§4). Exits are never cap-gated (N2). */
  readonly capGated: boolean;
  /** True ⇒ pause-gated on inflow/outflow. Exits are never pause-gated (N2). */
  readonly pauseGated: boolean;
  /** Swaps only: `amountOutMin` must honor the slippage floor (§5). */
  readonly slippageBound?: boolean;
  /** Swaps only: `Route[]` factory constrained to this whitelisted factory (§3). */
  readonly routeFactoryMustBe?: TargetRef;
  /**
   * True ⇒ the target is not deployed on this chain and is a TODO_VERIFY
   * placeholder (e.g. Aerodrome on Base Sepolia). Fail-closed: entries flagged
   * `undeployed` are EXCLUDED from the resolved allowlist returned by
   * `getPolicyConstants`, so an action against them correctly fails allowlisting.
   */
  readonly undeployed?: boolean;
}

/** policy-schema.md §6 — bounds a session-key grant is validated against (N4). */
export interface SessionBounds {
  /** `validUntil - validAfter ≤ this`. No infinite session. */
  readonly maxSessionDurationDays: number;
  /** A session allowlist must be a subset of the global §3 allowlist (narrow-only). */
  readonly allowlistMustBeSubsetOfGlobal: boolean;
  /**
   * Selectors a session key can NEVER be seeded with — self-granting spend power
   * or reaching unknown code (§3 explicitlyForbidden, §6 rule 6). `0x` denotes an
   * arbitrary/empty-calldata `call`, which is likewise never allowlisted.
   */
  readonly forbiddenSelectors: readonly Selector[];
}

/**
 * policy-schema.md §4.1 / smart-contracts.md §6.1 — the ONLY mutable governance
 * bound beyond pause/caps. Included here so the vault constructor + T098 drift
 * check share one source for the default rate and the immutable hard cap.
 */
export interface GovernanceParams {
  readonly performanceFee: {
    /** Default rate at launch: 1000 bps (10%). */
    readonly defaultBps: number;
    /** Immutable hard cap: 2000 bps (20%) — MAX_PERFORMANCE_FEE_BPS. Never exceedable. */
    readonly ceilingBps: number;
  };
}

/** The per-chain policy bundle returned by `getPolicyConstants`. */
export interface PolicyConstants {
  readonly policyVersion: PolicyVersion;
  readonly chainId: number;
  readonly caps: PolicyCaps;
  readonly slippage: SlippageConfig;
  /** Resolved allowlist — `undeployed` entries are already filtered out (fail-closed). */
  readonly allowlist: readonly AllowlistEntry[];
  readonly sessionBounds: SessionBounds;
  readonly governance: GovernanceParams;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Chain-independent constants (§4 caps, §5 slippage, §6 bounds, §4.1 governance).
 * The spec gives single values for all chains; only the allowlist varies by chain.
 * ──────────────────────────────────────────────────────────────────────────── */

/** policy-schema.md §4 — caps in raw USDC base units (6 dp). */
const CAPS: PolicyCaps = {
  // 5,000 USDC per user; ceiling 10,000 USDC.
  perUserTvl: { asset: Asset.USDC, amount: 5_000_000_000n, decimals: 6, ceiling: 10_000_000_000n },
  // 1,000,000 USDC total; ceiling 5,000,000 USDC.
  totalProtocol: {
    asset: Asset.USDC,
    amount: 1_000_000_000_000n,
    decimals: 6,
    ceiling: 5_000_000_000_000n,
  },
  // 1,000,000 USDC vault deposit cap; ceiling 5,000,000 USDC.
  vaultDeposit: {
    asset: Asset.USDC,
    amount: 1_000_000_000_000n,
    decimals: 6,
    ceiling: 5_000_000_000_000n,
  },
  // 500 USDC per session UserOp. §4 gives no separate ceiling (a grant may only narrow, §6.4).
  sessionPerTx: { asset: Asset.USDC, amount: 500_000_000n, decimals: 6 },
  // 5,000 USDC lifetime per session key. §4 gives no separate ceiling.
  sessionCumulative: { asset: Asset.USDC, amount: 5_000_000_000n, decimals: 6 },
};

/** policy-schema.md §5 — slippage floors/ceilings (bps). Swaps only. */
const SLIPPAGE: SlippageConfig = {
  userMaxBps: 50,
  protocolFloorBps: 50,
  absoluteCeilingBps: 300,
  appliesTo: [ActionType.AerodromeSwap],
};

/** policy-schema.md §6 — session-scope bounds (N4). */
const SESSION_BOUNDS: SessionBounds = {
  maxSessionDurationDays: 30,
  allowlistMustBeSubsetOfGlobal: true,
  forbiddenSelectors: [
    "0x095ea7b3", // approve(address,uint256)          — never self-grant spend power (N1/N4)
    "0xa9059cbb", // transfer(address,uint256)         — never move funds to a non-user recipient
    "0x23b872dd", // transferFrom(address,address,uint256)
    "0x", // arbitrary / empty-calldata call     — never reach unknown code
  ],
};

/** policy-schema.md §4.1 / smart-contracts.md §6.1 — profit-only performance fee bound. */
const GOVERNANCE: GovernanceParams = {
  performanceFee: { defaultBps: 1000, ceilingBps: 2000 },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Allowlist tables (policy-schema.md §3). Selectors verified with `cast sig`.
 * `session_key_grant` / `session_key_revoke` are account-level ops
 * (authorizeSessionKey / revokeSessionKey on SparkPointAccount), NOT protocol
 * (target,selector) entrypoints, so they are intentionally absent here.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Base mainnet (8453) allowlist. Also used verbatim by the localFork (31337)
 * Anvil fork of Base mainnet (R14 — localFork uses the Base-mainnet targets).
 *
 * ETH note (§3): `assets: [USDC, ETH]` on the Aave entries covers USDC and WETH
 * (the ERC-20 "ETH" asset) supplied/withdrawn directly through the Pool. Native
 * ETH via the WrappedTokenGatewayV3 is a SEPARATE (target,selector) entry per
 * §3; its gateway address is unconfirmed at authoring, so that dedicated entry
 * is deferred (TODO_VERIFY — add gateway target + depositETH/withdrawETH
 * selectors once the gateway address is pinned; smart-contracts.md §7 gates
 * native-ETH behind that flag).
 */
const BASE_MAINNET_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    protocol: Protocol.SparkPointVault,
    targetRef: "sparkpoint_vault",
    selector: "0x6e553f65", // deposit(uint256,address)
    action: ActionType.VaultDeposit,
    direction: Direction.Inflow,
    assets: [Asset.USDC],
    recipientMustBe: "user_account",
    capGated: true,
    pauseGated: true,
  },
  {
    protocol: Protocol.SparkPointVault,
    targetRef: "sparkpoint_vault",
    selector: "0xba087652", // redeem(uint256,address,address)
    action: ActionType.VaultRedeem,
    direction: Direction.Exit,
    assets: [Asset.USDC],
    recipientMustBe: "user_account",
    capGated: false, // N2 — exit is never gated
    pauseGated: false,
  },
  {
    protocol: Protocol.SparkPointVault,
    targetRef: "sparkpoint_vault",
    selector: "0xb460af94", // withdraw(uint256,address,address)
    action: ActionType.VaultWithdraw,
    direction: Direction.Exit,
    assets: [Asset.USDC],
    recipientMustBe: "user_account",
    capGated: false, // N2
    pauseGated: false,
  },
  {
    protocol: Protocol.AaveV3,
    targetRef: "aave_v3_pool",
    selector: "0x617ba037", // supply(address,uint256,address,uint16)
    action: ActionType.AaveSupply,
    direction: Direction.Inflow,
    assets: [Asset.USDC, Asset.ETH], // onBehalfOf forced to account; native ETH gateway is a separate deferred entry
    recipientMustBe: "user_account",
    capGated: true,
    pauseGated: true,
  },
  {
    protocol: Protocol.AaveV3,
    targetRef: "aave_v3_pool",
    selector: "0x69328dec", // withdraw(address,uint256,address)
    action: ActionType.AaveWithdraw,
    direction: Direction.Exit,
    assets: [Asset.USDC, Asset.ETH],
    recipientMustBe: "user_account",
    capGated: false, // N2
    pauseGated: false,
  },
  {
    protocol: Protocol.Aerodrome,
    targetRef: "aerodrome_router",
    // swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)
    // Route = {from,to,stable,factory}; selector verified with `cast sig` (smart-contracts.md §7).
    selector: "0xcac88ea9",
    action: ActionType.AerodromeSwap,
    direction: Direction.Outflow,
    assets: [Asset.USDC, Asset.ETH],
    recipientMustBe: "user_account",
    capGated: true,
    pauseGated: true,
    slippageBound: true,
    routeFactoryMustBe: "aerodrome_factory", // routes constrained to the whitelisted factory (§3)
  },
];

/**
 * Base Sepolia (84532) allowlist.
 *
 * Aerodrome has NO Base-Sepolia deployment, so its swap entry is flagged
 * `undeployed` (TODO_VERIFY — swaps are fork-only) and is EXCLUDED from the
 * resolved allowlist (fail-closed: an Aerodrome swap on Sepolia correctly fails
 * PROTOCOL_NOT_ALLOWLISTED). Vault + Aave entries carry the same selectors as
 * mainnet; their concrete Sepolia addresses live in the address book.
 */
const BASE_SEPOLIA_ALLOWLIST: readonly AllowlistEntry[] = [
  ...BASE_MAINNET_ALLOWLIST.filter((e) => e.protocol !== Protocol.Aerodrome),
  {
    protocol: Protocol.Aerodrome,
    targetRef: "aerodrome_router",
    selector: "0xcac88ea9",
    action: ActionType.AerodromeSwap,
    direction: Direction.Outflow,
    assets: [Asset.USDC, Asset.ETH],
    recipientMustBe: "user_account",
    capGated: true,
    pauseGated: true,
    slippageBound: true,
    routeFactoryMustBe: "aerodrome_factory",
    undeployed: true, // TODO_VERIFY: no Aerodrome on Base Sepolia — fork-only; excluded from resolved allowlist
  },
];

/**
 * §B3 — Robinhood testnet (46630): EMPTY allowlist by design. The vault is Base-only and the only
 * Aave-like venue here is an unofficial, resettable "stock market" pilot we must NEVER target. An
 * empty allowlist makes every action fail allowlisting (fail-closed), so a BUILD_ACTION on 46630
 * correctly refuses with "not supported on this network".
 */
const ROBINHOOD_TESTNET_ALLOWLIST: readonly AllowlistEntry[] = [];

/** Raw (unfiltered) allowlist table per chain — includes `undeployed` placeholders. */
const ALLOWLIST_BY_CHAIN: Readonly<Record<number, readonly AllowlistEntry[]>> = {
  [CHAIN_ID.base]: BASE_MAINNET_ALLOWLIST,
  [CHAIN_ID.baseSepolia]: BASE_SEPOLIA_ALLOWLIST,
  [CHAIN_ID.localFork]: BASE_MAINNET_ALLOWLIST, // Anvil fork of Base mainnet (R14)
  [CHAIN_ID.robinhoodTestnet]: ROBINHOOD_TESTNET_ALLOWLIST, // §B3 vault Base-only ⇒ empty (fail-closed)
};

/* ────────────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The per-chain policy constant bundle (R14). The allowlist is keyed by
 * `chainId` (8453 · 84532 · 31337-localFork); caps, slippage, session bounds,
 * and governance are chain-independent per the spec.
 *
 * The returned `allowlist` is fail-closed: `undeployed` placeholder entries are
 * filtered out, so an action against an undeployed target correctly fails
 * allowlisting rather than being silently permitted.
 *
 * @throws if `chainId` is not one of the supported chains (fail-closed).
 */
export function getPolicyConstants(chainId: number): PolicyConstants {
  const allowlist = ALLOWLIST_BY_CHAIN[chainId];
  if (allowlist === undefined) {
    throw new Error(
      `getPolicyConstants: unsupported chainId ${chainId} (supported: ${Object.values(CHAIN_ID).join(", ")})`,
    );
  }
  return {
    policyVersion: POLICY_VERSION,
    chainId,
    caps: CAPS,
    slippage: SLIPPAGE,
    allowlist: allowlist.filter((e) => e.undeployed !== true),
    sessionBounds: SESSION_BOUNDS,
    governance: GOVERNANCE,
  };
}

/** The set of chain ids `getPolicyConstants` accepts. */
export const SUPPORTED_CHAIN_IDS: readonly number[] = Object.values(CHAIN_ID);
