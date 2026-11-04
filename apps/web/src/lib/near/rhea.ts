/**
 * 075 — which NEAR account the Rhea card uses.
 *
 * The Rhea preview's `recipient` is the server-derived MCA (never typed in). The connected NEAR
 * wallet is a separate client-side signing claim for the Phase C step. A pasted NEAR account is a
 * display-only fallback when no wallet is connected. Nothing here authorises anything.
 */

import { isValidNearAccountId } from "./account.ts";

export type RheaAccountSource = "connected" | "pasted" | "rhea_recipient" | "none";

export interface RheaAccountSelection {
  readonly accountId: string | null;
  readonly source: RheaAccountSource;
}

export function selectRheaAccount(input: {
  connectedNearAccountId: string | null;
  pasted: string | null;
  rheaRecipient: string | undefined;
}): RheaAccountSelection {
  const connected = input.connectedNearAccountId?.trim() ?? "";
  if (connected && isValidNearAccountId(connected)) {
    return { accountId: connected, source: "connected" };
  }
  const pasted = input.pasted?.trim() ?? "";
  if (pasted && isValidNearAccountId(pasted)) {
    return { accountId: pasted, source: "pasted" };
  }
  const recipient = input.rheaRecipient?.trim() ?? "";
  if (recipient) {
    return { accountId: recipient, source: "rhea_recipient" };
  }
  return { accountId: null, source: "none" };
}

/** Human copy naming which account is being used — never a silent substitution. */
export function rheaAccountSourceLabel(source: RheaAccountSource): string {
  switch (source) {
    case "connected":
      return "Using your connected NEAR wallet";
    case "pasted":
      return "Using the pasted NEAR account (read-only — connect a wallet to sign)";
    case "rhea_recipient":
      return "Using the Rhea account from this preview";
    default:
      return "No NEAR account selected";
  }
}
