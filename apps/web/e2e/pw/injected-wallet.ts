/**
 * A test-only injected EIP-1193 wallet for Playwright.
 *
 * The app wires wagmi's dependency-free `injected()` connector, which reads `window.ethereum`
 * (and EIP-6963 announcements). This helper installs a fake `window.ethereum` backed by one or more
 * real viem accounts so the full non-custodial flow — connect → SIWE `personal_sign` → session —
 * runs end-to-end in a headless browser with NO real wallet extension.
 *
 * Signing happens in Node (viem), not in the page: `page.exposeFunction` bridges the injected
 * provider's `personal_sign` to a Node-side signer, so the private key never enters the browser.
 *
 * Multi-account + switching (for the wallet-switch regression test): pass `privateKeys` (index 0 is
 * the initially-active account) and later call {@link switchInjectedAccount} to emit `accountsChanged`
 * to a different account — the same signal a real extension fires when the user switches wallets.
 */

import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface InjectedWalletOptions {
  /** Single active account (back-compat). Ignored when `privateKeys` is given. */
  privateKey?: Hex;
  /** One or more accounts; index 0 is active initially. Enables {@link switchInjectedAccount}. */
  privateKeys?: Hex[];
  /** EVM chain id the wallet reports (default Base Sepolia 84532). */
  chainId?: number;
}

/**
 * Install the fake wallet on `page`. Must be called BEFORE the page navigates (it registers an
 * init script + an exposed signing function). Returns the initially-active wallet's address.
 */
export async function installInjectedWallet(
  page: Page,
  { privateKey, privateKeys, chainId = 84532 }: InjectedWalletOptions,
): Promise<`0x${string}`> {
  const keys = privateKeys ?? (privateKey ? [privateKey] : []);
  if (keys.length === 0) {
    throw new Error("installInjectedWallet: provide `privateKey` or a non-empty `privateKeys`");
  }
  const accounts = keys.map((k) => privateKeyToAccount(k));
  const byAddress = new Map(accounts.map((a) => [a.address.toLowerCase(), a] as const));

  // Node-side signer — the browser calls this for personal_sign with the ACTIVE address; the key
  // stays in Node. Signing by address keeps the correct account after a switch.
  await page.exposeFunction("__pwSign", async (messageHex: Hex, signer: string): Promise<Hex> => {
    const account = byAddress.get(signer.toLowerCase());
    if (!account) throw new Error(`__pwSign: no test account for ${signer}`);
    return account.signMessage({ message: { raw: messageHex } });
  });

  await page.addInitScript(
    ({ addresses, chainId }: { addresses: string[]; chainId: number }) => {
      const hexChain = "0x" + chainId.toString(16);
      let active = 0;
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const emit = (event: string, ...args: unknown[]) =>
        (listeners[event] || []).forEach((cb) => cb(...args));
      const sign = (data: string) =>
        (window as unknown as { __pwSign: (m: string, signer: string) => Promise<string> }).__pwSign(
          data,
          addresses[active],
        );

      const provider = {
        isMetaMask: true,
        isSparkPointTestWallet: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [addresses[active]];
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
              return await sign(data);
            }
            case "eth_sign": {
              const data = (params?.[1] as string) ?? "0x";
              return await sign(data);
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

      // Test hook: switch the active account and emit `accountsChanged` (what a real extension does
      // when the user picks a different wallet). Returns the newly-active address.
      (window as unknown as { __pwSetAccount: (i: number) => string }).__pwSetAccount = (i: number) => {
        active = ((i % addresses.length) + addresses.length) % addresses.length;
        emit("accountsChanged", [addresses[active]]);
        return addresses[active];
      };

      // Test hook: true once wagmi's connector has SUBSCRIBED to `accountsChanged`. Emitting a switch
      // before this is subscribed would be dropped (wagmi would keep the polled account), so tests
      // wait on this before switching — makes the switch deterministic instead of racy.
      (window as unknown as { __pwWalletReady: () => boolean }).__pwWalletReady = () =>
        (listeners["accountsChanged"]?.length ?? 0) > 0;

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
    { addresses: accounts.map((a) => a.address), chainId },
  );

  return accounts[0].address;
}

/**
 * Switch the injected wallet's active account (0-based index into the `privateKeys` passed to
 * {@link installInjectedWallet}) and fire `accountsChanged` — simulating the user switching wallets
 * in their extension. Returns the newly-active address.
 */
export async function switchInjectedAccount(page: Page, index: number): Promise<`0x${string}`> {
  return page.evaluate(
    (i) => (window as unknown as { __pwSetAccount: (i: number) => `0x${string}` }).__pwSetAccount(i),
    index,
  );
}

/**
 * Wait until wagmi's connector has subscribed to `accountsChanged` on the injected provider, so a
 * subsequent {@link switchInjectedAccount} is guaranteed to propagate (not dropped as a race).
 */
export async function waitForWalletReady(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __pwWalletReady?: () => boolean }).__pwWalletReady?.() === true,
    undefined,
    { timeout: timeoutMs },
  );
}
