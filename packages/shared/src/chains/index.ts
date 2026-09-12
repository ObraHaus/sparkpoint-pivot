/**
 * Chain metadata — the ONE source of truth for a chain's id, display name, explorer root, and what
 * SparkPoint actually offers on it (024).
 *
 * WHAT THIS FIXES. `CHAIN_ID` in `policy/constants.ts` was already the canonical chain-ID registry,
 * but it carries ids and addresses ONLY — no name, no explorer, no "is this a testnet". So every
 * consumer grew its own copy, and they drifted:
 *
 *   * THREE independent chainId→explorer maps (`lib/chain/explorer.ts`, `lib/network.tsx`, plus
 *     per-file helpers in `ExecutionDrawer.tsx` and `app/exit/page.tsx`), on top of ~18 hard-coded
 *     `https://sepolia.basescan.org` string literals;
 *   * display names duplicated in eight places (`network.tsx`'s `chainName()`, `verify/page.tsx`,
 *     `admin/diagnostics`, `portfolio`, `swap`, `useSwapConfirm`, `inline-swap-confirm`);
 *   * `SUPPORTED` / `SWITCHABLE` / `PREFERRED_CHAIN` re-derived in `network.tsx` independently of
 *     the list `wagmi.ts` actually registers, so the two could disagree about which chains exist.
 *
 * WHY THIS FILE IS A LEAF, AND MUST STAY ONE. `apps/web`'s unit tests run under
 * `node --experimental-strip-types`, which CANNOT resolve the other shared barrels: they use
 * extensionless relative specifiers (`from "./enums"`) and `policy/enums.ts` uses a TS `enum`
 * (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` in strip-only mode). So every test-reachable web module
 * imports shared `type`-only today. This module is deliberately different: plain `as const` objects,
 * NO relative imports of any kind, NO enums, no dependency on viem/wagmi. That is what lets a web
 * unit test import it as a VALUE. Adding an import here would silently break those tests.
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 *   * RPC URLs — they are per-environment secrets, not static metadata (`lib/chain/clients.ts` and
 *     `wagmi.ts` own them, from env).
 *   * The viem/wagmi `Chain` object — that would make this file depend on those packages and stop it
 *     being a leaf. `wagmi.ts` maps id → `Chain` itself and asserts coverage against this list.
 *   * Vault addresses and decimals — those live in `addresses/` and, from 024, in `vault_registry`.
 *     Decimals especially must NOT be hoisted here: `useVault` reads `decimals()` live per vault
 *     precisely so a non-6dp asset scales correctly.
 */

