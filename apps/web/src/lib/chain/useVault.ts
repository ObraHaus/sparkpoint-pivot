"use client";

/**
 * useVault (T046 / T049) — the LIVE, DISPLAY/READ-plane view of the deployed
 * `SparkPointVault` for the connected account + chain.
 *
 * Every value here is read DIRECTLY over RPC through wagmi's configured transport
 * (react-query → the chain), never through the agent, the indexer, or any backend.
 * This is the read half of the non-custody stance (N1/N2): the chain is truth, and
 * the surfaces built on this hook — the vault dashboard, the NonCustody badge, the
 * caps meter, the deposit/withdraw previews — verify state independently of any
 * SparkPoint service. Nothing here signs, holds a key, or gates a withdrawal; it
 * only READS. The withdraw/exit path (src/lib/chain/exit.ts, /exit) never depends
 * on this hook.
 *
 * Fail-closed: when the vault is not deployed on the resolved chain (or no chain is
 * resolvable) the hook returns a clear `unavailable` reason and every read is
 * `undefined` — no fabricated address, no fabricated numbers. Consumers render a
 * "not deployed on this chain" notice from `unavailable` and MUST NOT gate the exit
 * path on it.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T046 (deposit/withdraw reads),
 * T049 (paused/caps/fees via RPC, display-only); agent-service-api.md §3.7 (net-of-
 * fee framing; ERC-4626 previews; rounding favors the vault). ABI: the T015 export
 * `sparkPointVaultAbi`. Addresses: `getAddresses(chainId).vault` (fail-closed).
 */

import { useCallback } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, type Address } from "viem";
import { sparkPointVaultAbi, capRegistryAbi } from "@sparkpoint/shared/abis";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { vaultAddressFor } from "@/lib/chain/exit";
import type { VaultFeeBasis } from "@/lib/policy/feeCopy";
import { morphoVaultV2Abi, wadToBpsCeil } from "@/lib/chain/morphoVaultV2Abi";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * Which vault this hook is reading. The conservative launch Aave vault is the DEFAULT (calling with
 * no `vaultAddress` resolves it, exactly as before). A `morpho_wrapper` is a branded, single-purpose
 * SparkPointMorphoVault over ONE curated Morpho vault — its yield is Morpho, NOT Aave (011 Phase 4).
 * A `morpho_fee_wrapper` is a **Morpho Vault V2 Fee Wrapper** (024, constitution v3.0.0) — Morpho's
 * own audited contract, not ours.
 *
 * The kinds differ in a way the USER must be told about, so `feeBasisForVaultKind` derives the
 * fee-disclosure basis from this union rather than letting each surface decide: our own vaults keep a
 * real `_highWaterMark`, and a Vault V2 keeps none (024/T024).
 */
export type VaultKind = "aave_launch" | "morpho_wrapper" | "morpho_fee_wrapper";

/**
 * The fee-disclosure basis implied by a vault kind — resolved CENTRALLY, never per call site.
 *
 * 024 Phase 0 is the cautionary tale: a per-site `retired` flag was forgotten once and Defender
 * caught a live deposit bypass through `/confirm/[intent]`, which mounts its own confirm hook. Fee
 * copy has exactly the same shape of risk, so the mapping lives here and the sites consume it.
 */
export function feeBasisForVaultKind(kind: VaultKind): VaultFeeBasis {
  return kind === "morpho_fee_wrapper" ? "per_period_gain" : "high_water_mark";
}

/**
 * The wrapper-only views (011). The 4626 + fee/pause spine is already covered by `sparkPointVaultAbi`
 * (a wrapper exposes the SparkPoint superset — abiKind 'sparkpoint'), so only these ADDITIVE reads are
 * declared here. Read-only, view-filtered — nothing signable, matching the file's non-custody stance.
 */
