import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { CHAIN_IDS, isSupportedChain } from "@sparkpoint/shared/chains";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { robinhoodMainnet } from "@/lib/chain/clients";
import { requestMetaMaskProvider } from "@/lib/wallet/metamaskProvider";

/**
 * Wagmi config — Base (launch) + Base Sepolia (testnet) + Robinhood testnet (§B3, chat + read-only
 * portfolio; the vault stays Base-only). Non-custodial wallet auth (the user is the sole signer).
 * This UI build wires only the dependency-free `injected()` connector (browser wallets). The
 * WalletConnect + Coinbase Wallet connectors — and their SDKs — are added with the real wallet-auth
 * feature, not here. Robinhood testnet has no env RPC → viem's built-in default RPC is used.
 *
 * 024 — this list and `lib/network.tsx`'s supported/switchable/explorer maps used to be independent
 * re-derivations that could disagree about which chains exist. `network.tsx` now reads
 * `@sparkpoint/shared/chains`, and the assertion below ties THIS list to the same registry.
 *
 * WHY THE CHAIN OBJECTS STILL LIVE HERE. The shared registry is deliberately dependency-free (plain
 * `as const`, no viem/wagmi) so `apps/web` unit tests can value-import it under
 * `node --experimental-strip-types`. Putting wagmi `Chain` objects in it would break that. So the
 * id → `Chain` mapping stays here, and correctness is enforced by checking it against the registry
 * rather than by hoping the two lists match.
 *
 * BUILD-CONDITIONAL (§B beta). The mainnet-beta build (NEXT_PUBLIC_APP_CHAIN_ID=4663) registers
 * Base mainnet (8453) AND Robinhood mainnet (4663). Base is registered as a SOURCE chain only: the
 * cross-chain card can send USDC from the user's own Base wallet to a 1Click deposit address, which
 * is the demo's origin. It is not offered in the in-app switcher (CHAIN_META.base.switchable=false)
 * and no vault/swap flow treats it as the beta's home chain. Every other build (alpha/testnet, env
 * unset) registers Base + Base Sepolia + Robinhood testnet, unchanged. 4663 is safe to register:
 * its address book is wired + verified on-chain, and the agent accepts it with an EMPTY policy
 * allowlist (agent-mediated actions still fail closed; the swap is user-signed + non-custodial).
 * Still NOT registered anywhere: 31337 (local Anvil fork) — no wallet transport, no public explorer.
 */
const MAINNET_ONLY = APP_DEFAULT_CHAIN_ID === CHAIN_IDS.robinhoodMainnet;

const REGISTERED_CHAINS = MAINNET_ONLY
  ? ([base, robinhoodMainnet] as const)
  : ([base, baseSepolia, robinhoodTestnet] as const);

// Every chain wagmi can talk to MUST have metadata, or the app would render it as "Unsupported
// network" with no explorer link while still transacting on it. Checked at module load: this file is
// imported by the provider tree, so a mismatch fails fast in dev rather than surfacing as a missing
// explorer link on one chain in production.
for (const chain of REGISTERED_CHAINS) {
  if (!isSupportedChain(chain.id)) {
    throw new Error(
      `wagmi registers chain ${chain.id} (${chain.name}) but @sparkpoint/shared/chains has no ` +
        `metadata for it — add it to CHAIN_META so its name and explorer resolve.`,
    );
  }
}

// Guard the other direction for the chains we intend to offer in the wallet: a chain the shared
// registry marks `switchable` must be registered here, because `switchChain` can only target a
// registered chain. Without this, marking a chain switchable would produce a menu entry whose click
// silently does nothing.
const REQUIRED_CHAIN_ID = MAINNET_ONLY ? CHAIN_IDS.robinhoodMainnet : CHAIN_IDS.baseSepolia;
if (!REGISTERED_CHAINS.some((c) => c.id === REQUIRED_CHAIN_ID)) {
  throw new Error(
    `wagmi must register chain ${REQUIRED_CHAIN_ID} for this build (mainnet-only=${MAINNET_ONLY}).`,
  );
}

const metaMaskConnector = injected({
  target: {
    id: "metaMask",
    name: "MetaMask",
    provider: () => requestMetaMaskProvider() ?? undefined,
  },
});

export const wagmiConfig = createConfig({
  chains: REGISTERED_CHAINS,
  connectors: [metaMaskConnector],
  multiInjectedProviderDiscovery: false,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  // Transports for every chain any build MAY register (the chain list above is build-conditional).
  // wagmi only uses the transport whose chain is actually registered; the rest are inert. Providing
  // the full set keeps the union-typed chain list satisfied without a per-build transports branch.
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [robinhoodTestnet.id]: http(), // viem default RPC (rpc.testnet.chain.robinhood.com)
    [robinhoodMainnet.id]: http(process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL),
  },
});

/**
 * The chain-id union wagmi's hooks accept for `chainId` (the ids of `REGISTERED_CHAINS`).
 * Exported so call sites that feed a resolved-at-runtime chain id (e.g. `VAULT_CHAIN_ID`,
 * a `number`) into a wagmi read/write can assert it back into the config's union with one
 * shared type instead of re-deriving `(typeof wagmiConfig)["chains"][number]["id"]` inline.
 */
export type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
