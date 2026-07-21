/**
 * A test-only BROADCASTING injected wallet for Playwright (real on-chain swap e2e, feature 007).
 *
 * Extends the connect/SIWE-only injected wallet (injected-wallet.ts) so it can also SIGN + BROADCAST
 * transactions: `eth_sendTransaction` is signed by a real viem account in Node and sent via an http
 * transport to the chain's RPC; any other RPC method the app calls through the wallet is proxied to a
 * Node viem PublicClient. The private key never enters the browser. This actually moves testnet funds,
 * so it is used only by the gated real-swap spec — NOT the normal CI suite.
 */

import type { Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, robinhoodTestnet } from "viem/chains";

const CHAINS = { 84532: baseSepolia, 46630: robinhoodTestnet } as const;

export interface BroadcastingWalletOptions {
  privateKey: Hex;
  /** 84532 (Base Sepolia) or 46630 (Robinhood testnet). */
  chainId: 84532 | 46630;
  /** The chain RPC the Node-side wallet/public clients use to estimate, sign, and broadcast. */
  rpcUrl: string;
}

/** Install a fake wallet that signs SIWE AND broadcasts real transactions. Call BEFORE navigation. */
export async function installBroadcastingWallet(
  page: Page,
  { privateKey, chainId, rpcUrl }: BroadcastingWalletOptions,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const chain = CHAINS[chainId];
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // personal_sign / eth_sign (SIWE) — signed in Node, key never in the browser.
  await page.exposeFunction("__pwSign", async (messageHex: Hex): Promise<Hex> =>
    account.signMessage({ message: { raw: messageHex } }),
  );

  // eth_sendTransaction — the real broadcast. viem fills nonce/gas/fees via the RPC, signs, and sends.
  await page.exposeFunction("__pwSendTx", async (tx: Record<string, string>): Promise<Hex> => {
    return walletClient.sendTransaction({
      account,
      chain,
      to: tx.to as `0x${string}`,
      data: tx.data as Hex | undefined,
      value: tx.value ? BigInt(tx.value) : undefined,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    });
  });

  // Any other RPC method the browser viem routes to the wallet → proxy to the real node.
  await page.exposeFunction("__pwRpc", async (method: string, params: unknown[]): Promise<unknown> =>
    publicClient.request({ method, params } as never),
  );

  await page.addInitScript(
    ({ address, chainId }: { address: string; chainId: number }) => {
      const hexChain = "0x" + chainId.toString(16);
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const emit = (event: string, ...args: unknown[]) => (listeners[event] || []).forEach((cb) => cb(...args));
      const w = window as unknown as {
        __pwSign: (m: string) => Promise<string>;
        __pwSendTx: (tx: unknown) => Promise<string>;
        __pwRpc: (m: string, p: unknown[]) => Promise<unknown>;
      };

      const provider = {
        isMetaMask: true,
        isSparkPointTestWallet: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address];
            case "eth_chainId":
              return hexChain;
            case "net_version":
              return String(chainId);
            case "wallet_switchEthereumChain":
              return null;
            case "wallet_requestPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "personal_sign":
              return w.__pwSign((params?.[0] as string) ?? "0x");
            case "eth_sign":
              return w.__pwSign((params?.[1] as string) ?? "0x");
            case "eth_sendTransaction":
              return w.__pwSendTx(params?.[0]);
            default:
              return w.__pwRpc(method, params ?? []);
          }
        },
        on(event: string, cb: (...args: unknown[]) => void) {
          (listeners[event] ||= []).push(cb);
          return provider;
        },
        removeListener(event: string, cb: (...args: unknown[]) => void) {
          listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
          return provider;
        },
      };

      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });

      const info = {
        uuid: "00000000-0000-0000-0000-0000000000fd",
        name: "SparkPoint Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        rdns: "io.sparkpoint.testwallet",
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
      setTimeout(() => emit("connect", { chainId: hexChain }), 0);
    },
    { address: account.address, chainId },
  );

  return account.address;
}
