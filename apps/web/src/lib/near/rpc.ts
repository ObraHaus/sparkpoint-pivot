import "server-only";

/**
 * 076 — read-only NEAR RPC lookup used by the login verifier.
 *
 * Only `view_access_key` (a read) is called. This module has NO transaction/send surface. The key
 * must be a FULL-ACCESS key of the account: a function-call key cannot sign an NEP-413 message,
 * and accepting one would let a restricted key authenticate as the whole account.
 */

const RPC_TIMEOUT_MS = 5_000;

function rpcUrl(): string {
  const explicit = process.env.NEAR_RPC_URL ?? process.env.NEXT_PUBLIC_NEAR_RPC_URL;
  if (explicit) return explicit;
  const network = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "").trim().toLowerCase();
  return network === "testnet" ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org";
}

/** True iff `publicKey` is a FullAccess key of `accountId`. Throws on an RPC/network failure. */
export async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  const resp = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "sp-near-login",
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`NEAR RPC HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    result?: { permission?: unknown };
    error?: { cause?: { name?: unknown }; name?: unknown };
  };
  if (data.error) {
    // UnknownAccount / UnknownAccessKey / etc. are a settled "not a key on this account".
    return false;
  }
  return data.result?.permission === "FullAccess";
}
