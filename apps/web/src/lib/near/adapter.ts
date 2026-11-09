/**
 * 075/078 — the small NEAR wallet adapter.
 *
 * 075 surface: connect / disconnect / read the account / sign a NEP-413 message. Those methods
 * never build or broadcast a transaction.
 *
 * 078 adds ONE explicit transaction capability, `sendTransactions`, used ONLY by the Rhea
 * same-chain live earn confirm step after a reviewed, acknowledged plan. It re-checks the connected
 * account immediately before asking the wallet, so a wallet switch refuses instead of sending from
 * a different account. No login/NEP-413 path calls it. The production client still never adds an
 * access key (`signInWithoutAddKey` only; no `contractId`).
 *
 * Library: `@hot-labs/near-connect` (pinned). It is imported lazily and client-side only, so SSR
 * never touches `window`/IndexedDB. Meteor is attempted first; if it is not in the manifest the
 * library's own picker is opened instead.
 *
 * Test/e2e injection: a `window.__SP_NEAR_WALLET_MOCK__` hook is read ONLY when the build env
 * `NEXT_PUBLIC_NEAR_WALLET_TEST_HOOK=true` is inlined. Production builds leave it unset, so the
 * branch is dead code there and the hook cannot exist.
 */

import type { NearTransaction, NearTransactionOutcome } from "./burrow.ts";
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

export interface SendTransactionsOptions {
  /** Refuse if the wallet's connected account is no longer this id (checked immediately before send). */
  readonly expectedAccountId?: string;
}

export interface NearWalletAdapter {
  connect(): Promise<NearAccount>;
  disconnect(): Promise<void>;
  getAccount(): Promise<NearAccount | null>;
  /** 078 — read the wallet's CURRENT account (not the stored display id) before a send. */
  getConnectedAccount(): Promise<NearAccount | null>;
  signMessage(params: NearSignMessageParams): Promise<NearSignedMessage>;
  /**
   * 078 — explicit transaction capability for the live earn confirm step only. The adapter verifies
   * the connected account immediately before calling the wallet and refuses a wallet switch.
   */
  sendTransactions(
    transactions: readonly NearTransaction[],
    options?: SendTransactionsOptions,
  ): Promise<NearTransactionOutcome[]>;
}

/** The minimal shape of a connected wallet we use. Transaction methods are touched only by `sendTransactions`. */
export interface NearWalletHandle {
  getAccounts(data?: { network?: NearNetwork }): Promise<NearAccount[]>;
  signMessage(params: NearSignMessageParams): Promise<NearSignedMessage>;
  signAndSendTransactions?(params: {
    network?: NearNetwork;
    signerId?: string;
    transactions: Array<{ receiverId: string; actions: unknown[] }>;
  }): Promise<NearTransactionOutcome[]>;
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
  /** Optional on purpose: login-path mocks do not implement transaction methods. */
  signAndSendTransactions?(params: {
    network?: NearNetwork;
    transactions: Array<{ receiverId: string; actions: unknown[] }>;
  }): Promise<NearTransactionOutcome[]>;
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
    // 075 login needs account-read + message-signature; 078's live earn confirm additionally
    // advertises the transaction capability, but nothing invokes it on the login path.
    features: { signInWithoutAddKey: true, signMessage: true, signAndSendTransactions: true },
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

  async getConnectedAccount(): Promise<NearAccount | null> {
    if (this.mock) return this.mock.getAccount();
    const connector = await this.ensureConnector();
    if (!this.wallet) {
      try {
        const connected = await connector.getConnectedWallet();
        this.wallet = connected.wallet;
      } catch {
        return null;
      }
    }
    const accounts = await this.wallet.getAccounts({ network: this.network });
    return accounts[0] ?? null;
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

  /**
   * 078 — the ONLY transaction call in the web app. It is separate from connect/signMessage and is
   * used solely by the reviewed live earn confirm step. The connected account is re-read from the
   * wallet immediately before the signature request; a switch (or a vanished account) refuses.
   */
  async sendTransactions(
    transactions: readonly NearTransaction[],
    options?: SendTransactionsOptions,
  ): Promise<NearTransactionOutcome[]> {
    if (transactions.length === 0) throw new Error("No transactions to send.");
    if (this.mock) {
      const account = await this.mock.getAccount();
      if (options?.expectedAccountId && account?.accountId !== options.expectedAccountId) {
        throw new Error("The connected NEAR account changed. Refusing to send; nothing was signed.");
      }
      if (!this.mock.signAndSendTransactions) {
        throw new Error("This NEAR wallet mock has no transaction capability.");
      }
      return this.mock.signAndSendTransactions({
        network: this.network,
        transactions: transactions.map((tx) => ({ receiverId: tx.receiverId, actions: [...tx.actions] })),
      });
    }

    const connector = await this.ensureConnector();
    if (!this.wallet) {
      const connected = await connector.getConnectedWallet();
      this.wallet = connected.wallet;
    }
    const accounts = await this.wallet.getAccounts({ network: this.network });
    const currentAccountId = accounts[0]?.accountId ?? null;
    if (options?.expectedAccountId && currentAccountId !== options.expectedAccountId) {
      throw new Error("The connected NEAR account changed. Refusing to send; nothing was signed.");
    }
    if (!this.wallet.signAndSendTransactions) {
      throw new Error("The connected NEAR wallet does not support sending transactions.");
    }
    return this.wallet.signAndSendTransactions({
      network: this.network,
      signerId: options?.expectedAccountId ?? undefined,
      transactions: transactions.map((tx) => ({ receiverId: tx.receiverId, actions: [...tx.actions] })),
    });
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
