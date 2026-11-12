/**
 * 068/1113 — the `X-Chain-Id` header for 1Click cross-chain requests.
 *
 * The agent requires a supported EVM chain id on every user-scoped request. A cross-chain swap's
 * SOURCE chain is independent of the chain the SIWE session was created on: signing in on
 * Robinhood Chain (4663) and swapping from Base (8453) is legitimate because the session proves
 * the EVM ACCOUNT, not the network the user happens to be on. The header must therefore carry the
 * swap's source chain (not the session chain), or the agent has no chain to scope the request to.
 *
 * Omitting it entirely is what broke "Get deposit address": the card called the BFF with only
 * `content-type`, and the BFF (which forwards `x-chain-id` from the browser) had nothing to
 * forward for an EVM session, so the agent rejected the request as ACCOUNT_HEADERS_INVALID before
 * 1Click was ever asked for a quote. Nothing was signed.
 *
 * For an EVM origin the source chain is authoritative. For a non-EVM origin (BTC/SOL/NEAR) the
 * header is transport scoping only, so the caller's connected/app chain is used. The result is
 * ALWAYS a chain id the agent accepts — never `NaN`, never an unsupported network.
 */

import { CHAIN_IDS } from "@sparkpoint/shared/chains";

import { APP_DEFAULT_CHAIN_ID } from "../chain/appChain.ts";

/**
 * The EVM chain ids the agent's §1.2 header gate accepts (`API_SUPPORTED_CHAIN_IDS` in
 * `services/agent/src/sparkpoint_agent/api/security.py`). `isSupportedChain` also knows the local
 * Anvil fork (31337), which the agent deliberately rejects — never put that on the wire.
 */
const AGENT_CHAIN_IDS: ReadonlySet<number> = new Set([
  CHAIN_IDS.base,
  CHAIN_IDS.baseSepolia,
  CHAIN_IDS.robinhoodTestnet,
  CHAIN_IDS.robinhoodMainnet,
]);

function isAgentChain(chainId: number | null | undefined): chainId is number {
  return typeof chainId === "number" && Number.isInteger(chainId) && AGENT_CHAIN_IDS.has(chainId);
}

/**
 * Resolve the `x-chain-id` value for a cross-chain request.
 *
 * @param originEvmChainId the swap source's EVM chain id (the chat block's `origin.evmChainId`;
 *                         `null` for a non-EVM origin)
 * @param fallbackChainId  the connected wallet's chain, used only when the origin is non-EVM
 */
export function crosschainChainIdHeader(
  originEvmChainId: number | null | undefined,
  fallbackChainId?: number | null,
): string {
  if (isAgentChain(originEvmChainId)) return String(originEvmChainId);
  if (isAgentChain(fallbackChainId)) return String(fallbackChainId);
  // A non-EVM origin (or a wallet on an unsupported network) still needs a valid transport scope;
  // the app default is a chain the deployment actually supports.
  return String(
    AGENT_CHAIN_IDS.has(APP_DEFAULT_CHAIN_ID) ? APP_DEFAULT_CHAIN_ID : CHAIN_IDS.baseSepolia,
  );
}
