/**
 * 1113 — bind a browser-asserted `X-Account` / `X-Owner` to the verified SIWE session.
 *
 * The BFF is the ONLY authority that sets the agent's identity headers: it derives
 * `X-Account`/`X-Owner` from the verified session cookie and drops any client-supplied copy. This
 * predicate makes the "drop" explicit and testable — a client that asserts a DIFFERENT account is
 * rejected (400 ACCOUNT_HEADERS_INVALID) instead of being silently rewritten, so a request can
 * never act as another wallet even if a future caller starts forwarding these headers.
 *
 * A NEAR (NEP-413) session is deliberately exempt: it is not wagmi-bound, and a user may have an
 * EVM wallet connected alongside it. The BFF still scopes every request to the session's NEAR
 * account, so a client EVM header is not an assertion about the session identity.
 *
 * Case-insensitive: the session stores a lowercase 0x address while wagmi/viem hand back the
 * EIP-55 checksummed form of the SAME wallet.
 */

export interface SessionIdentity {
  readonly address: string;
  readonly chain?: "evm" | "near";
}

/** True when a client-supplied account/owner contradicts the verified EVM session. */
export function isClientAccountMismatched(
  session: SessionIdentity,
  clientAccount: string | null,
  clientOwner: string | null,
): boolean {
  if (session.chain === "near") return false;
  const sessionAddress = session.address.trim().toLowerCase();
  const matches = (value: string | null): boolean =>
    value === null || value.trim().toLowerCase() === sessionAddress;
  return !matches(clientAccount) || !matches(clientOwner);
}
