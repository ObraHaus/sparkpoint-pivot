/**
 * 075 — cross-chain recipient selection.
 *
 * EVM behaviour is unchanged: the connected EVM wallet prefills an EVM destination unless the user
 * has overridden it. A NEAR destination is prefilled from the connected NEAR wallet (a client-side
 * claim) and stays fully editable. The pure helper makes the precedence testable.
 */

import type { CrossChainAddressKind } from "@/lib/crosschain/address";

export type RecipientSource = "manual" | "evm" | "near" | "none";

export interface RecipientSelection {
  readonly value: string;
  readonly source: RecipientSource;
}

export function resolveCrossChainRecipient(input: {
  destinationKind: CrossChainAddressKind;
  recipientOverride: string | null;
  evmAddress: string | undefined;
  nearAccountId: string | null;
}): RecipientSelection {
  // Any explicit edit (including clearing the field) wins — never silently refill over the user.
  if (input.recipientOverride !== null) {
    return { value: input.recipientOverride, source: "manual" };
  }
  if (input.destinationKind === "evm" && input.evmAddress) {
    return { value: input.evmAddress, source: "evm" };
  }
  if (input.destinationKind === "near" && input.nearAccountId) {
    return { value: input.nearAccountId, source: "near" };
  }
  return { value: "", source: "none" };
}
