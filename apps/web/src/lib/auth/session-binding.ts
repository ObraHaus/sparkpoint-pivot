/**
 * Pure decision logic for binding a SIWE session to the LIVE connected wallet.
 *
 * Extracted from the `useSession` hook (which needs React + wagmi) so the rule can be unit-tested in
 * isolation — mirrors `computeBetaStatus` (pure) vs `useBeta` (hook) in ./whitelist.ts. NO imports,
 * so `node --test` can load it directly.
 *
 * WHY THIS EXISTS: a SIWE session proves control of EXACTLY ONE address and is stored in an httpOnly
 * cookie that the client never re-checked against the wallet actually in front of the user. So after
 * signing in with wallet A and then switching the browser extension to wallet B, the app kept
 * showing A's verdict (e.g. "not in the alpha yet") for B and offered no way to re-sign as B; the
 * reverse (A allowlisted → switch to non-allowlisted B) let B's browser coast on A's `beta` claim.
 * This predicate is the single source of truth for "the session no longer matches the live wallet".
 */

/** The only field of a session this rule needs (a full Session is structurally assignable). */
export interface AddressedSession {
  readonly address: string;
}

/**
 * True when the current SIWE session should be ended because it no longer matches the wallet the
 * user is connected with.
 *
 * @param session          the in-memory server session: `undefined` = still loading, `null` = signed
 *                         out, otherwise the resolved `{ address, ... }`.
 * @param connectedAddress the live wagmi `useAccount().address` (`undefined` when disconnected).
 * @param seenConnected    whether a connected wallet has EVER been observed in this hook instance.
 *
 * Returns `false` while the session is still loading or absent (nothing is bound yet), and — crucial
 * for the SSR/reconnect window on first load — while no wallet has been observed AND none is
 * connected (`seenConnected === false`, `connectedAddress === undefined`), so a valid cookie is NOT
 * dropped before wagmi finishes reconnecting. Returns `true` when:
 *   - a DIFFERENT wallet is connected than the one the session was minted for (case-insensitive), or
 *   - the wallet has fully DISCONNECTED after having been connected (`seenConnected === true`).
 */
export function isSessionWalletStale(
  session: AddressedSession | null | undefined,
  connectedAddress: string | undefined,
  seenConnected: boolean,
): boolean {
  if (session == null) return false; // loading (undefined) or signed out (null) → nothing bound
  if (connectedAddress) {
    return connectedAddress.toLowerCase() !== session.address.toLowerCase(); // switched wallets
  }
  return seenConnected; // no wallet connected: stale only if one was connected before (a disconnect)
}
