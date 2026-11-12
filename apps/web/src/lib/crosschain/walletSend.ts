/**
 * 068 — pure helpers for the optional "Send from wallet" deposit path.
 *
 * The card may offer a wallet transfer ONLY when the build can actually sign for the origin:
 * an EVM chain this build's wagmi config registered, or a connected NEAR wallet for a NEAR origin.
 * The exact human amount must be converted to base units without a float, and a NEAR transfer is
 * built as an UNSIGNED transaction here — the provider signs only after the user taps the button.
 */

import type { NearTransaction } from "../near/burrow.ts";
import { isValidNearAccountId } from "../near/account.ts";

/** ~30 Tgas is plenty for a NEP-141 `ft_transfer` (1 yoctoNEAR attached). */
export const NEAR_FT_TRANSFER_GAS = "30000000000000";

/**
 * True iff the origin is an EVM chain the app can talk to. A non-EVM origin (`evmChainId` null)
 * never gets an EVM wallet button — the user sends from their own chain's wallet instead.
 */
export function canSendFromWallet(
  originEvmChainId: number | null | undefined,
  registeredChainIds: readonly number[],
): boolean {
  return (
    typeof originEvmChainId === "number" &&
    registeredChainIds.includes(originEvmChainId)
  );
}

/** The subset of a 1Click asset the NEAR deposit builder needs. */
export interface NearDepositAsset {
  readonly chain: string;
  readonly symbol: string;
  /** 1Click's asset id, e.g. `nep141:wrap.near`. */
  readonly assetId: string;
  /** Unused. wrap.near is identified by asset id, not a native flag. */
  readonly native?: boolean;
}

/** The NEP-141 contract id inside a 1Click `nep141:<contract>` asset id, or null. */
export function nearFtContractId(assetId: string): string | null {
  const prefix = "nep141:";
  const trimmed = assetId.trim();
  if (!trimmed.toLowerCase().startsWith(prefix)) return null;
  const contract = trimmed.slice(prefix.length);
  return isValidNearAccountId(contract) ? contract : null;
}

/**
 * Build the UNSIGNED NEAR transaction that deposits the exact quoted amount to a 1Click deposit
 * address. wrap.near (1Click's NEAR asset) is a `near_deposit` plus `ft_transfer` in one transaction;
 * any other NEP-141 origin is a single `ft_transfer` with 1 yoctoNEAR attached. Returns null for an invalid deposit address, amount or asset id — never a guessed
 * transaction. Nothing here signs or sends.
 */
export function buildNearDepositTransaction(input: {
  depositAddress: string;
  amountBaseUnits: bigint;
  asset: NearDepositAsset;
}): NearTransaction | null {
  const depositAddress = input.depositAddress.trim();
  if (!isValidNearAccountId(depositAddress)) return null;
  if (input.amountBaseUnits <= 0n) return null;

  const contract = nearFtContractId(input.asset.assetId);
  if (!contract) return null;

  // 1Click's NEAR asset is wrap.near. A plain native Transfer would not credit a wrap.near
  // quote, so wrap the exact amount and ft_transfer it in the same unsigned transaction.
  // Other NEP-141 origins are a single ft_transfer of the already-held token.
  const ftTransfer = {
    type: "FunctionCall" as const,
    params: {
      methodName: "ft_transfer",
      args: {
        receiver_id: depositAddress,
        amount: input.amountBaseUnits.toString(),
      },
      gas: NEAR_FT_TRANSFER_GAS,
      deposit: "1",
    },
  };
  if (contract === "wrap.near") {
    return {
      receiverId: contract,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "near_deposit",
            args: {},
            gas: NEAR_FT_TRANSFER_GAS,
            deposit: input.amountBaseUnits.toString(),
          },
        },
        ftTransfer,
      ],
    };
  }
  return { receiverId: contract, actions: [ftTransfer] };
}

/**
 * Convert a human decimal string (commas allowed) to token base units. Returns null for anything
 * malformed, over-precise for the token, or not strictly positive — never a silently rounded
 * transfer amount.
 */
export function humanToBaseUnits(amount: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const clean = amount.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) return null;
  const padded = fraction.padEnd(decimals, "0");
  try {
    const value = BigInt(`${whole}${padded}`);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}
