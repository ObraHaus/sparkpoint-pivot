/**
 * One pure description of "who is looking at the app right now".
 *
 * There are TWO independent identities in this product: the connected EVM wallet (wagmi) and a
 * server-verified NEAR session (NEP-413, recorded in the httpOnly session cookie). The UI used to
 * derive every connected label from wagmi alone, so a legitimate NEAR sign-in rendered as
 * "Not connected" beside a NEAR account — and the network pill fell through to "Unsupported
 * network". This helper keeps the distinction explicit:
 *
 * - `evmConnected` is TRUE only for a wagmi wallet. EVM-only actions must keep gating on it.
 * - `nearSignedIn` is TRUE only for a server-verified NEAR session with no EVM wallet. It is a
 *   real sign-in, not a client-side claim, but it never pretends an EVM wallet exists.
 *
 * Leaf module: no React, no Next, no wagmi — so `node --test` can pin the mapping directly.
 */

export type ViewerAuthChain = "evm" | "near";

export interface ViewerSession {
  readonly address: string;
  readonly chain: ViewerAuthChain;
}

export interface ViewerInput {
  /** wagmi reports a connected EVM wallet. */
  evmConnected: boolean;
  /** The connected EVM address, when there is one. */
  evmAddress?: string | null;
  /** The EVM chain's display name from the chain registry. */
  evmChainName: string;
  /** The server session, or `undefined` while it is still loading. */
  session: ViewerSession | null | undefined;
}

export interface ViewerState {
  /** wagmi has an EVM wallet — the ONLY flag EVM-only actions should trust. */
  evmConnected: boolean;
  /** A server-verified NEAR-only sign-in (no EVM wallet connected). */
  nearSignedIn: boolean;
  /** Either identity exists. */
  signedIn: boolean;
  /** The NEAR account id for a verified NEAR session, else `null`. */
  nearAccount: string | null;
  /** Network indicator: "NEAR" for a NEAR session, else the EVM chain name. */
  networkLabel: string;
  /** Account label (shortened), or "Not connected". */
  walletLabel: string;
  /** True only when NEITHER identity exists — the only state allowed a mock preview. */
  unconnected: boolean;
}

/** A short display form for either an 0x address or a NEAR account id. */
export function shortAccount(value: string): string {
  if (!value) return "Not connected";
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function viewerState(input: ViewerInput): ViewerState {
  // A NEAR session is bound to its own account; never read it as an EVM wallet. When an EVM
  // wallet IS connected, that is the identity the shell reports (the previous behaviour).
  const nearSignedIn = !input.evmConnected && input.session?.chain === "near";
  const nearAccount = nearSignedIn ? input.session?.address ?? null : null;
  const signedIn = input.evmConnected || nearSignedIn;
  const label = input.evmConnected
    ? shortAccount(input.evmAddress ?? "")
    : nearAccount
      ? shortAccount(nearAccount)
      : "Not connected";
  return {
    evmConnected: input.evmConnected,
    nearSignedIn,
    signedIn,
    nearAccount,
    networkLabel: nearSignedIn ? "NEAR" : input.evmChainName,
    walletLabel: label,
    unconnected: !signedIn,
  };
}
