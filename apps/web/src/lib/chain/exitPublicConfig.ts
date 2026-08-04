/**
 * 041 — the /exit page's PUBLIC-pinned read config (N2 / FR-016).
 *
 * Feature 041 routes the app's browser reads through the SparkPoint-operated RPC proxy
 * (`NEXT_PUBLIC_*_RPC_URL` → the proxy's `app` lane). That is correct everywhere EXCEPT the
 * withdraw-always escape hatch: /exit must keep working with every SparkPoint-operated
 * component offline — including the proxy — so its reads may not depend on those env values.
 *
 * This config pins /exit's reads to each chain's built-in PUBLIC endpoint (`http()` with no
 * url → viem's `chain.rpcUrls.default`), BY CONSTRUCTION rather than by fallback: no env var
 * is consulted at all. Read-only — it registers no connectors; connecting, signing, and
 * sending stay on the app's main wagmi config (the wallet is the transport for writes).
 *
 * Verified live by quickstart Stage 3: /exit loads and reads vault state with the proxy
 * container STOPPED (SC-008).
 */

import { http, createConfig } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";

export const exitPublicConfig = createConfig({
  chains: [base, baseSepolia, robinhoodTestnet],
  ssr: true,
  transports: {
    [base.id]: http(),            // viem default: https://mainnet.base.org
    [baseSepolia.id]: http(),     // viem default: https://sepolia.base.org
    [robinhoodTestnet.id]: http(), // viem default: rpc.testnet.chain.robinhood.com
  },
});

/** The chain ids this config can read. */
export type ExitChainId = (typeof exitPublicConfig)["chains"][number]["id"];

const EXIT_CHAIN_IDS: ReadonlySet<number> = new Set(exitPublicConfig.chains.map((c) => c.id));

/**
 * Narrow the wallet's chainId to one this config serves. REQUIRED on every read that uses
 * `exitPublicConfig`: with no connector, the config's "current chain" is just the first in the
 * list (Base mainnet), so a read without an explicit `chainId` would silently target the wrong
 * chain. `undefined` (unsupported chain) leaves the read disabled at the call site — the page
 * already gates on `vaultAddressFor`, which is undefined for exactly the same chains.
 */
export function exitReadChainId(chainId: number | undefined): ExitChainId | undefined {
  return chainId !== undefined && EXIT_CHAIN_IDS.has(chainId) ? (chainId as ExitChainId) : undefined;
}
