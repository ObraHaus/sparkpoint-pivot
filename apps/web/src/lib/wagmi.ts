import { http, createConfig, cookieStorage, createStorage } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Wagmi config — Base (launch) + Base Sepolia (testnet).
 * Non-custodial wallet auth (the user is the sole signer). This UI build is wallet-inert
 * and wires only the dependency-free `injected()` connector (browser wallets). The
 * WalletConnect + Coinbase Wallet connectors — and their SDKs (`@walletconnect/ethereum-provider`,
 * `@coinbase/wallet-sdk`) — are added with the real wallet-auth feature, not here.
 */
export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [injected()],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
