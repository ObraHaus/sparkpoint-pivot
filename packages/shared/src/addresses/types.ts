/**
 * Per-chain address registry — the SINGLE place concrete on-chain addresses live
 * (R14 chain-parameterization). The policy allowlist (policy/constants.ts) is
 * authored against symbolic `TargetRef` names; the concrete `(target, selector)`
 * pair the on-chain `PolicyModule.isAllowedTarget` and the T098 drift check
 * compare is formed by joining a `TargetRef` → this address book via
 * `resolveTargetRef(chainId, ref)`. Addresses defined here exactly once ⇒ they
 * can never drift between the deploy scripts, the off-chain policy layer, and the
 * client policy mirror.
 *
 * Grounding:
 *   smart-contracts.md §1 (contract inventory: SparkPointAccount, AccountFactory,
 *     SessionKeyValidator, PolicyModule, SparkPointVault + supporting CapRegistry,
 *     KillSwitch/Guardian) and §7 (Aave v3 Pool + WrappedTokenGatewayV3, Aerodrome
 *     Router{from,to,stable,factory}).
 *   data-model.md — entity/field naming.
 *
 * Address policy (fail-closed): fields that are deploy-time-determined
 * (SparkPoint contracts) or not deployed on a given chain (Aerodrome on Base
 * Sepolia, the native-ETH gateway on testnet) are OPTIONAL `0x${string}`. An
 * unresolved (`undefined`) target cannot form a `(target, selector)` pair, so an
 * action against it correctly fails allowlisting rather than being silently
 * permitted — matching the `undeployed`-entry filtering in policy/constants.ts.
 */

import type { TargetRef } from "../policy/index";

/** A 20-byte EVM address. No `any` on chain-facing types (repo rule). */
export type Address = `0x${string}`;

/** The networks this registry is parameterized for (R14 · §B3 adds Robinhood testnet). */
export type Network = "base" | "baseSepolia" | "localFork" | "robinhoodTestnet";

/**
 * The concrete addresses for one chain. Protocol infra + tokens are always
 * present (required); Aerodrome, the native-ETH gateway, and the SparkPoint
 * contracts are optional because they are undeployed on some chains or are only
 * known after deploy (fail-closed when `undefined`).
 */
export interface AddressBook {
  /** The chain id these addresses belong to (8453 · 84532 · 31337). */
  readonly chainId: number;
  readonly network: Network;

  /* ── ERC-4337 infrastructure (smart-contracts.md §7 — EntryPoint v0.7) ── */
  /** The canonical EntryPoint v0.7 singleton the account pins as an immutable. */
  readonly entryPoint: Address;

  /* ── Aave v3 (smart-contracts.md §6/§7) ── */
  /** `IPool` — `supply`/`withdraw` target (TargetRef `aave_v3_pool`). */
  readonly aavePool: Address;
  /** The vault's interest-bearing aToken (`aUSDC`); `totalAssets()` reads its balance. */
  readonly aUsdc: Address;
  /**
   * The USDC the Aave Pool actually accepts as a reserve — the vault's `asset()`.
   * On Base mainnet this equals {@link AddressBook.usdc}; on Base Sepolia the Aave
   * market runs its OWN test USDC (the ONLY USDC that pool accepts), so it DIFFERS
   * from the canonical token and is the one the vault must be seeded with.
   */
  readonly reserveUsdc: Address;
  /**
   * `WrappedTokenGatewayV3` for the native-ETH Aave path (`depositETH`/`withdrawETH`,
   * smart-contracts.md §7). Optional: gated behind a flag / not pinned on every
   * chain. The dedicated gateway `(target, selector)` allowlist entry is deferred
   * (policy/constants.ts TODO_VERIFY) until this is confirmed per chain.
   */
  readonly wrappedTokenGateway?: Address;

  /* ── Aerodrome (smart-contracts.md §7 — Router{from,to,stable,factory}) ── */
  /** Aerodrome Router (TargetRef `aerodrome_router`). Undefined ⇒ undeployed (Base Sepolia). */
  readonly aerodromeRouter?: Address;
  /** Aerodrome PoolFactory the whitelisted `Route[].factory` must equal (TargetRef `aerodrome_factory`). */
  readonly aerodromeFactory?: Address;

