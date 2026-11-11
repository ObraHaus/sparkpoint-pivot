/**
 * Pure live-state copy for the portfolio surfaces.
 *
 * The chat right rail and the /portfolio page show direct-RPC EVM reads. A server-verified NEAR
 * session is signed in but has no EVM wallet, so it must NOT be treated as "disconnected" (which
 * used to reveal the illustrative $12,184.42 preview) and must NOT be treated as an EVM wallet
 * either. These helpers keep that middle state explicit and unit-testable.
 */

export type PortfolioArea = "portfolio" | "history" | "allocation" | "positions";

/** The rail may show the illustrative preview ONLY when nobody is signed in AND the session resolved. */
export function railShowsMockPreview(input: {
  evmConnected: boolean;
  nearSignedIn: boolean;
  sessionLoading?: boolean;
}): boolean {
  return !input.evmConnected && !input.nearSignedIn && !input.sessionLoading;
}

/** The honest sub-line under the rail's Portfolio figure. */
export function railPortfolioNote(input: {
  nearSignedIn: boolean;
  preview: boolean;
  live: boolean;
  loading: boolean;
  sessionLoading?: boolean;
}): string {
  if (input.sessionLoading) return "Checking your session…";
  if (input.loading) return "…";
  if (input.live) return "USDC · vault + wallet";
  if (input.preview) return "Preview — connect for your position";
  if (input.nearSignedIn) return "Vault position is EVM-only — connect an EVM wallet.";
  return "Position unavailable right now";
}

/** The /portfolio empty-state copy for a signed-in NEAR viewer vs an anonymous browser. */
export function portfolioConnectCopy(input: {
  nearSignedIn: boolean;
  area: PortfolioArea;
  sessionLoading?: boolean;
}): string {
  // The session is still resolving: this is neither an anonymous browser nor a NEAR session, so
  // never prompt a connect that may be wrong. A neutral check is the honest state.
  if (input.sessionLoading) return "Checking your session…";
  if (!input.nearSignedIn) {
    switch (input.area) {
      case "history":
        return "Connect your wallet to see your history.";
      case "allocation":
        return "Connect your wallet to see your allocation.";
      case "positions":
        return "Connect your wallet to see your positions.";
      default:
        return "Connect your wallet to see your portfolio.";
    }
  }
  const tail = " NEAR/Rhea positions are under Across chains.";
  switch (input.area) {
    case "history":
      return `Connect an EVM wallet to see your EVM vault history.${tail}`;
    case "allocation":
      return `Connect an EVM wallet to see your EVM allocation.${tail}`;
    case "positions":
      return `Connect an EVM wallet to see your EVM positions.${tail}`;
    default:
      return `Connect an EVM wallet to see your EVM vault position.${tail}`;
  }
}
