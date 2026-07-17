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