const morphoWrapperViewsAbi = [
  { type: "function", name: "label", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "morphoVault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

/**
 * Factory provenance attestation (011). 010's reader trusts a wrapper ONLY if the factory attests it
 * via `isSparkPointVault(address)`; an unattested address is refused (fail-closed) — never rendered as
 * a SparkPoint vault. A pure view read; the factory has no fund path.
 */
const vaultFactoryProvenanceAbi = [
  {
    type: "function",
    name: "isSparkPointVault",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * The chain-ids wagmi can select a transport for (the configured chains). A read
 * `chainId` outside this set has no transport, so we type the read target as this
 * union; the resolved `chainId` we return/use for address lookups stays `number`.
 */
type ReadChainId = (typeof wagmiConfig)["chains"][number]["id"];

/**
 * The vault's underlying asset is 6-dp USDC on every supported chain (Base Sepolia
 * `asset()` is the Aave test USDC; Base mainnet is Circle USDC — both 6-dp; matches
 * policy caps `decimals: 6`). Read `asset()` proves the address; decimals are fixed.
 */
export const USDC_DECIMALS = 6;

/** Profit-only performance-fee bounds fallback (policy-schema.md §4.1 / SoT default). */
const PERF_FEE_FALLBACK = { defaultBps: 1000, ceilingBps: 2000 } as const;

/** Reason the live vault view can't act — a clean, non-throwing state for the UI. */
export type VaultUnavailable =
  | { kind: "no_chain" }
  | { kind: "vault_not_deployed"; chainId: number };

/** Net-of-performance-fee APY framing (agent-service-api.md §3.7). */
export interface NetApyFraming {
  /** Pre-fee (gross) Aave supply APY, in bps — supplied by the caller (off-chain rate). */
  readonly grossApyBps: number;
  /** The performance-fee rate applied, in bps (LIVE on-chain when loaded, else policy default). */
  readonly feeBps: number;
  /** Whether `feeBps` came from the live on-chain read (vs the policy fallback). */
  readonly feeIsLive: boolean;
  /** Net APY = gross × (1 − feeBps/10000); the fee reduces only the yield leg (profit-only). */
  readonly netApyBps: number;
  readonly grossApyPct: number;
  readonly netApyPct: number;
}

export interface UseVaultOptions {
  /**
   * Chain to read (defaults to the connected wallet's chain). Pass explicitly to
   * show live vault state before a wallet is connected (e.g. the NonCustody badge
   * verifying `paused()`/fees/caps on Base Sepolia). Reads use this chain's wagmi
   * transport — a wallet is NOT required for the vault-global reads.
   */
  readonly chainId?: number;
  /** Owner for the account-scoped reads (defaults to the connected account). */
  readonly account?: Address;
  /** USDC (6-dp base units) to price a deposit preview for — drives `previewDepositShares`. */
  readonly previewDepositAssets?: bigint;
  /** Shares to price a redeem preview for — drives `previewRedeemAssets`. */
  readonly previewRedeemShares?: bigint;
  /**
   * The vault to read (011 multi-vault). OMITTED ⇒ the conservative launch Aave vault for this chain
   * (unchanged default). Pass a wrapper address (with `kind: 'morpho_wrapper'`) to read a branded
   * SparkPointMorphoVault instead. All the shared ERC-4626 + fee/pause reads target this address.
   */
  readonly vaultAddress?: Address;
  /** The vault's kind (010 registry). Defaults to `'aave_launch'`; set `'morpho_wrapper'` for a wrapper. */
  readonly kind?: VaultKind;
  /** A registry display label override (else the launch default, or the wrapper's on-chain `label()`). */
  readonly label?: string;
}

export interface UseVaultResult {
  // ── context ──────────────────────────────────────────────────────────────
  readonly chainId: number | undefined;
  readonly account: Address | undefined;
  readonly isConnected: boolean;
  /** The live vault address on this chain, or `undefined` when not deployed / no chain. */
  readonly vault: Address | undefined;
  /** The underlying-asset (USDC) address from the SoT registry for the ERC-20 reads. */
  readonly usdcAddress: Address | undefined;
  /**
   * The vault asset's decimals. Read live on-chain per vault (`decimals()`), falling back to USDC's 6
   * before the read resolves — so a wrapper over a non-6dp asset scales correctly, never hardcoded.
   * This is the vault's SHARE-token `decimals()`; it equals the ASSET decimals only under the
   * `_decimalsOffset() == 0` invariant these OZ-ERC-4626 vaults hold (see the read site).
   */
  readonly assetDecimals: number;
  /**
   * The vault's SHARE-token decimals. Equal to {@link assetDecimals} on SparkPoint's own ERC-4626s,
   * and **18 over a 6-dp asset** on a Morpho Vault V2 (which sets a decimals offset). Separate from
   * {@link assetDecimals} so a caller formatting a SHARE amount cannot silently use the asset scale.
   */
  readonly shareDecimals: number;
  /**
   * The ERC-20 a deposit actually spends — the vault's own `asset()`, which on Base Sepolia is NOT
   * the chain's `usdc`. Use this for approvals; see the derivation for why the distinction matters.
   */
  readonly depositToken: Address | undefined;
  /**
   * The V2's own MANAGEMENT fee in bps (WAD-converted). `undefined` on SparkPoint's own vaults, which
   * charge none. Disclosed separately from the performance fee so the fee chain reads honestly.
   */
  readonly managementFeeBps: number | undefined;

  // ── multi-vault identity (011 Phase 4) ─────────────────────────────────────
  /** `'aave_launch'` (default), `'morpho_wrapper'`, or `'morpho_fee_wrapper'`. Drives copy + the
   * double-fee disclosure. */
  readonly kind: VaultKind;
  /**
   * How this vault's performance fee accrues — derived centrally from {@link kind} (024/T024).
   *
   * Every fee surface MUST key its copy on this rather than assuming a high-water mark: SparkPoint's
   * own vaults hold a real `_highWaterMark`, while a Morpho Vault V2 Fee Wrapper holds none, so on a
   * Fee Wrapper a gain following an earlier loss IS charged. Ratified as a disclosure obligation in
   * constitution v3.0.0.
   */
  readonly feeBasis: VaultFeeBasis;
  /** Human display name — the launch label, a registry override, or the wrapper's on-chain `label()`. */
  readonly label: string;
  /** Honest venue: the launch vault yields via Aave v3; a wrapper via Morpho (NOT Aave). */
  readonly underlyingProtocol: "aave_v3" | "morpho";
  /** For a wrapper: the single curated Morpho vault it routes into (`morphoVault()`). Else undefined. */
  readonly morphoVault: Address | undefined;
  /**
   * RETIRED (024) — resolved HERE from the address book by the vault address, not passed in by the
   * caller. Deriving it centrally is deliberate: `retired` fail-closes DEPOSIT, and a per-call-site
   * flag is forgettable (it was in fact forgotten once, in the `/confirm/[intent]` route, which mounts
   * its own `useVaultConfirm` and renders `ConfirmFlow` directly — bypassing the amount screen). Any
   * present or future mount point now inherits the fail-close for free. Withdraw is unaffected (N2).
   */
  readonly retired: boolean;
  /**
   * Wrapper PROVENANCE via `factory.isSparkPointVault(vault)`: `true` ⇒ attested (safe to render),
   * `false` ⇒ refused (fail-closed), `undefined` ⇒ launch vault / factory not deployed / still loading.
   */
  readonly factoryVerified: boolean | undefined;

  // ── fail-closed gate ─────────────────────────────────────────────────────
  /** Non-null ⇒ the live view can't act; render a notice. Never gate `/exit` on this. */
  readonly unavailable: VaultUnavailable | null;
  /** Convenience: `unavailable === null` (the vault is deployed and reads are live). */
  readonly isDeployed: boolean;

  // ── query lifecycle ──────────────────────────────────────────────────────
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** Refetch every enabled read (post-tx refresh). */
  readonly refetch: () => void;

  // ── vault-global reads (no wallet required) ──────────────────────────────
  readonly totalAssets: bigint | undefined;
  /** DISPLAY ONLY — withdraw/redeem are never pause-gated (N2). Surfaced to prove exit-while-paused. */
  readonly paused: boolean | undefined;
  /** Current performance-fee rate (bps); profit-only. See {@link feeBasis} for HOW it accrues. */
  readonly performanceFeeBps: number | undefined;
  /**
   * Hard cap on the performance fee (bps) — 2000 (20%).
   *
   * On SparkPoint's own vaults this is a bytecode constant, so it is genuinely never exceedable. On a
   * Fee Wrapper the ≤20% ceiling is a POLICY commitment (Morpho V2's own ceiling is 50%), held by the
   * Safe owner + a ≥3-day timelock — so read this with {@link feeBasis} before calling it immutable.
   */
  readonly maxPerformanceFeeBps: number | undefined;
  /**
   * Share-price high-water mark (WAD, 1e18-scaled). Fee accrues only above this.
   *
   * `undefined` on a Fee Wrapper — a Morpho Vault V2 exposes no `highWaterMark()` because it keeps no
   * such state. Absence here is therefore meaningful, not merely "still loading".
   */
  readonly highWaterMark: bigint | undefined;
  readonly feeRecipient: Address | undefined;
  /** The vault's live `asset()` (should equal `usdcAddress`; surfaced for reconciliation). */
  readonly asset: Address | undefined;
  /** LIVE CapRegistry `perUserCap()` (raw USDC base units) — the on-chain per-user TVL cap (G2). Fallback: policy mirror. */
  readonly perUserCap: bigint | undefined;
  /** LIVE CapRegistry `totalCap()` — the aggregate protocol TVL cap. */
  readonly totalCap: bigint | undefined;
  /** LIVE CapRegistry `vaultCap()` — the max total assets the vault accepts. */
  readonly vaultCap: bigint | undefined;

  // ── account-scoped reads (require a connected/`account` wallet) ───────────
  /** `balanceOf(account)` — the owner's vault shares (spvUSDC). */
  readonly shares: bigint | undefined;
  /** `convertToAssets(shares)` — the USDC value of the position (no fee/liquidity haircut). */
  readonly underlying: bigint | undefined;
  /** `maxDeposit(account)` — 0 at the cap or while paused. */
  readonly maxDeposit: bigint | undefined;
  /** `maxWithdraw(account)` — assets redeemable now (clamped to Aave liquidity). */
  readonly maxWithdraw: bigint | undefined;
  /** `maxRedeem(account)` — shares redeemable now (clamped to Aave liquidity). */
  readonly maxRedeem: bigint | undefined;
  /** USDC `balanceOf(account)` — the idle wallet balance available to deposit. */
  readonly usdcBalance: bigint | undefined;
  /** USDC `allowance(account, vault)` — the approved spend the vault may pull on deposit. */
  readonly usdcAllowance: bigint | undefined;

  // ── parameterized previews (ERC-4626-accurate; round DOWN, in the vault's favor) ──
  /** `previewDeposit(previewDepositAssets)` — shares minted for that USDC amount. */
  readonly previewDepositShares: bigint | undefined;
  /** `previewRedeem(previewRedeemShares)` — USDC returned for those shares (net of fee dilution). */
  readonly previewRedeemAssets: bigint | undefined;

  // ── derived framing helpers (pure) ───────────────────────────────────────
  /** True when a deposit of `assets` needs an ERC-20 approve first (allowance short/unknown). */
  readonly needsApproval: (assets: bigint) => boolean;
  /** Net-of-performance-fee APY framing from a caller-supplied gross Aave rate (bps). */
  readonly netApy: (grossApyBps: number) => NetApyFraming;
}

/** Performance-fee bounds from the policy SoT for `chainId`, with a safe fallback. */
function perfFeeBounds(chainId: number | undefined): { defaultBps: number; ceilingBps: number } {
  if (chainId === undefined) return PERF_FEE_FALLBACK;
  try {
    return getPolicyConstants(chainId).governance.performanceFee;
  } catch {
    return PERF_FEE_FALLBACK;
  }
}

/** USDC address from the SoT registry for `chainId` (`undefined` on unsupported chains). */
function usdcAddressFor(chainId: number | undefined): Address | undefined {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId).usdc;
  } catch {
    return undefined;
  }
}

/** SparkPointVaultFactory address (011) from the SoT registry — `undefined` where not deployed. */
function factoryAddressFor(chainId: number | undefined): Address | undefined {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId).sparkPointVaultFactory;
  } catch {
    return undefined;
  }
}

