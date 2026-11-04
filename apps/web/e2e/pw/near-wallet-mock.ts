/**
 * 075 — an injected NEAR wallet for Playwright.
 *
 * Installs `window.__SP_NEAR_WALLET_MOCK__` BEFORE navigation. The app reads it only in a build
 * with `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` (production ignores it). All signing is mocked:
 * no key, no network, no transaction. The forbidden transaction methods throw if the adapter ever
 * reaches for them, so the spec can assert the call log stays sign-only.
 */

import type { Page } from "@playwright/test";

export const NEAR_TEST_ACCOUNT = "sparkpoint2026.near";
export const NEAR_TEST_PUBLIC_KEY = "ed25519:93KzqfxDmbFtSs5FCRJJGJpTg1Qc8r6oCzHyebrbnwr1";

export interface NearMockCallLog {
  connect: number;
  disconnect: number;
  signMessage: number;
  forbidden: string[];
}

export async function installNearWalletMock(
  page: Page,
  accountId = NEAR_TEST_ACCOUNT,
): Promise<void> {
  await page.addInitScript(
    ({
      accountId,
      publicKey,
    }: {
      accountId: string;
      publicKey: string;
    }) => {
      const KEY = "sp.near.mock.v1";
      type Stored = { connected: boolean; calls: { connect: number; disconnect: number; signMessage: number; forbidden: string[] } };
      const load = (): Stored => {
        try {
          const raw = sessionStorage.getItem(KEY);
          if (raw) return JSON.parse(raw) as Stored;
        } catch {
          // fall through
        }
        return { connected: false, calls: { connect: 0, disconnect: 0, signMessage: 0, forbidden: [] } };
      };
      const save = (state: Stored) => {
        sessionStorage.setItem(KEY, JSON.stringify(state));
      };
      const mock = {
        get calls() {
          return load().calls;
        },
        async connect() {
          const state = load();
          state.connected = true;
          state.calls.connect += 1;
          save(state);
          return { accountId, publicKey };
        },
        async disconnect() {
          const state = load();
          state.connected = false;
          state.calls.disconnect += 1;
          save(state);
        },
        async getAccount() {
          return load().connected ? { accountId, publicKey } : null;
        },
        async signMessage() {
          const state = load();
          state.calls.signMessage += 1;
          save(state);
          return { accountId, publicKey, signature: "ed25519:mock-signature-only" };
        },
        async signAndSendTransaction() {
          const state = load();
          state.calls.forbidden.push("signAndSendTransaction");
          save(state);
          throw new Error("signAndSendTransaction must never be called");
        },
        async signAndSendTransactions() {
          const state = load();
          state.calls.forbidden.push("signAndSendTransactions");
          save(state);
          throw new Error("signAndSendTransactions must never be called");
        },
        async signTransaction() {
          const state = load();
          state.calls.forbidden.push("signTransaction");
          save(state);
          throw new Error("signTransaction must never be called");
        },
      };
      (window as unknown as { __SP_NEAR_WALLET_MOCK__: typeof mock }).__SP_NEAR_WALLET_MOCK__ = mock;
    },
    { accountId, publicKey: NEAR_TEST_PUBLIC_KEY },
  );
}

export async function nearMockCalls(page: Page): Promise<NearMockCallLog> {
  return page.evaluate(() => {
    const mock = (window as unknown as { __SP_NEAR_WALLET_MOCK__?: { calls: NearMockCallLog } })
      .__SP_NEAR_WALLET_MOCK__;
    return mock?.calls ?? { connect: 0, disconnect: 0, signMessage: 0, forbidden: [] };
  });
}

/**
 * A signing-free injected EVM identity. The NEAR feature test already holds a locally-signed
 * session cookie, so it only needs wagmi to report an account (the agent hooks are "online"); no
 * SIWE signature and therefore no private key is required.
 */
export async function installInjectedEvmIdentity(
  page: Page,
  address: string,
  chainId = 8453,
): Promise<void> {
  await page.addInitScript(
    ({ address, chainId }: { address: string; chainId: number }) => {
      const hexChain = "0x" + chainId.toString(16);
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const emit = (event: string, ...args: unknown[]) =>
        (listeners[event] || []).forEach((cb) => cb(...args));
      const provider = {
        isMetaMask: true,
        isSparkPointTestWallet: true,
        async request({ method }: { method: string; params?: unknown[] }) {
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
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
      window.dispatchEvent(new Event("ethereum#initialized"));
      queueMicrotask(() => emit("connect", { chainId: hexChain }));
    },
    { address, chainId },
  );
}
