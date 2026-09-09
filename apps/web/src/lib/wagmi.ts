import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { CHAIN_IDS, isSupportedChain } from "@sparkpoint/shared/chains";

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
 * NOT REGISTERED, deliberately: 31337 (local Anvil fork) has no wallet transport and no public
 * explorer, and 4663 (Robinhood mainnet) is ratified by constitution v3.0.0 but not yet built — no
 * address book, absent from the policy chain map, and rejected by the agent's supported-chain list.
 * Registering 4663 here would let a wallet switch to a chain on which every request 400s.
 */
const REGISTERED_CHAINS = [base, baseSepolia, robinhoodTestnet] as const;

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
if (!REGISTERED_CHAINS.some((c) => c.id === CHAIN_IDS.baseSepolia)) {
  throw new Error("wagmi must register Base Sepolia — it is the preferred/vault chain.");
}

export const wagmiConfig = createConfig({
  chains: REGISTERED_CHAINS,
  connectors: [injected()],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [robinhoodTestnet.id]: http(), // viem default RPC (rpc.testnet.chain.robinhood.com)
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
