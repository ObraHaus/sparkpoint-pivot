/**
 * 075 — NEAR network resolution from the web env.
 *
 * `NEXT_PUBLIC_NEAR_NETWORK` is `mainnet` (default) or `testnet`; anything else falls back to
 * mainnet rather than guessing. `NEXT_PUBLIC_NEAR_RPC_URL` is OPTIONAL and only ever used for
 * read-only lookups — the wallet connector itself is never pointed at it and no transaction is
 * sent from this module. Both names are documented in DEVELOPMENT.md / COOLIFY.md; neither has a
 * committed value.
 */

export type NearNetwork = "mainnet" | "testnet";

export const DEFAULT_NEAR_NETWORK: NearNetwork = "mainnet";

/** Parse a raw env value. Invalid/blank ⇒ mainnet (never testnet by accident). */
export function parseNearNetwork(value: string | null | undefined): NearNetwork {
  return (value ?? "").trim().toLowerCase() === "testnet" ? "testnet" : DEFAULT_NEAR_NETWORK;
}

/** The build-time network (Next inlines the `NEXT_PUBLIC_*` read). */
export function nearNetworkFromEnv(): NearNetwork {
  return parseNearNetwork(process.env.NEXT_PUBLIC_NEAR_NETWORK);
}

/**
 * Parse an optional read-only NEAR RPC URL. Only an absolute http(s) URL is accepted; anything
 * malformed is treated as "not configured" so a typo can never become a request target.
 */
export function parseNearRpcUrl(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function nearRpcUrlFromEnv(): string | undefined {
  return parseNearRpcUrl(process.env.NEXT_PUBLIC_NEAR_RPC_URL);
}