/** `CapRegistry` address (G2) from the SoT registry — `undefined` where not deployed. */
function capRegistryAddressFor(chainId: number | undefined): Address | undefined {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId).capRegistry;
  } catch {
    return undefined;
  }
}

/**
 * The live vault view. All reads are wagmi/react-query direct-RPC reads targeting
 * the resolved chain's transport — no agent, no backend, no custody. See file docs.
 */
export function useVault(options: UseVaultOptions = {}): UseVaultResult {
  const acct = useAccount();
  const account = options.account ?? acct.address;
  const chainId = options.chainId ?? acct.chainId;
  // Transport-selection id for the wagmi reads (see ReadChainId). Reads are `enabled`-
  // gated on a deployed vault; an unconfigured chain simply has no transport → errors
  // closed (never a fabricated value).
  const readChainId = chainId as ReadChainId | undefined;

  // Multi-vault resolution (011): an explicit `vaultAddress` targets a branded wrapper; omitting it
  // resolves the conservative launch Aave vault for this chain — the UNCHANGED default.
  const kind: VaultKind = options.kind ?? "aave_launch";
  // `isWrapper` gates the SparkPointMorphoVault-SPECIFIC reads (`label()`, `morphoVault()`,
  // `factory()`, `isSparkPointVault()`). A `morpho_fee_wrapper` is Morpho's OWN Vault V2 and exposes
  // none of them, so it must NOT be folded in here — those reads would revert against it. Its live
  // read path (a distinct V2 ABI) lands with the Phase 3 deployment; today the kind exists so the fee
  // DISCLOSURE is honest before any Fee Wrapper can take a deposit (024/T024).
  const isWrapper = kind === "morpho_wrapper";
  const isMorphoVenue = kind === "morpho_wrapper" || kind === "morpho_fee_wrapper";
  /**
   * 024 Phase 3 — a **Morpho Vault V2 Fee Wrapper**. A THIRD predicate, deliberately separate from
   * `isWrapper` and from `feeBasis`, because the three answer different questions:
   *   `isWrapper`      → "may I call the SparkPointMorphoVault-only views?" (a V2: no, they revert)
   *   `isFeeWrapper`   → "which ABI and which read set?"                    (this one)
   *   `feeBasis`       → "which fee copy is honest?"                        (already correct)
   * Collapsing any two of them is how a reverting read or a wrong fee string reaches production.
   */
  const isFeeWrapper = kind === "morpho_fee_wrapper";
  const launchVault = chainId === undefined ? undefined : vaultAddressFor(chainId);
  const vault = options.vaultAddress ?? launchVault;
  // 024: the address-book entry for a V2, when this hook is pointed at one. Carries the ASSET (which
  // is NOT the chain's `usdc` — see `depositToken`) and the two separate decimals.
  const feeWrapperEntry = ((): { asset: Address; assetDecimals: number; shareDecimals: number } | undefined => {
    if (!isFeeWrapper || chainId === undefined || vault === undefined) return undefined;
    try {
      const e = (getAddresses(chainId).morphoFeeWrappers ?? []).find(
        (x) => x.address.toLowerCase() === vault.toLowerCase(),
      );
      return e === undefined
        ? undefined
        : { asset: e.asset, assetDecimals: e.assetDecimals, shareDecimals: e.shareDecimals };
    } catch {
      return undefined; // never throw out of a hook body
    }
  })();
  const usdcAddress = usdcAddressFor(chainId);
  // 024: retirement is a property of the VAULT, resolved centrally from the address book — never a
  // flag each call site has to remember to pass. Deposit fail-closes on it; withdraw never does (N2).
  //
  // BOTH LISTS ARE SCANNED. A V2 lives in `morphoFeeWrappers`, not `sparkPointWrappers`, and this
  // hook's own header records that a per-call-site `retired` flag was forgotten once and Defender
  // caught a live deposit bypass through `/confirm/[intent]`. A vault that is invisible to this scan
  // re-opens exactly that class of bug, so the scan follows the vault wherever it is declared.
  const retired = ((): boolean => {
    if (chainId === undefined || vault === undefined) return false;
    const target = vault.toLowerCase();
    try {
      const book = getAddresses(chainId);
      const w = book.sparkPointWrappers ?? [];
      if (w.some((x) => x.address.toLowerCase() === target && x.retired === true)) return true;
      const v2 = book.morphoFeeWrappers ?? [];
      return v2.some((x) => x.address.toLowerCase() === target && x.retired === true);
    } catch {
      return false; // an unconfigured chain has no wrappers; never throw out of a hook body
    }
  })();
  const factoryAddress = chainId === undefined ? undefined : factoryAddressFor(chainId);
  const capRegistryAddress = chainId === undefined ? undefined : capRegistryAddressFor(chainId);

  const unavailable: VaultUnavailable | null =
    chainId === undefined
      ? { kind: "no_chain" }
      : vault === undefined
        ? { kind: "vault_not_deployed", chainId }
        : null;

  const isDeployed = unavailable === null;
  const enabledGlobal = vault !== undefined;
  const enabledAccount = enabledGlobal && account !== undefined;

  // A single base for every vault read: pins the ABI + the chain transport. When the
  // vault is undefined the `enabled` gate keeps these reads from ever firing.
  // The SHARED ERC-4626 spine. `totalAssets` / `asset` / `balanceOf` / `convertToAssets` /
  // `preview*` carry identical selectors AND identical signatures on both contracts, so one ABI
  // decodes both correctly — same calldata in, same shape out. Only the reads that genuinely DIFFER
  // are split below, which keeps this change small and leaves the launch path byte-identical.
  const vaultBase = { address: vault as Address, abi: sparkPointVaultAbi, chainId: readChainId } as const;
  /** The V2-only read base. See morphoVaultV2Abi's header for what a V2 does and does not expose. */
  const v2Base = { address: vault as Address, abi: morphoVaultV2Abi, chainId: readChainId } as const;

  // ── vault-global batch (no wallet required) ──────────────────────────────
  const globalReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...vaultBase, functionName: "totalAssets" },
      { ...vaultBase, functionName: "asset" },
    ],
    query: { enabled: enabledGlobal },
  });
  const totalAssets = globalReads.data?.[0]?.result as bigint | undefined;
  const assetLive = globalReads.data?.[1]?.result as Address | undefined;

  // ── LAUNCH-ONLY reads. A Vault V2 has none of these selectors, so they are `enabled`-gated OFF
  //    against one rather than left to fail silently.
  //
  //    THE SILENCE IS THE HAZARD, not the revert. `allowFailure: true` resolves a missing selector to
  //    `undefined`, and an `undefined` `performanceFeeBps` falls straight through to
  //    `perfFeeBounds(chainId).defaultBps` inside `netApy` below — so firing this set at a V2 would
  //    render a confident **10% fee that was never read from the vault**. The deployed V2's real fee
  //    is 0. Displaying an unread fee figure is exactly what Principle III forbids. ────────────────
  const launchOnlyReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...vaultBase, functionName: "paused" },
      { ...vaultBase, functionName: "performanceFeeBps" },
      { ...vaultBase, functionName: "MAX_PERFORMANCE_FEE_BPS" },
      { ...vaultBase, functionName: "highWaterMark" },
      { ...vaultBase, functionName: "feeRecipient" },
    ],
    query: { enabled: enabledGlobal && !isFeeWrapper },
  });

  // ── V2-ONLY reads. Fees here are WAD-scaled (1e18 == 100%), never bps. ──────────────────────────
  const feeWrapperReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...v2Base, functionName: "performanceFee" },
      { ...v2Base, functionName: "managementFee" },
      { ...v2Base, functionName: "performanceFeeRecipient" },
    ],
    query: { enabled: enabledGlobal && isFeeWrapper },
  });

  /**
   * DISPLAY-ONLY pause state. `undefined` on a V2, and that absence is MEANINGFUL rather than "still
   * loading": a Vault V2 has no `paused()`, so there is no protocol-level deposit pause to surface.
   * Withdraw/redeem were never pause-gated on either contract (N2).
   */
  const paused = isFeeWrapper ? undefined : (launchOnlyReads.data?.[0]?.result as boolean | undefined);
  /**
   * The LIVE performance fee in bps.
   *
   * On a V2 this is converted from WAD with exact-integer, round-up arithmetic — `wadToBpsCeil`'s
   * header records how this same conversion in 64-bit arithmetic wrapped a 25% fee to −8 bps and
   * passed a 0-bps ceiling. Stays `undefined` while genuinely unresolved; never defaulted here.
   */
  const performanceFeeBps = isFeeWrapper
    ? ((): number | undefined => {
        const wad = feeWrapperReads.data?.[0]?.result as bigint | undefined;
        return wad === undefined ? undefined : wadToBpsCeil(wad);
      })()
    : (launchOnlyReads.data?.[1]?.result as number | undefined);
  /** The V2's own MANAGEMENT fee in bps (WAD-converted). `undefined` on our own vaults — they have none. */
  const managementFeeBps = isFeeWrapper
    ? ((): number | undefined => {
        const wad = feeWrapperReads.data?.[1]?.result as bigint | undefined;
        return wad === undefined ? undefined : wadToBpsCeil(wad);
      })()
    : undefined;
  /**
   * The ≤20% performance-fee ceiling.
   *
   * On SparkPoint's own vaults this is a BYTECODE CONSTANT, so "governance can never exceed it" is
   * literally true. A V2 exposes no such selector and its OWN ceiling is 50%, so here the ≤20% figure
   * is a POLICY commitment held by the Safe owner + a ≥3-day timelock. It therefore comes from our
   * policy constants, never from a vault read — and `feeCapEnforcementLabel(feeBasis)` is what tells
   * the user which of the two they are looking at.
   */
  const maxPerformanceFeeBps = isFeeWrapper
    ? perfFeeBounds(chainId).ceilingBps
    : (launchOnlyReads.data?.[2]?.result as number | undefined);
  /**
   * Share-price high-water mark. Permanently `undefined` on a V2 — it keeps NO such state, which is
   * precisely why `feeBasis` is `per_period_gain` for this kind. Absence IS the signal; a `0` would
   * read as "the mark is at par", a materially different and false promise.
   */
  const highWaterMark = isFeeWrapper ? undefined : (launchOnlyReads.data?.[3]?.result as bigint | undefined);
  const feeRecipient = isFeeWrapper
    ? (feeWrapperReads.data?.[2]?.result as Address | undefined)
    : (launchOnlyReads.data?.[4]?.result as Address | undefined);
  const asset = assetLive ?? (isFeeWrapper ? feeWrapperEntry?.asset : undefined);

  /**
   * The ERC-20 a deposit actually spends — **the vault's own `asset()`, not the chain's `usdc`.**
   *
   * On Base Sepolia these differ, and the difference is not cosmetic. The address book's `usdc` is
   * AAVE's test token `0xba50Cd2A…`; a Morpho Vault V2's asset is CIRCLE's `0x036CbD53…`. Both report
   * `symbol() == "USDC"` at 6 dp and are NOT interchangeable. The balance/allowance reads and
   * `needsApproval` all key on this, because `vaultConfirmModel` hands it to the executor as the token
   * to approve: keyed on the chain's `usdc` instead, the user would sign a perfectly successful
   * approve on a token the vault never pulls, and the deposit would then revert on-chain — the worst
   * shape of failure, because the approve looks like it worked.
   */
  const depositToken = isFeeWrapper ? (asset ?? feeWrapperEntry?.asset) : usdcAddress;

  // ── live CapRegistry caps (US1) ───────────────────────────────────────────
  // The governance-settable per-user / total / vault caps, read DIRECTLY on-chain from the bounded
  // CapRegistry (G2) so the caps meter reflects a live `setPerUserCap` instead of the compile-time
  // policy mirror. Its OWN address + ABI (a different contract than the vault). Fail-soft: `undefined`
  // until resolved / where CapRegistry isn't deployed — consumers fall back to the versioned policy
  // mirror (never a fabricated cap). Deliberately kept OUT of the isLoading/isError aggregate so a
  // cap-read hiccup degrades to the mirror rather than faulting the whole live view.
  const capReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: capRegistryAddress as Address, abi: capRegistryAbi, chainId: readChainId, functionName: "perUserCap" },
      { address: capRegistryAddress as Address, abi: capRegistryAbi, chainId: readChainId, functionName: "totalCap" },
      { address: capRegistryAddress as Address, abi: capRegistryAbi, chainId: readChainId, functionName: "vaultCap" },
    ],
    query: { enabled: enabledGlobal && capRegistryAddress !== undefined },
  });
  const perUserCap = capReads.data?.[0]?.result as bigint | undefined;
  const totalCap = capReads.data?.[1]?.result as bigint | undefined;
  const vaultCap = capReads.data?.[2]?.result as bigint | undefined;

  // ── account-scoped batch (owner's position + limits) ─────────────────────
  const accountReads = useReadContracts({
    allowFailure: true,
    contracts: [{ ...vaultBase, functionName: "balanceOf", args: [account as Address] }],
    query: { enabled: enabledAccount },
  });

  // ── the max* limits, LAUNCH-ONLY and gated OFF against a V2 ─────────────────────────────────────
  // On a Vault V2 `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem` are all `pure returns (0)` and are
  // NOT enforced inside deposit/withdraw. Reading them would not error — it would return a confident
  // 0, and a UI that believes it tells the holder "you cannot withdraw". That is both false and the
  // single worst thing to say to someone trying to exit (N2), so these stay `undefined` on a V2 and
  // consumers fall back to the policy caps rather than to a fabricated limit.
  const limitReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...vaultBase, functionName: "maxDeposit", args: [account as Address] },
      { ...vaultBase, functionName: "maxWithdraw", args: [account as Address] },
      { ...vaultBase, functionName: "maxRedeem", args: [account as Address] },
    ],
    query: { enabled: enabledAccount && !isFeeWrapper },
  });

  const shares = accountReads.data?.[0]?.result as bigint | undefined;
  const maxDeposit = isFeeWrapper ? undefined : (limitReads.data?.[0]?.result as bigint | undefined);
  const maxWithdraw = isFeeWrapper ? undefined : (limitReads.data?.[1]?.result as bigint | undefined);
  const maxRedeem = isFeeWrapper ? undefined : (limitReads.data?.[2]?.result as bigint | undefined);

  // ── underlying: convertToAssets(shares) — dependent on the shares read ────
  const underlyingRead = useReadContract({
    ...vaultBase,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    query: { enabled: enabledGlobal && shares !== undefined && shares > 0n },
  });
  const underlying = shares === 0n ? 0n : (underlyingRead.data as bigint | undefined);

  // ── USDC ERC-20 reads: idle balance + the vault's spend allowance ─────────
  const usdcReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: depositToken as Address, abi: erc20Abi, chainId: readChainId, functionName: "balanceOf", args: [account as Address] },
      {
        address: depositToken as Address,
        abi: erc20Abi,
        chainId: readChainId,
        functionName: "allowance",
        args: [account as Address, vault as Address],
      },
    ],
    query: { enabled: enabledAccount && depositToken !== undefined },
  });
  const usdcBalance = usdcReads.data?.[0]?.result as bigint | undefined;
  const usdcAllowance = usdcReads.data?.[1]?.result as bigint | undefined;

  // ── per-vault decimals (011): read live so a wrapper over a non-6dp asset scales right; the
  //    launch vault reads 6 and matches USDC_DECIMALS. Fails soft to 6 before it resolves.
  //
  //    INVARIANT (fix 6): this reads the vault's OWN erc20 `decimals()` — i.e. the SHARE-token
  //    decimals — yet consumers also scale ASSET amounts (deposit/withdraw USDC) with it. That is
  //    sound ONLY because these OZ ERC-4626 vaults (launch `SparkPointVault` + the branded
  //    `SparkPointMorphoVault` wrapper) use the default `_decimalsOffset() == 0`, so
  //    share-decimals == asset-decimals. If a future vault sets a non-zero virtual offset this
  //    breaks; such a vault MUST instead read `asset()`'s decimals separately. Launch: 6 == 6. ──
  const decimalsRead = useReadContract({
    address: vault as Address,
    abi: erc20Abi,
    chainId: readChainId,
    functionName: "decimals",
    query: { enabled: enabledGlobal },
  });
  const decimalsLive = decimalsRead.data as number | undefined;

  // ── 024: on a Vault V2 the invariant above DOES NOT HOLD, so read the two decimals separately. ──
  //
  // The comment directly above predicted this break by name. A V2 sets a non-zero decimals offset
  // (`virtualShares() == 1e12`), so its own `decimals()` is 18 while its ASSET is 6-dp USDC. Using
  // the share decimals to scale an asset amount is a 1e12 error in the user's face: 100 USDC renders
  // as ~0.0000000001, and the USD valuation collapses to zero so the position disappears from net
  // worth entirely. The asset's decimals therefore come from `asset()`'s own `decimals()`, with the
  // address-book entry as the pre-resolution fallback (never the share decimals).
  const assetDecimalsRead = useReadContract({
    address: asset as Address,
    abi: erc20Abi,
    chainId: readChainId,
    functionName: "decimals",
    query: { enabled: enabledGlobal && isFeeWrapper && asset !== undefined },
  });
  const assetDecimals = isFeeWrapper
    ? ((assetDecimalsRead.data as number | undefined) ?? feeWrapperEntry?.assetDecimals ?? USDC_DECIMALS)
    : (decimalsLive ?? USDC_DECIMALS);
  /**
   * The vault's SHARE-token decimals. Equal to {@link assetDecimals} on SparkPoint's own ERC-4626s
   * (`_decimalsOffset() == 0`), and **18 over a 6-dp asset** on a Vault V2. Exposed separately so a
   * caller formatting a SHARE amount cannot silently reuse the asset scale, or vice versa.
   */
  const shareDecimals = decimalsLive ?? feeWrapperEntry?.shareDecimals ?? assetDecimals;

  // ── wrapper-only views (011): branded label + the single curated Morpho target it routes into. ──
  const wrapperReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: vault as Address, abi: morphoWrapperViewsAbi, chainId: readChainId, functionName: "label" },
      { address: vault as Address, abi: morphoWrapperViewsAbi, chainId: readChainId, functionName: "morphoVault" },
    ],
    query: { enabled: enabledGlobal && isWrapper },
  });
  const wrapperLabel = wrapperReads.data?.[0]?.result as string | undefined;
  const morphoVault = wrapperReads.data?.[1]?.result as Address | undefined;

  // ── wrapper PROVENANCE (011): render a wrapper ONLY when the factory attests it. Unverified ⇒
  //    false (refuse, fail-closed). Launch vault / no factory ⇒ never queried (stays undefined).
  //    NOTE (fix 5): this is queried ONLY when `kind === 'morpho_wrapper'`, so `factoryVerified`
  //    is populated just for that case. `useVaultConfirm` still treats a true attestation as the
  //    trust root (an attested address is a wrapper even absent `kind`); see the kind↔address↔
  //    provenance contract in vaultConfirmModel.ts. Enforcement (deposit fail-close) lives there. ──
  const provenanceRead = useReadContract({
    address: factoryAddress as Address,
    abi: vaultFactoryProvenanceAbi,
    chainId: readChainId,
    functionName: "isSparkPointVault",
    args: [vault as Address],
    query: { enabled: enabledGlobal && isWrapper && factoryAddress !== undefined },
  });
  const factoryVerified = isWrapper ? (provenanceRead.data as boolean | undefined) : undefined;

  // ── multi-vault identity ─────────────────────────────────────────────────
  const label = isWrapper
    ? (wrapperLabel ?? options.label ?? "SparkPoint Vault")
    : (options.label ?? "Aave Yield Vault");
  const underlyingProtocol: "aave_v3" | "morpho" = isMorphoVenue ? "morpho" : "aave_v3";

  // ── parameterized previews ───────────────────────────────────────────────
  const depositAssets = options.previewDepositAssets;
  const previewDepositRead = useReadContract({
    ...vaultBase,
    functionName: "previewDeposit",
    args: [depositAssets ?? 0n],
    query: { enabled: enabledGlobal && depositAssets !== undefined && depositAssets > 0n },
  });
  const previewDepositShares =
    depositAssets === undefined || depositAssets === 0n ? 0n : (previewDepositRead.data as bigint | undefined);

  const redeemShares = options.previewRedeemShares;
  const previewRedeemRead = useReadContract({
    ...vaultBase,
    functionName: "previewRedeem",
    args: [redeemShares ?? 0n],
    query: { enabled: enabledGlobal && redeemShares !== undefined && redeemShares > 0n },
  });
  const previewRedeemAssets =
    redeemShares === undefined || redeemShares === 0n ? 0n : (previewRedeemRead.data as bigint | undefined);

  // ── lifecycle aggregation ────────────────────────────────────────────────
  // The DEPENDENT reads (convertToAssets/previewRedeem) are folded into the aggregate so a consumer
  // never sees a transient "live $0.00" while `underlying` is still resolving after `shares` landed.
  const underlyingPending = enabledGlobal && shares !== undefined && shares > 0n;
  const redeemPending = enabledGlobal && redeemShares !== undefined && redeemShares > 0n;
  const isLoading =
    (enabledGlobal && globalReads.isLoading) ||
    (enabledAccount && accountReads.isLoading) ||
    (enabledAccount && usdcAddress !== undefined && usdcReads.isLoading) ||
    (underlyingPending && underlyingRead.isLoading) ||
    (redeemPending && previewRedeemRead.isLoading);
  const isError =
    (enabledGlobal && globalReads.isError) ||
    (enabledAccount && accountReads.isError) ||
    (enabledAccount && usdcAddress !== undefined && usdcReads.isError) ||
    (underlyingPending && underlyingRead.isError) ||
    (redeemPending && previewRedeemRead.isError);

  const refetch = useCallback(() => {
    void globalReads.refetch();
    void launchOnlyReads.refetch();
    void feeWrapperReads.refetch();
    void accountReads.refetch();
    void limitReads.refetch();
    void underlyingRead.refetch();
    void usdcReads.refetch();
    void previewDepositRead.refetch();
    void previewRedeemRead.refetch();
    void decimalsRead.refetch();
    void assetDecimalsRead.refetch();
    void wrapperReads.refetch();
    void provenanceRead.refetch();
    void capReads.refetch();
  }, [
    globalReads,
    launchOnlyReads,
    feeWrapperReads,
    accountReads,
    limitReads,
    underlyingRead,
    usdcReads,
    previewDepositRead,
    previewRedeemRead,
    decimalsRead,
    assetDecimalsRead,
    wrapperReads,
    provenanceRead,
    capReads,
  ]);

  // ── derived helpers ──────────────────────────────────────────────────────
  const needsApproval = useCallback(
    (assets: bigint): boolean => usdcAllowance === undefined || usdcAllowance < assets,
    [usdcAllowance],
  );

  const netApy = useCallback(
    (grossApyBps: number): NetApyFraming => {
      const feeIsLive = performanceFeeBps !== undefined;
      const feeBps = performanceFeeBps ?? perfFeeBounds(chainId).defaultBps;
      // Net-of-fee: the profit-only fee reduces only the yield leg (agent-service-api.md §3.7).
      const netApyBps = Math.round((grossApyBps * (10_000 - feeBps)) / 10_000);
      return {
        grossApyBps,
        feeBps,
        feeIsLive,
        netApyBps,
        grossApyPct: grossApyBps / 100,
        netApyPct: netApyBps / 100,
      };
    },
    [performanceFeeBps, chainId],
  );

  return {
    chainId,
    account,
    isConnected: acct.isConnected,
    vault,
    usdcAddress,
    assetDecimals,
    shareDecimals,
    depositToken,
    managementFeeBps,
    kind,
    feeBasis: feeBasisForVaultKind(kind),
    label,
    underlyingProtocol,
    morphoVault,
    retired,
    factoryVerified,
    unavailable,
    isDeployed,
    isLoading,
    isError,
    refetch,
    totalAssets,
    paused,
    performanceFeeBps,
    maxPerformanceFeeBps,
    highWaterMark,
    feeRecipient,
    asset,
    perUserCap,
    totalCap,
    vaultCap,
    shares,
    underlying,
    maxDeposit,
    maxWithdraw,
    maxRedeem,
    usdcBalance,
    usdcAllowance,
    previewDepositShares,
    previewRedeemAssets,
    needsApproval,
    netApy,
  };
}
