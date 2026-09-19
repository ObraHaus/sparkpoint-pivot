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

/** The networks this registry is parameterized for (R14 · §B3 adds Robinhood testnet; §B adds mainnet). */
export type Network = "base" | "baseSepolia" | "localFork" | "robinhoodTestnet" | "robinhoodMainnet";

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

  /**
   * §fee-router (047 · W.7) — the beta **swap fee-router**: a user-signed UUPS contract in front of
   * the external Uniswap V3 `SwapRouter02` that charges the protocol's 0.20% on the **input side**
   * and sends it to the `RevenueSplitter` (ETH via `receive()`, ERC-20 via `sweepToken`). A PLAIN
   * optional field (NOT a policy `TargetRef`): the swap is user-signed / non-custodial, and the app
   * binds it only to build the swap call and to disclose the fee + its destination before signing.
   * Undefined ⇒ no fee-router on this chain: the swap keeps routing straight to
   * `uniswapV3SwapRouter02` and nothing changes (alpha byte-identical).
   */
  readonly feeRouter?: Address;

  /**
   * §premium (012) — the SRK utility-token venue on this chain (Premium is paid in SRK). A PLAIN optional
   * field (NOT a policy `TargetRef`): where unset, the pay surface shows an honest "unavailable" state
   * rather than a fabricated value. Base-Sepolia-only for now (the vault + Premium live on 84532).
   */
  readonly srk?: Address;
  /**
   * §premium (012) — the disclosed recipient of SRK Premium payments on this chain (the feature-014 fee
   * Safe where it exists, else the deployer EOA with a recorded cutover note). PLAIN optional field, no
   * `TargetRef` / parity impact. A user-signed transfer target only; it holds no authority over user funds.
   */
  readonly premiumTreasury?: Address;
  /**
   * §faucet (026) — the standalone `SrkFaucet` dispenser on this chain: a pre-funded contract that
   * hands testers a fixed amount of the SRK utility token on a per-address cooldown, so they can try
   * the Premium purchase. A PLAIN optional field (NOT a policy `TargetRef`) — it is a user-signed
   * `claim()` target that holds only its own float and has zero authority over user funds.
   * Undefined ⇒ no faucet on this chain and the Premium page says so honestly rather than offering a
   * button that cannot work. Testnet-only by nature (SRK has a fixed supply and is hand-distributed).
   */
  readonly srkFaucet?: Address;
  /**
   * §broker (043) — the deployed `SparkyBroker` ERC-721 on this chain. A membership NFT, NOT a vault
   * or a yield position: it affects the Premium tier and nothing else. A PLAIN optional field, never
   * a policy `TargetRef` — no agent path reaches it. Undefined ⇒ the broker surfaces say so honestly
   * rather than rendering an empty gallery.
   */
  readonly brokerNft?: Address;
  /**
   * §broker (043) — `BrokerActivationRegistry`, the NFT's `activator`: retires SRK and flips
   * activation in ONE user-signed transaction. Holds no broker and no SRK.
   *
   * ⚠️ **Re-pointing the NFT's `activator` orphans every activation the previous registry recorded**,
   * and there is no on-chain recovery (the NFT still reports those tokens activated, so `activate`
   * reverts). The agent therefore reads a LIST of registries — see `BROKER_REGISTRY_ADDRESS` — and a
   * superseded address must never be dropped from it. This field names the CURRENT one, for the app's
   * write path only.
   */
  readonly brokerRegistry?: Address;
  /**
   * §broker (043) — `BrokerSale`, the NFT's `minter`. Free and open, bounded by an owner-settable
   * per-wallet cap; the collection's immutable 10,000 supply cap lives on the NFT.
   */
  readonly brokerSale?: Address;
  /**
   * §broker (044) — `BrokerRevenueDistributor`, the pot that pays activated broker holders.
   *
   * ⚠️ Deployed does NOT mean live. `claim` reverts until `publishAllocations` is called, so it
   * ships in an off state that needs no flag to hold it there — and deliberately has no pause
   * switch, which would mean the owner could freeze holders' claims. Undefined ⇒ the claim surface
   * says revenue share is unavailable on this network, which is the honest answer.
   *
   * It has no withdraw, sweep, rescue or migrate path for anyone, including its owner. The only way
   * value leaves is a holder claiming their own published allocation.
   */
  readonly brokerRevenueDistributor?: Address;
  /* ── §beta-revenue (Phase 2 · Robinhood 4663 ONLY) — the SparkPoint-authored revenue subsystem. ──
   * Deployed 2026-09-16 as the BETA set (verified on-chain). Alpha (Base Sepolia) keeps its
   * existing Broker/SRK surfaces and never reads these. PLAIN optional fields — NO policy
   * `TargetRef`, so no agent-mediated path can form: every interaction is either user-signed
   * (activate/promote/fuse/withdraw) or a permissionless keeper call (settle/deliver/sweeps).
   * Undefined ⇒ the beta surfaces must say "not on this network yet" (fail-closed). Every address
   * mirrors `contracts/deployments/4663/addresses.json`. */
  /** The Pons-launched utility token (OZ `ERC20Burnable`; the engine burns it via `burnFrom`). */
  readonly utilityToken?: Address;
  /** The `BrokerEngine` PROXY — activate/promote/fuse + the AS-IS per-asset revenue accumulator. */
  readonly brokerEngine?: Address;
  /** The immutable `BrokerVault` — per-token-id, multi-asset (ETH = `address(0)`) + EIP-712 withdraw. */
  readonly brokerVault?: Address;
  /** The immutable `RevenueSplitter` — the Pons `creatorFeeRecipient` (90% engine / 10% treasury). */
  readonly revenueSplitter?: Address;
  /** The immutable `RoyaltySink` — the OpenSea royalty recipient; flushes to the splitter. */
  readonly royaltySink?: Address;
  /** The address the `RevenueSplitter`'s immutable `treasury` points at — its 10% share (mirrors
   * `beta.treasury` in `contracts/deployments/4663/addresses.json`). */
  readonly revenueTreasury?: Address;
  /** The Pons bonding curve for the utility token — the sweeper's `sweepFees` target pre-graduation. */
  readonly ponsCurve?: Address;
  /** Pons' `V2FeeEscrow` — where curve/hook fees are credited and `claim()`ed by the splitter. */
  readonly ponsFeeEscrow?: Address;

  /**
   * §fee-treasury (014) — the dedicated multisig Safe that receives ALL protocol fees on this chain
   * (perf fee + the Base swap fee follow the vault's on-chain feeRecipient(); premium pays here too).
   * A PLAIN optional field, NOT a policy `TargetRef`. A plain holder — zero fund-movement power (N5).
   */
  readonly feeTreasury?: Address;

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
   * The 2-of-3 Gnosis Safe that CONTROLS the guardian timelock (holds its PROPOSER/EXECUTOR/CANCELLER
   * roles after the deployer full-renounce). The vault's `guardian()` stays the timelock; this Safe is
   * who signs the timelocked pause/unpause/setFee/setCaps actions (§6.2 multisig kill-switch, N5).
   * Optional so the module stays drift-safe; undefined ⇒ the page shows the timelock only.
   */
  readonly governanceSafe?: Address;
  /**
   * `SparkPointVaultFactory` (feature 011) — the deploy-only CREATE2 registrar of branded
   * Morpho-wrapper vaults. A PLAIN address-book field, **NOT** a policy `TargetRef`: the factory is
   * admin/timelock-gated and never on the agent policy path, and (constitution IV.5(d)) its curated
   * Morpho allowlist is consulted ONLY at deploy time — never by the policy engine. Undefined ⇒ not
   * yet deployed on this chain.
   */
  readonly sparkPointVaultFactory?: Address;
  /**
   * `SparkPointVaultFactoryV3` (feature 049, constitution v4.1.0) — the admission-gateway factory on
   * Robinhood Chain 4663: OpenZeppelin `AccessControl` (the TimelockController is role admin and
   * governs non-admission params only, the operator EOA admits/deploys instantly, the scoped AI
   * deployer admits subject to an on-chain cooling-off window), one wrapper per child enforced
   * on-chain. A PLAIN address-book field, **NOT** a policy `TargetRef`. Undefined ⇒ not deployed on
   * this chain.
   */
  readonly sparkPointVaultFactoryV3?: Address;
  /**
   * The `TimelockController` owning the wrapper beacon and the V3 factory's ProxyAdmin (feature 049)
   * — the ONLY code/proxy upgrade authority, and never an admission role on V3. Display/disclosure
   * only; **NOT** a policy `TargetRef`. Undefined ⇒ no wrapper fleet on this chain.
   */
  readonly sparkPointVaultTimelock?: Address;
  /**
   * The `UpgradeableBeacon` behind every wrapper (feature 049) — the timelock-owned implementation
   * authority for `SparkPointUniversalVault`. Display/disclosure only; **NOT** a policy `TargetRef`.
   */
  readonly sparkPointVaultBeacon?: Address;
  /**
   * Curated Morpho ERC-4626 vaults (feature 011) the factory may wrap on this chain — a vetted display
   * list for the app / 010 reader; **NOT** policy `TargetRef`s. Empty/undefined ⇒ none curated yet
   * (e.g. Base Sepolia, where Morpho has no ready curated vaults with real TVL/liquidity).
   */
  readonly curatedMorphoVaults?: readonly Address[];
  /**
   * Deployed `SparkPointMorphoVault` wrapper INSTANCES (feature 011) live on this chain — a curated
   * DISPLAY list that powers the app's vault picker. Distinct from {@link curatedMorphoVaults} (the
   * UNDERLYING Morpho targets a factory may wrap): these are SparkPoint's OWN branded wrapper
   * addresses. **NOT** policy `TargetRef`s. Undefined/empty ⇒ launch vault only (byte-identical).
   */
  readonly sparkPointWrappers?: readonly SparkPointWrapper[];
  /**
   * Morpho's own `VaultV2Factory` on this chain (feature 024) — the contract that CREATED our Vault V2
   * Fee Wrappers, and the only acceptable provenance root for one (`isVaultV2(address)`). Distinct from
   * {@link sparkPointVaultFactory}, which registers SparkPoint's own bespoke wrappers (superseded for
   * new deploys by constitution v3.0.0). Undefined ⇒ Morpho has no V2 factory on this chain.
   */
  readonly morphoVaultV2Factory?: Address;
  /**
   * Deployed **Morpho Vault V2 Fee Wrapper** instances (feature 024, constitution v3.0.0) — Morpho's
   * own audited vault contract, configured by us, NOT SparkPoint custody Solidity. A curated DISPLAY
   * list, **NOT** policy `TargetRef`s. Undefined/empty ⇒ none on this chain.
   */
  readonly morphoFeeWrappers?: readonly MorphoFeeWrapper[];
}

