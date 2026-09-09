/**
 * T024 — per-chainId viem PublicClient factory (READ/DISPLAY plane).
 *
 * Direct-RPC read clients for Base mainnet (8453), Base Sepolia (84532), and the
 * local Anvil fork of Base mainnet (31337). These back the DISPLAY/READ
 * reconciliation surfaces — portfolio balances, the Trust Center, the
 * NonCustody badge — that verify chain state INDEPENDENTLY of the agent. The
 * chain is truth (N1/N2, agent-service-api.md §1.2): these clients never route
 * through the agent service and never carry custody authority; they only read.
 *
 * RPC selection follows the env-loader pattern: a caller-supplied
 * `NEXT_PUBLIC_*_RPC_URL` when set, else viem's built-in public endpoint for the
 * chain (`http()` with no url falls back to `chain.rpcUrls.default`).
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T024; addresses SoT chain
 * ids (@sparkpoint/shared CHAIN_ID: base 8453 · baseSepolia 84532 · localFork
 * 31337, R14).
 */

import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { base, baseSepolia, foundry, robinhoodTestnet } from "viem/chains";
import { CHAIN_ID, SUPPORTED_CHAIN_IDS, type ChainId } from "@sparkpoint/shared/policy";

/** Per-chain viem chain definition + the env var supplying its RPC url (public fallback). */
const CHAIN_CONFIG: Record<ChainId, { readonly chain: Chain; readonly rpcUrl: string | undefined }> = {
  [CHAIN_ID.base]: { chain: base, rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL },
  [CHAIN_ID.baseSepolia]: { chain: baseSepolia, rpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL },
  // localFork (Anvil fork of Base mainnet). `foundry` (31337) defaults to
  // http://127.0.0.1:8545 when NEXT_PUBLIC_LOCAL_FORK_RPC_URL is unset.
  [CHAIN_ID.localFork]: { chain: foundry, rpcUrl: process.env.NEXT_PUBLIC_LOCAL_FORK_RPC_URL },
  // §B3 Robinhood testnet (46630) — read-only display client; viem's default RPC when env unset.
  [CHAIN_ID.robinhoodTestnet]: {
    chain: robinhoodTestnet,
    rpcUrl: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL,
  },
};

/** One client per chainId — a PublicClient is a thin, reusable read handle. */
const clientCache = new Map<number, PublicClient>();

/**
 * The read-only viem {@link PublicClient} for `chainId`, memoized.
 *
 * @throws if `chainId` is not one of the supported chains (fail-closed — the same
 *   contract as `getPolicyConstants`/`getAddresses` in @sparkpoint/shared).
 */
export function getPublicClient(chainId: number): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached !== undefined) return cached;

  const config = CHAIN_CONFIG[chainId as ChainId];
  if (config === undefined) {
    throw new Error(
      `getPublicClient: unsupported chainId ${chainId} (supported: ${SUPPORTED_CHAIN_IDS.join(", ")})`,
    );
  }

  const client: PublicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  clientCache.set(chainId, client);
  return client;
}
