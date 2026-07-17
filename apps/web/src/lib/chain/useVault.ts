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
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { getPolicyConstants } from "@sparkpoint/shared/policy";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { vaultAddressFor } from "@/lib/chain/exit";
import { wagmiConfig } from "@/lib/wagmi";

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
  /** Fixed underlying decimals (6). Exposed so consumers never re-derive it. */
  readonly assetDecimals: number;

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
  /** Current performance-fee rate (bps); profit-only, over a high-water mark. */
  readonly performanceFeeBps: number | undefined;
  /** Immutable hard cap on the performance fee (bps) — 2000 (20%); never exceedable. */
  readonly maxPerformanceFeeBps: number | undefined;
  /** Share-price high-water mark (WAD, 1e18-scaled). Fee accrues only above this. */
  readonly highWaterMark: bigint | undefined;
  readonly feeRecipient: Address | undefined;
  /** The vault's live `asset()` (should equal `usdcAddress`; surfaced for reconciliation). */
  readonly asset: Address | undefined;

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

  const vault = chainId === undefined ? undefined : vaultAddressFor(chainId);
  const usdcAddress = usdcAddressFor(chainId);

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
  const vaultBase = { address: vault as Address, abi: sparkPointVaultAbi, chainId: readChainId } as const;

  // ── vault-global batch (no wallet required) ──────────────────────────────
  const globalReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...vaultBase, functionName: "totalAssets" },
      { ...vaultBase, functionName: "paused" },
      { ...vaultBase, functionName: "performanceFeeBps" },
      { ...vaultBase, functionName: "MAX_PERFORMANCE_FEE_BPS" },
      { ...vaultBase, functionName: "highWaterMark" },
      { ...vaultBase, functionName: "feeRecipient" },
      { ...vaultBase, functionName: "asset" },
    ],
    query: { enabled: enabledGlobal },
  });

  const totalAssets = globalReads.data?.[0]?.result as bigint | undefined;
  const paused = globalReads.data?.[1]?.result as boolean | undefined;
  const performanceFeeBps = globalReads.data?.[2]?.result as number | undefined;
  const maxPerformanceFeeBps = globalReads.data?.[3]?.result as number | undefined;
  const highWaterMark = globalReads.data?.[4]?.result as bigint | undefined;
  const feeRecipient = globalReads.data?.[5]?.result as Address | undefined;
  const asset = globalReads.data?.[6]?.result as Address | undefined;

  // ── account-scoped batch (owner's position + limits) ─────────────────────
  const accountReads = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...vaultBase, functionName: "balanceOf", args: [account as Address] },
      { ...vaultBase, functionName: "maxDeposit", args: [account as Address] },
      { ...vaultBase, functionName: "maxWithdraw", args: [account as Address] },
      { ...vaultBase, functionName: "maxRedeem", args: [account as Address] },
    ],
    query: { enabled: enabledAccount },
  });

  const shares = accountReads.data?.[0]?.result as bigint | undefined;
  const maxDeposit = accountReads.data?.[1]?.result as bigint | undefined;
  const maxWithdraw = accountReads.data?.[2]?.result as bigint | undefined;
  const maxRedeem = accountReads.data?.[3]?.result as bigint | undefined;

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
      { address: usdcAddress as Address, abi: erc20Abi, chainId: readChainId, functionName: "balanceOf", args: [account as Address] },
      {
        address: usdcAddress as Address,
        abi: erc20Abi,
        chainId: readChainId,
        functionName: "allowance",
        args: [account as Address, vault as Address],
      },
    ],
    query: { enabled: enabledAccount && usdcAddress !== undefined },
  });
  const usdcBalance = usdcReads.data?.[0]?.result as bigint | undefined;
  const usdcAllowance = usdcReads.data?.[1]?.result as bigint | undefined;

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
    void accountReads.refetch();
    void underlyingRead.refetch();
    void usdcReads.refetch();
    void previewDepositRead.refetch();
    void previewRedeemRead.refetch();
  }, [globalReads, accountReads, underlyingRead, usdcReads, previewDepositRead, previewRedeemRead]);

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
    assetDecimals: USDC_DECIMALS,
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