/** Chain ids SparkPoint knows. Mirrors `CHAIN_ID` in `policy/constants.ts` — see the parity test. */
export const CHAIN_IDS = {
  base: 8453,
  baseSepolia: 84532,
  localFork: 31337,
  robinhoodTestnet: 46630,
  /**
   * Robinhood Chain MAINNET, ratified by constitution v3.0.0 (D3). Declared here so the id has one
   * home, but note it is NOT yet wired: it has no address book, is absent from the policy chain map,
   * and `API_SUPPORTED_CHAIN_IDS` in the agent rejects it. `offersVault` is false accordingly —
   * feature 024 Phase 5 turns it on. Listing an id is not the same as offering a product on it.
   */
  robinhoodMainnet: 4663,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

/** What SparkPoint offers on a chain, and how to talk about it. */
export interface ChainMeta {
  readonly chainId: number;
  /** Address-book slug (`AddressBook.network`). */
  readonly slug: string;
  /** Human display name — the ONLY place a chain's name is written. */
  readonly name: string;
  /** Explorer root, no trailing slash. `undefined` ⇒ no public explorer (local fork). */
  readonly explorerRoot?: string;
  /** True for a test network. Drives "≈0% (testnet)" and "unavailable — testnet" copy. */
  readonly testnet: boolean;
  /** Brand colour for the network chip. */
  readonly color: string;
  /** Whether a SparkPoint VAULT is offered here (chat/swap availability is separate). */
  readonly offersVault: boolean;
  /** Whether the in-app network switcher offers this chain. */
  readonly switchable: boolean;
}

/**
 * Per-chain metadata.
 *
 * `offersVault` is the honest capability flag, not an aspiration. Robinhood testnet 46630 has no
 * Morpho deployment of ANY kind (verified on-chain 2026-07-30) and must never be given a mock
 * substitute (v3.0.0, D3), so its vault path stays fail-closed. Robinhood mainnet 4663 has real
 * Morpho but no SparkPoint deployment yet, and both mainnets are gated on the external audit.
 */
export const CHAIN_META: Readonly<Record<number, ChainMeta>> = {
  [CHAIN_IDS.base]: {
    chainId: CHAIN_IDS.base,
    slug: "base",
    name: "Base",
    explorerRoot: "https://basescan.org",
    testnet: false,
    color: "#0052FF",
    // Gated on the external audit (constitution: full audit gates BOTH mainnets).
    offersVault: false,
    switchable: false,
  },
  [CHAIN_IDS.baseSepolia]: {
    chainId: CHAIN_IDS.baseSepolia,
    slug: "baseSepolia",
    name: "Base Sepolia",
    explorerRoot: "https://sepolia.basescan.org",
    testnet: true,
    color: "#0052FF",
    offersVault: true,
    switchable: true,
  },
  [CHAIN_IDS.localFork]: {
    chainId: CHAIN_IDS.localFork,
    slug: "localFork",
    name: "Local Fork",
    // No public explorer — callers must render a non-link rather than fabricate a URL.
    explorerRoot: undefined,
    testnet: true,
    color: "#64748b",
    offersVault: true,
    switchable: false,
  },
  [CHAIN_IDS.robinhoodTestnet]: {
    chainId: CHAIN_IDS.robinhoodTestnet,
    slug: "robinhoodTestnet",
    name: "Robinhood Testnet",
    explorerRoot: "https://explorer.testnet.chain.robinhood.com",
    testnet: true,
    color: "#00C805",
    // NO Morpho and no Aave on 46630 — swap only, vault fail-closed. Never a mock stand-in.
    offersVault: false,
    switchable: true,
  },
  [CHAIN_IDS.robinhoodMainnet]: {
    chainId: CHAIN_IDS.robinhoodMainnet,
    slug: "robinhoodMainnet",
    name: "Robinhood Chain",
    explorerRoot: "https://explorer.mainnet.chain.robinhood.com",
    testnet: false,
    color: "#00C805",
    // §B beta (Phase 1): the ONLY chain the mainnet beta serves. No vault (Base-only); the swap is
    // the user-signed Uniswap V3 path (address book wired + verified). Switchable so the wallet can
    // operate on it; the agent's 4663 policy allowlist stays empty (fail-closed).
    offersVault: false,
    switchable: true,
  },
} as const;

/**
 * The chain the app prefers when a wallet is off-network — the chain the develop vault lives on.
 * Single source for what was `PREFERRED_CHAIN` in `network.tsx`.
 */
export const PREFERRED_CHAIN_ID: number = CHAIN_IDS.baseSepolia;

/** Every known chain id, ascending. */
export const ALL_CHAIN_IDS: readonly number[] = Object.values(CHAIN_IDS)
  .slice()
  .sort((a, b) => a - b);

/**
 * Metadata for `chainId`, or `undefined` when unknown.
 *
 * Returns `undefined` rather than throwing, and rather than defaulting to Base Sepolia. Both
 * alternatives are worse: `getAddresses`/`getPolicyConstants` throw because a missing ADDRESS must
 * fail closed, but a missing *display name* should degrade to "Unsupported network", and silently
 * substituting a different chain's explorer would produce a link to the wrong chain's transaction —
 * a fabricated reference (Principle III).
 */
export function chainMeta(chainId: number | undefined): ChainMeta | undefined {
  return chainId === undefined ? undefined : CHAIN_META[chainId];
}

/** Display name for `chainId`, or `"Unsupported network"`. */
export function chainName(chainId: number | undefined): string {
  return chainMeta(chainId)?.name ?? "Unsupported network";
}

/** True iff `chainId` is one SparkPoint supports at all. */
export function isSupportedChain(chainId: number | undefined): boolean {
  return chainMeta(chainId) !== undefined;
}

/** True iff `chainId` is a test network. Unknown chains are NOT assumed to be testnets. */
export function isTestnetChain(chainId: number | undefined): boolean {
  return chainMeta(chainId)?.testnet ?? false;
}

/** True iff a SparkPoint vault is offered on `chainId`. */
export function offersVault(chainId: number | undefined): boolean {
  return chainMeta(chainId)?.offersVault ?? false;
}

/** The chains the in-app network switcher offers, in declaration order. */
export const SWITCHABLE_CHAINS: readonly ChainMeta[] = ALL_CHAIN_IDS.map(
  (id) => CHAIN_META[id],
).filter((m): m is ChainMeta => m !== undefined && m.switchable);

/** The explorer root for `chainId`, or `undefined` when it has none. */
export function explorerRoot(chainId: number | undefined): string | undefined {
  return chainMeta(chainId)?.explorerRoot;
}

/** Explorer URL for a transaction, or `undefined` when the chain/hash can't be linked. */
export function explorerTxUrl(
  chainId: number | undefined,
  hash: string | undefined,
): string | undefined {
  const root = explorerRoot(chainId);
  return root === undefined || !hash ? undefined : `${root}/tx/${hash}`;
}

/** Explorer URL for an address, or `undefined` when the chain/address can't be linked. */
export function explorerAddressUrl(
  chainId: number | undefined,
  address: string | undefined,
): string | undefined {
  const root = explorerRoot(chainId);
  return root === undefined || !address ? undefined : `${root}/address/${address}`;
}