/**
 * A deployed branded Morpho-wrapper vault instance (feature 011) — one display entry for the vault
 * picker. `address` is the `SparkPointMorphoVault`; `morphoVault` is its immutable underlying target
 * (informational — the app reads `morphoVault()` live). **NOT** a policy `TargetRef`.
 */
export interface SparkPointWrapper {
  readonly address: Address;
  readonly label: string;
  readonly symbol?: string;
  readonly morphoVault?: Address;
  /**
   * RETIRED (feature 024): the wrapper is still deployed and still fully redeemable on-chain, but
   * SparkPoint no longer offers DEPOSITS into it. Deposit fail-closes in `deriveVaultConfirm`
   * (`depositSignable === false`, CTA "Vault retired"); withdraw/redeem and the portfolio row are
   * deliberately UNTOUCHED — N2 says only underlying liquidity may ever block an exit, never us.
   * Retiring is a display/authorization decision here; the on-chain contract is immutable and a
   * holder can always redeem directly, backend-independent.
   */
  readonly retired?: boolean;
  /** Why it was retired — surfaced in the picker tooltip + the Trust Center so the reason is public. */
  readonly retiredReason?: string;
}

/**
 * A deployed **Morpho Vault V2 Fee Wrapper** (feature 024) — one display entry for the vault picker.
 *
 * Deliberately NOT reusing {@link SparkPointWrapper}: the two are different contracts with different
 * ABIs, and conflating them is exactly how a reverting read reaches production. A Vault V2 exposes
 * NONE of `label()` / `morphoVault()` / `factory()` / `isSparkPointVault()` / `highWaterMark()` /
 * `paused()`, so the wrapper-only reads in `useVault` must never be pointed at one.
 */
