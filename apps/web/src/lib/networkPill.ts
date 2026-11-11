/**
 * The top-bar network pill's user-visible label.
 *
 * Kept pure so the multi-network state (connected EVM chain + optional NEAR account) can be
 * unit-tested without rendering the whole shell. The pill shows the EVM chain name and appends
 * `· NEAR` when a NEAR account is connected, or `NEAR` for a server-verified NEP-413 session.
 */
export interface NetworkPillInput {
  /** The wallet's chain id is still hydrating, so the name is not trustworthy yet. */
  networkSettling: boolean;
  /** Connected on a chain this build does not serve. */
  wrongNetwork: boolean;
  /** The connected EVM network's display name. */
  networkName: string;
  /** The connected NEAR account id, when one is connected. */
  nearAccountId?: string | null;
}

export function networkPillLabel({
  networkSettling,
  wrongNetwork,
  networkName,
  nearAccountId,
}: NetworkPillInput): string {
  if (networkSettling) return "Checking…";
  if (wrongNetwork) return "Unsupported network";
  return `${networkName}${nearAccountId ? " · NEAR" : ""}`;
}
