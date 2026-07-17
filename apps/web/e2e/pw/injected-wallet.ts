/**
 * A test-only injected EIP-1193 wallet for Playwright.
 *
 * The app wires wagmi's dependency-free `injected()` connector, which reads `window.ethereum`
 * (and EIP-6963 announcements). This helper installs a fake `window.ethereum` backed by a real
 * viem account so the full non-custodial flow — connect → SIWE `personal_sign` → session — runs
 * end-to-end in a headless browser with NO real wallet extension.
 *
 * Signing happens in Node (viem), not in the page: `page.exposeFunction` bridges the injected
 * provider's `personal_sign` to a Node-side signer, so the private key never enters the browser.
 */

import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface InjectedWalletOptions {
  privateKey: Hex;
  /** EVM chain id the wallet reports (default Base Sepolia 84532). */
  chainId?: number;
}

/**
 * Install the fake wallet on `page`. Must be called BEFORE the page navigates (it registers an
 * init script + an exposed signing function). Returns the wallet's address.
 */
export async function installInjectedWallet(
  page: Page,
  { privateKey, chainId = 84532 }: InjectedWalletOptions,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);

  // Node-side signer — the browser calls this for personal_sign; the key stays in Node.
  await page.exposeFunction("__pwSign", async (messageHex: Hex): Promise<Hex> => {
    return account.signMessage({ message: { raw: messageHex } });
  });

  await page.addInitScript(
    ({ address, chainId }: { address: string; chainId: number }) => {
      const hexChain = "0x" + chainId.toString(16);
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const emit = (event: string, ...args: unknown[]) =>
        (listeners[event] || []).forEach((cb) => cb(...args));

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
              return null; // accept — we already report the target chain
            case "wallet_requestPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "personal_sign": {
              // params: [dataHex, address] (personal_sign) — sign in Node via the bridge.
              const data = (params?.[0] as string) ?? "0x";
              return await (
                window as unknown as { __pwSign: (m: string) => Promise<string> }
              ).__pwSign(data);
            }
            case "eth_sign": {
              const data = (params?.[1] as string) ?? "0x";
              return await (
                window as unknown as { __pwSign: (m: string) => Promise<string> }
              ).__pwSign(data);
            }
            default:
              throw Object.assign(new Error(`unsupported method ${method}`), { code: 4200 });
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

      // Primary discovery path: window.ethereum.
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });

      // EIP-6963 multi-wallet discovery (wagmi injected also listens for this).
      const info = {
        uuid: "00000000-0000-0000-0000-0000000000fe",
        name: "SparkPoint Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        rdns: "io.sparkpoint.testwallet",
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
      setTimeout(() => emit("connect", { chainId: hexChain }), 0);
    },
    { address: account.address, chainId },
  );

  return account.address;
}
