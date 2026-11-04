/**
 * 075 — the small NEAR wallet adapter.
 *
 * Deliberately narrow: connect / disconnect / read the account / sign a NEP-413 message. There is
 * NO transaction surface here — no signAndSendTransaction, no signTransaction, no broadcast — and
 * the production client never adds an access key (`signInWithoutAddKey` only; no `contractId`).
 *
 * Library: `@hot-labs/near-connect` (pinned). It is imported lazily and client-side only, so SSR
 * never touches `window`/IndexedDB. Meteor is attempted first; if it is not in the manifest the
 * library's own picker is opened instead.
 *
 * Test/e2e injection: a `window.__SP_NEAR_WALLET_MOCK__` hook is read ONLY when the build env
 * `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` is inlined. Production builds leave it unset, so the
 * branch is dead code there and the hook cannot exist.
 */

import type { NearNetwork } from "./network";

export interface NearAccount {
  readonly accountId: string;
  readonly publicKey?: string;
}

export interface NearSignedMessage {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
}

export interface NearSignMessageParams {
  readonly message: string;
  readonly recipient: string;
  readonly nonce: Uint8Array;
}

export interface NearWalletAdapter {
  connect(): Promise<NearAccount>;
  disconnect(): Promise<void>;
  getAccount(): Promise<NearAccount | null>;
  signMessage(params: NearSignMessageParams): Promise<NearSignedMessage>;
}

/** The minimal shape of a connected wallet we use — transaction methods are intentionally absent. */
export interface NearWalletHandle {
  getAccounts(data?: { network?: NearNetwork }): Promise<NearAccount[]>;
  signMessage(params: NearSignMessageParams): Promise<NearSignedMessage>;
  signOut?(data?: { network?: NearNetwork }): Promise<void>;
}

export interface NearConnectorHandle {
  connect(input?: { walletId?: string }): Promise<NearWalletHandle>;
  disconnect(wallet?: NearWalletHandle): Promise<void>;
  getConnectedWallet(): Promise<{ wallet: NearWalletHandle; accounts: NearAccount[] }>;
  wallet(id?: string | null): Promise<NearWalletHandle>;
}

/** The e2e hook surface. It is read only when the test build flag is on. */
export interface NearWalletMock {
  connect(): Promise<NearAccount>;
  disconnect(): Promise<void>;
  getAccount(): Promise<NearAccount | null>;
  signMessage(params: NearSignMessageParams): Promise<NearSignedMessage>;
}

export interface NearAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ACCOUNT_KEY = "sp.near.account.v1";
const METEOR_WALLET_ID = "meteor-wallet";

function windowStorage(): NearAccountStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The e2e hook, but only in a build that explicitly opted in. */
export function readNearWalletTestHook(): NearWalletMock | null {
  if (process.env.NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK !== "true") return null;
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { __SP_NEAR_WALLET_MOCK__?: NearWalletMock })
    .__SP_NEAR_WALLET_MOCK__;
  return candidate ?? null;
}

async function loadNearConnector(network: NearNetwork): Promise<NearConnectorHandle> {
  const { NearConnector } = await import("@hot-labs/near-connect");
  const nonce =
    typeof document === "undefined"
      ? undefined
      : (document.querySelector("script[nonce]")?.getAttribute("nonce") ?? undefined);
  const connector = new NearConnector({
    network,
    autoConnect: false,
    // No access key at sign-in: this feature is account-read + message-signature only.
    features: { signInWithoutAddKey: true, signMessage: true },
    cspNonce: nonce,
    footerBranding: null,
  });
  return connector as unknown as NearConnectorHandle;
}

export interface NearWalletClientOptions {
  readonly network: NearNetwork;
  readonly storage?: NearAccountStorage | null;
  readonly mock?: NearWalletMock | null;
  readonly connectorFactory?: (network: NearNetwork) => Promise<NearConnectorHandle>;
}

export class NearWalletClient implements NearWalletAdapter {
  private readonly network: NearNetwork;
  private readonly storage: NearAccountStorage | null;
  private readonly mock: NearWalletMock | null;
  private readonly connectorFactory: (network: NearNetwork) => Promise<NearConnectorHandle>;
  private connector: NearConnectorHandle | null = null;
  private wallet: NearWalletHandle | null = null;

  constructor(options: NearWalletClientOptions) {
    this.network = options.network;
    this.storage = options.storage === undefined ? windowStorage() : options.storage;
    this.mock = options.mock ?? null;
    this.connectorFactory = options.connectorFactory ?? loadNearConnector;
  }

  private persist(accountId: string | null): void {
    try {
      if (accountId) this.storage?.setItem(ACCOUNT_KEY, accountId);
      else this.storage?.removeItem(ACCOUNT_KEY);
    } catch {
      // Storage is a convenience only; a blocked localStorage must not break connecting.
    }
  }

  private async ensureConnector(): Promise<NearConnectorHandle> {
    this.connector ??= await this.connectorFactory(this.network);
    return this.connector;
  }

  async connect(): Promise<NearAccount> {
    if (this.mock) {
      const account = await this.mock.connect();
      this.persist(account.accountId);
      return account;
    }
    const connector = await this.ensureConnector();
    let wallet: NearWalletHandle;
    try {
      // Meteor first, by manifest id — no picker when it is available.
      wallet = await connector.connect({ walletId: METEOR_WALLET_ID });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only fall back to the library picker when Meteor is not offered. A user rejection must
      // surface as a rejection instead of silently opening another wallet.
      if (!/not found|not available|unknown wallet|manifest/i.test(message)) throw error;
      wallet = await connector.connect();
    }
    const accounts = await wallet.getAccounts({ network: this.network });
    const account = accounts[0];
    if (!account) throw new Error("The NEAR wallet returned no account.");
    this.wallet = wallet;
    this.persist(account.accountId);
    return account;
  }

  async disconnect(): Promise<void> {
    if (this.mock) {
      await this.mock.disconnect();
      this.persist(null);
      return;
    }
    const connector = this.connector;
    if (connector) {
      await connector.disconnect(this.wallet ?? undefined).catch(() => undefined);
    }
    this.wallet = null;
    this.connector = null;
    this.persist(null);
  }

  async getAccount(): Promise<NearAccount | null> {
    if (this.mock) return this.mock.getAccount();
    const stored = (() => {
      try {
        return this.storage?.getItem(ACCOUNT_KEY) ?? null;
      } catch {
        return null;
      }
    })();
    return stored ? { accountId: stored } : null;
  }

  async signMessage(params: NearSignMessageParams): Promise<NearSignedMessage> {
    if (this.mock) return this.mock.signMessage(params);
    const connector = await this.ensureConnector();
    if (!this.wallet) {
      const connected = await connector.getConnectedWallet();
      this.wallet = connected.wallet;
    }
    return this.wallet.signMessage(params);
  }
}

export function createNearWalletAdapter(options: {
  network: NearNetwork;
  storage?: NearAccountStorage | null;
  mock?: NearWalletMock | null;
  connectorFactory?: (network: NearNetwork) => Promise<NearConnectorHandle>;
}): NearWalletAdapter {
  const mock = options.mock === undefined ? readNearWalletTestHook() : options.mock;
  return new NearWalletClient({ ...options, mock });
}
