/**
 * PUBLIC withdraw-always escape-hatch primitives (T048, N2).
 *
 * The N2 guarantee made concrete: the code path that lets a user pull their funds
 * out of the vault with the agent, the indexer, and the whole SparkPoint backend
 * OFFLINE — and while the vault is `paused()`. It therefore depends on NOTHING
 * but the bundled vault ABI (@sparkpoint/shared/abis, T015), the address registry,
 * and a direct-RPC viem PublicClient. It imports NO agent client and no backend.
 *
 * Nothing here signs or holds a key — it only READS chain state and ENCODES the
 * `redeem`/`withdraw` calldata; the user signs+sends from their own wallet. The
 * on-chain vault re-checks everything at execution (withdraw carries no pause, no
 * cap, fail-open fee accrual — SparkPointVault.sol), so this path can never be
 * blocked by anything off-chain.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T048; spec FR-034, SC-003;
 * smart-contracts.md §6 (withdraw/redeem NEVER pausable).
 */

import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";

/** Reason the exit surface can't act — each is a clean, non-throwing state for the UI. */
export type ExitUnavailable =
  | { kind: "vault_not_deployed"; chainId: number }
  | { kind: "no_position"; chainId: number; vault: Address };

/** The direct-RPC snapshot the escape hatch renders + acts on. All reads are chain-direct. */
export interface ExitState {
  chainId: number;
  vault: Address;
  /** The vault's underlying asset (USDC) address. */
  asset: Address;
  /** The owner's vault shares (spkUSDC). */
  shares: bigint;
  /** Shares actually redeemable right now, clamped to Aave liquidity (maxRedeem). */
  redeemableShares: bigint;
  /** Underlying USDC those redeemable shares return now (previewRedeem, already net of fee dilution). */
  redeemableAssets: bigint;
  /**
   * Whether the vault's DEPOSIT side is paused. DISPLAY ONLY — withdraw/redeem are
   * never pause-gated (N2); we surface it to prove the exit still works while paused.
   */
  depositsPaused: boolean;
}

/**
 * Resolve the vault address for `chainId` from the SoT registry. `undefined` when
 * the vault is not deployed on this chain yet (fail-closed — no fabricated address).
 */
export function vaultAddressFor(chainId: number): Address | undefined {
  try {
    return getAddresses(chainId).vault;
  } catch {
    // Unsupported chain → treat as not-deployed (the caller renders a clean notice).
    return undefined;
  }
}

/**
 * Read the exit state for `owner` DIRECTLY from chain (no agent, no backend). Returns
 * an {@link ExitUnavailable} for the two non-actionable cases (vault undeployed / no
 * position) instead of throwing, so the page always renders a clear next step. A
 * genuine RPC failure propagates (the caller shows a retry — the chain is the only
 * dependency and the user can also act via cast/BaseScan directly).
 */
export async function readExitState(
  client: PublicClient,
  chainId: number,
  owner: Address,
): Promise<ExitState | ExitUnavailable> {
  const vault = vaultAddressFor(chainId);
  if (vault === undefined) return { kind: "vault_not_deployed", chainId };

  const [shares, redeemableShares, asset, depositsPaused] = await Promise.all([
    client.readContract({ address: vault, abi: sparkPointVaultAbi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: vault, abi: sparkPointVaultAbi, functionName: "maxRedeem", args: [owner] }),
    client.readContract({ address: vault, abi: sparkPointVaultAbi, functionName: "asset" }),
    client.readContract({ address: vault, abi: sparkPointVaultAbi, functionName: "paused" }),
  ]);

  if (shares === 0n) return { kind: "no_position", chainId, vault };

  const redeemableAssets =
    redeemableShares === 0n
      ? 0n
      : await client.readContract({
          address: vault,
          abi: sparkPointVaultAbi,
          functionName: "previewRedeem",
          args: [redeemableShares],
        });

  return {
    chainId,
    vault,
    asset,
    shares,
    redeemableShares,
    redeemableAssets,
    depositsPaused,
  };
}

/**
 * Encode `redeem(shares, receiver, owner)` calldata for a direct on-chain exit.
 * receiver == owner == the connecting wallet: the redeemed USDC goes to the owner,
 * and no allowance is needed (caller is the owner). This is the calldata the user
 * signs in their wallet — build it here so the exit never needs the backend to
 * materialize a bundle (N2).
 */
export function buildRedeemCall(
  vault: Address,
  shares: bigint,
  owner: Address,
): { to: Address; data: Hex; value: bigint } {
  return {
    to: vault,
    data: encodeFunctionData({
      abi: sparkPointVaultAbi,
      functionName: "redeem",
      args: [shares, owner, owner],
    }),
    value: 0n,
  };
}

/**
 * Encode `withdraw(assets, receiver, owner)` calldata — the assets-denominated
 * exit (used when the user asks for an exact USDC amount rather than "all shares").
 * receiver == owner == the connecting wallet, so no allowance is required.
 */
export function buildWithdrawCall(
  vault: Address,
  assets: bigint,
  owner: Address,
): { to: Address; data: Hex; value: bigint } {
  return {
    to: vault,
    data: encodeFunctionData({
      abi: sparkPointVaultAbi,
      functionName: "withdraw",
      args: [assets, owner, owner],
    }),
    value: 0n,
  };
}
