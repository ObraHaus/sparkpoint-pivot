/**
 * 075/1113 — cross-chain recipient selection.
 *
 * EVM behaviour is unchanged: the connected EVM wallet prefills an EVM destination unless the user
 * has overridden it or named a different address in the chat message. A NEAR destination is
 * prefilled from an account the user named in the chat (for example `sparkpoint2026.near`), and
 * falls back to a connected NEAR wallet. The field stays fully editable. The pure helper makes
 * the precedence testable.
 */

import type { CrossChainAddressKind } from "@/lib/crosschain/address";

export type RecipientSource = "manual" | "named" | "evm" | "near" | "none";

export interface RecipientSelection {
  readonly value: string;
  readonly source: RecipientSource;
}

export function resolveCrossChainRecipient(input: {
  destinationKind: CrossChainAddressKind;
  recipientOverride: string | null;
  evmAddress: string | undefined;
  nearAccountId: string | null;
  /** An address the user already named in the chat message, if any. */
  namedRecipient?: string | null;
}): RecipientSelection {
  // Any explicit edit (including clearing the field) wins — never silently refill over the user.
  if (input.recipientOverride !== null) {
    return { value: input.recipientOverride, source: "manual" };
  }
  const named = input.namedRecipient?.trim() ?? "";
  if (named) {
    return { value: named, source: "named" };
  }
  if (input.destinationKind === "evm" && input.evmAddress) {
    return { value: input.evmAddress, source: "evm" };
  }
  if (input.destinationKind === "near" && input.nearAccountId) {
    return { value: input.nearAccountId, source: "near" };
  }
  return { value: "", source: "none" };
}