export interface MorphoFeeWrapper {
  /** The Vault V2 itself — what a user's deposit/withdraw actually targets. */
  readonly address: Address;
  /** Display label. A V2 has no on-chain `label()`, so unlike a wrapper this is the ONLY source. */
  readonly label: string;
  /** The V2's own `symbol()` (set by us via `setSymbol`). */
  readonly symbol?: string;
  /**
   * The vault's immutable allocation route — a `MorphoMarketV1AdapterV2` bound to this vault at
   * creation. This is the auditable "what is underneath", standing in for a child vault: on Base
   * Sepolia the canonical `MorphoVaultV1AdapterFactory` fee-wrapper path does not exist, so the V2
   * allocates into a Morpho **Blue market** through this adapter rather than into a child V1 vault.
   */
  readonly adapter: Address;
  /**
   * The Blue market id the adapter allocates into (informational; `bytes32` hex). Present only for an
   * adapter-into-market wrapper, absent for a child-vault wrapper.
   */
  readonly marketId?: string;
  /**
   * The vault's `asset()`. REQUIRED and never inferred from the chain's `usdc` field: Base Sepolia has
   * TWO tokens that both report `symbol() == "USDC"` at 6 dp — Aave's `0xba50Cd2A…` (the address
   * book's `usdc`) and Circle's `0x036CbD53…`, which is what Morpho's markets use. They are NOT
   * interchangeable, and a Fee Wrapper's asset is the Circle one.
   */
  readonly asset: Address;
  /** The ASSET's decimals (6 for USDC) — what deposit/withdraw amounts are denominated in. */
  readonly assetDecimals: number;
  /**
   * The vault's SHARE decimals — **18** on a Vault V2 over a 6-dp asset, because V2 applies a
   * decimals offset (`virtualShares() == 1e12`). These are stored separately from
   * {@link assetDecimals} precisely because assuming they match is a 1e12 mis-scale on every
   * displayed amount. Any consumer that scales an ASSET amount must use `assetDecimals`.
   */
  readonly shareDecimals: number;
  /** RETIRED — deposits closed, withdraw/redeem deliberately untouched (N2). See SparkPointWrapper. */
  readonly retired?: boolean;
  /** Why it was retired — public, same rationale as {@link SparkPointWrapper.retiredReason}. */
  readonly retiredReason?: string;
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