  /* ── Uniswap V3 (§B-swap — the manual, client-signed swap page) ──
   * NOT policy `TargetRef`s (the swap page is user-signed / non-custodial, not an agent-proposed
   * action), so these are plain optional address fields with no `TARGET_REF_FIELD` / parity impact.
   * Undefined ⇒ Uniswap V3 not wired on this chain (the DEX selector shows it unavailable). */
  /** Uniswap V3 `SwapRouter02` — `exactInputSingle` / `multicall` target for user-signed swaps. */
  readonly uniswapV3SwapRouter02?: Address;
  /** Uniswap V3 `QuoterV2` — off-chain (`simulateContract`) quote source for the swap preview. */
  readonly uniswapV3QuoterV2?: Address;
  /** Uniswap V3 `UniswapV3Factory` — pool discovery (optional; QuoterV2 resolves pools internally). */
  readonly uniswapV3Factory?: Address;
  /**
   * §fee (007) — the routing-fee treasury for the user-signed swap on this chain. A PLAIN optional field
   * (NOT a policy `TargetRef`): where set it receives the 0.20% swap routing fee, letting the fee apply on
   * a chain with NO vault (e.g. Robinhood 46630). Where unset, the fee falls back to the vault's live
   * `feeRecipient()` (kept auditable on vault chains). A zero/unset value ⇒ no vault-independent recipient.
   */
  readonly swapFeeRecipient?: Address;

  /* ── ERC-20 tokens ── */
  /** Canonical USDC the app treats as `Asset.USDC` on this chain (== reserveUsdc where the Aave market uses it). */
  readonly usdc: Address;
  /** WETH (OP-stack predeploy on Base + Base Sepolia). */
  readonly weth: Address;

  /* ── Testnet utilities (NOT policy targets) ── */
  /**
   * The Aave-market faucet that mints the test USDC on a testnet — `mint(token,to,amount)` with
   * `token == usdc` (6dp, per-address mint timelock). Testnet-only convenience for the Faucets
   * panel; `undefined` where no such faucet exists (e.g. mainnet). Never a policy `TargetRef`.
   */
  readonly usdcFaucet?: Address;

  /* ── Deployed SparkPoint contracts (smart-contracts.md §1) ──
   * Deploy-time-determined; the deploy/arm scripts (`ArmGuardrails`) fill these.
   * Optional so this module has zero deploy-time coupling and stays drift-safe. */
  /** `SparkPointAccount` UUPS implementation (AccountFactory.accountImplementation()). */
  readonly sparkPointAccountImpl?: Address;
  /** `AccountFactory` — CREATE2 factory binding the user EOA owner (N3). */
  readonly accountFactory?: Address;
  /** `SessionKeyValidator` — ERC-4337 validator module (N4). */
  readonly sessionKeyValidator?: Address;
  /** `PolicyModule` — on-chain allowlist/caps registry (N4, G2, G5). */
  readonly policyModule?: Address;
  /** `SparkPointVault` — the ERC-4626 vault (TargetRef `sparkpoint_vault`). */
  readonly vault?: Address;
  /** `CapRegistry` — bounded param store for the caps (G2). */
  readonly capRegistry?: Address;
  /** `KillSwitch`/`Guardian` — PAUSE-ONLY controller (N5). */
  readonly killSwitch?: Address;
  /**
   * `SparkPointVaultFactory` (feature 011) — the deploy-only CREATE2 registrar of branded
   * Morpho-wrapper vaults. A PLAIN address-book field, **NOT** a policy `TargetRef`: the factory is
   * admin/timelock-gated and never on the agent policy path, and (constitution IV.5(d)) its curated
   * Morpho allowlist is consulted ONLY at deploy time — never by the policy engine. Undefined ⇒ not
   * yet deployed on this chain.
   */
  readonly sparkPointVaultFactory?: Address;
  /**
   * Curated Morpho ERC-4626 vaults (feature 011) the factory may wrap on this chain — a vetted display
   * list for the app / 010 reader; **NOT** policy `TargetRef`s. Empty/undefined ⇒ none curated yet
   * (e.g. Base Sepolia, where Morpho has no ready curated vaults with real TVL/liquidity).
   */
  readonly curatedMorphoVaults?: readonly Address[];
}

/**
 * Maps every policy `TargetRef` to the {@link AddressBook} field that resolves
 * it. `satisfies Record<TargetRef, keyof AddressBook>` makes TS fail the build if
 * a new `TargetRef` is added without a resolution field here (drift guard).
 */
export const TARGET_REF_FIELD = {
  sparkpoint_vault: "vault",
  aave_v3_pool: "aavePool",
  aerodrome_router: "aerodromeRouter",
  aerodrome_factory: "aerodromeFactory",
} as const satisfies Record<TargetRef, keyof AddressBook>;
