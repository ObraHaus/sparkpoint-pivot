/**
 * Recovery for the ONE wallet-authorization failure that can hit SIWE signing.
 *
 * A SIWE signature (`personal_sign`) is only accepted for an account the origin is CURRENTLY
 * authorized to use. MetaMask answers `4100 UnauthorizedProviderError` ("The requested method
 * and/or account has not been authorized by the user") — with no popup — when its stored
 * permission no longer covers the address we ask it to sign with.
 *
 * The app can put itself in exactly that state: `disconnect()` on wagmi's injected connector
 * calls `wallet_revokePermissions` (wagmi `shimDisconnect`), while the automatic reconnect path
 * (`WagmiProvider` → `reconnect()` → `connect({ isReconnecting: true })`) only reads
 * `eth_accounts` and never re-requests permission. If a stale/persisted account survives that
 * read, the next signature is sent as an unauthorized account.
 *
 * These helpers re-establish the permission and let the caller retry ONCE. They are deliberately
 * provider-shaped (plain EIP-1193 `request`) so they are unit-testable without a wallet or React.
 */

/** The slice of an EIP-1193 provider this recovery needs. */
export interface Eip1193ProviderLike {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Walk `error` and its `cause` chain looking for a field. */
function findInErrorChain<T>(error: unknown, read: (e: Record<string, unknown>) => T | undefined): T | undefined {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 6; depth++) {
    if (typeof current !== "object") break;
    const value = read(current as Record<string, unknown>);
    if (value !== undefined) return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * True for viem's/provider's EIP-1193 `4100` unauthorized error (the SIWE 4100 we recover from).
 * Checks the numeric code (viem maps it) and the string code some wallets emit, plus the
 * `UnauthorizedProviderError` name, on both the error and its causes.
 */
export function isUnauthorizedProviderError(error: unknown): boolean {
  const code = findInErrorChain(error, (e) => e.code);
  if (code === 4100 || code === "4100") return true;
  return findInErrorChain(error, (e) => e.name) === "UnauthorizedProviderError";
}

/** True when the user rejected a wallet prompt (`4001`) — never auto-retry those. */
export function isUserRejectedError(error: unknown): boolean {
  const code = findInErrorChain(error, (e) => e.code);
  if (code === 4001 || code === "4001") return true;
  return findInErrorChain(error, (e) => e.name) === "UserRejectedRequestError";
}

/**
 * Re-request this origin's account authorization and return the accounts the wallet now exposes.
 *
 * Tries `wallet_requestPermissions` first (MetaMask's account-permission prompt); wallets that do
 * not implement it are tolerated (we fall through to the account reads). If the provider still
 * exposes no accounts, ask explicitly with `eth_requestAccounts` (the classic connect prompt).
 * A user rejection is rethrown so the caller can surface it instead of re-prompting.
 */
export async function reauthorizeAccounts(provider: Eip1193ProviderLike): Promise<string[]> {
  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (error) {
    if (isUserRejectedError(error)) throw error;
    // Not all injected wallets support `wallet_requestPermissions` (e.g. some mobile wallets).
    // Treat it as best-effort — the account reads below still establish what is authorized.
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
  if (Array.isArray(accounts) && accounts.length > 0) return accounts as string[];

  const requested = (await provider.request({ method: "eth_requestAccounts" })) as unknown;
  return Array.isArray(requested) ? (requested as string[]) : [];
}

/** Case-insensitive membership check for a wallet account list. */
export function authorizesAddress(accounts: readonly string[], address: string): boolean {
  const wanted = address.toLowerCase();
  return accounts.some((account) => account.toLowerCase() === wanted);
}

/** Read the wallet's current chain id (`eth_chainId`). `undefined` if it cannot be determined. */
export async function readWalletChainId(provider: Eip1193ProviderLike): Promise<number | undefined> {
  const raw = await provider.request({ method: "eth_chainId" });
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = raw.toLowerCase().startsWith("0x")
      ? Number.parseInt(raw, 16)
      : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** One SIWE signature request: the message, the address it is bound to, and its chain id. */
export interface SiweSignRequest {
  readonly message: string;
  readonly address: `0x${string}`;
  readonly chainId: number;
}

/** The effects the recovery needs, injected so this stays wallet/React-free and unit-testable. */
export interface SiweSignDeps {
  /** Sign `message` as the EXPLICIT `account` (never the connector's possibly-stale cached one). */
  sign(args: { message: string; account: `0x${string}` }): Promise<`0x${string}`>;
  /** The live connector provider, or `undefined` if there is none. */
  getProvider(): Promise<Eip1193ProviderLike | undefined>;
}

/**
 * Sign a SIWE message, recovering ONCE from a `4100` unauthorized-provider error.
 *
 * Fail-closed guards, in order, before the single retry:
 *   1. the wallet must still be on the chain the SIWE message was built for,
 *   2. the wallet must authorize the intended `address` (no signing as a different account).
 *
 * `4001` (user rejection) and every other error is thrown through untouched — never retried and
 * never escalated into an authorization prompt. A second `4100` propagates to the caller.
 */
export async function signSiweWithRecovery(
  deps: SiweSignDeps,
  request: SiweSignRequest,
): Promise<`0x${string}`> {
  const { message, address, chainId } = request;
  try {
    return await deps.sign({ message, account: address });
  } catch (signError) {
    if (!isUnauthorizedProviderError(signError)) throw signError;

    const provider = await deps.getProvider();
    if (!provider?.request) throw signError;

    const walletChainId = await readWalletChainId(provider);
    if (walletChainId === undefined) {
      throw new Error("Could not verify your wallet's network. Switch networks and try again.");
    }
    if (walletChainId !== chainId) {
      throw new Error("Your wallet is on a different network than this sign-in request. Switch networks and try again.");
    }

    const accounts = await reauthorizeAccounts(provider);
    if (!authorizesAddress(accounts, address)) {
      throw new Error("Your wallet authorized a different account. Reconnect your wallet and try again.");
    }

    // Exactly ONE retry, with the explicit intended account — never a loop.
    return await deps.sign({ message, account: address });
  }
}
