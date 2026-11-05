/**
 * True iff the manual swap can operate on this chain in THIS build.
 *
 * Two gates must both pass: the shared chain registry knows it (address book + metadata), AND
 * this build's wagmi config actually registered it. The second gate matters on the beta build,
 * which registers Base + Robinhood Chain only — a wallet reporting Base Sepolia or a local fork
 * must NOT be treated as a supported swap chain, because wagmi reads/quotes scoped to an
 * unregistered chain throw and the page would otherwise imply a route that cannot execute.
 */

import { isSupportedChain } from "@sparkpoint/shared/chains";
import { wagmiConfig } from "@/lib/wagmi";

export function isSwapChain(chainId: number | undefined): boolean {
  return (
    chainId !== undefined &&
    isSupportedChain(chainId) &&
    wagmiConfig.chains.some((chain) => chain.id === chainId)
  );
}
