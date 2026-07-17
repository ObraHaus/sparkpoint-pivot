import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Wagmi config — Base (launch) + Base Sepolia (testnet) + Robinhood testnet (§B3, chat + read-only
 * portfolio; the vault stays Base-only). Non-custodial wallet auth (the user is the sole signer).
 * This UI build is wallet-inert and wires only the dependency-free `injected()` connector (browser
 * wallets). The WalletConnect + Coinbase Wallet connectors — and their SDKs
 * (`@walletconnect/ethereum-provider`, `@coinbase/wallet-sdk`) — are added with the real wallet-auth
 * feature, not here. Robinhood testnet has no env RPC → viem's built-in default RPC is used.
 */
export const wagmiConfig = createConfig({
  chains: [base, baseSepolia, robinhoodTestnet],
  connectors: [injected()],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [robinhoodTestnet.id]: http(), // viem default RPC (rpc.testnet.chain.robinhood.com)
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
