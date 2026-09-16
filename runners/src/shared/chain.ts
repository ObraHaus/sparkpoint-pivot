import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The chain these runners talk to, taken from the environment.
 *
 * ⚠️⚠️ **This is the sibling of the simulation's `assertSimulation()`, and it matters more.** There,
 * the guard existed to stop a service reaching the live chain by accident. Here the service is
 * *meant* to be on the live chain, so the guard's job is the other direction: prove the node on the
 * other end is the chain you configured **before** signing anything. Under EIP-155 a signature is
 * bound to a chain id, so a book that says 4663 and a node that answers something else is the one
 * combination that produces real transactions in a place nobody meant.
 */
export const CHAINS = {
  4663: { name: "Robinhood Chain", testnet: false },
  46630: { name: "Robinhood Chain Testnet", testnet: true },
  46633: { name: "Robin Brokers Simulation", testnet: true },
} as const;

export type KnownChainId = keyof typeof CHAINS;

export function isKnownChain(id: number): id is KnownChainId {
  return id in CHAINS;
}

let cachedChain: Chain | undefined;

export function chain(): Chain {
  if (cachedChain) return cachedChain;
  const id = Number(required("CHAIN_ID"));
  if (!isKnownChain(id)) {
    throw new Error(`CHAIN_ID=${id} is not a chain this project knows about`);
  }
  cachedChain = defineChain({
    id,
    name: CHAINS[id].name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl()] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    testnet: CHAINS[id].testnet,
  });
  return cachedChain;
}

export function rpcUrl(): string {
  return required("RPC_URL");
}

let cachedPublic: PublicClient | undefined;

export function publicClient(): PublicClient {
  cachedPublic ??= createPublicClient({
    chain: chain(),
    // ⚠️⚠️ **No transport-level JSON-RPC batching.** `batch: { wait: 16 }` collapsed viem's
    // multicall — which already splits a wide read into ~150 internal `aggregate3` calls — into a
    // single oversized JSON-RPC batch the node rejects. With `allowFailure: true` that came back as
    // *every* id failed, so the keeper's full-collection `isActive` read reported zero brokers
    // clocked in and `deliver` ran for no one, every round, for weeks — while `settle` (a lone call)
    // kept working and the container stayed healthy. Proven: batched → 0/2222 succeed, unbatched →
    // 2222/2222. These runners make few reads and do not need batching.
    transport: http(rpcUrl()),
  });
  return cachedPublic;
}

/**
 * Assert the node really is the chain we were configured for, before anything is signed.
 *
 * ⚠️ Two calls, not one, and deliberately so. Some RPC front ends answer `eth_chainId` from a cache
 * and keep answering it after the node behind them has gone — so a chain id alone can be correct
 * about a node that is not there. `eth_blockNumber` has to reach the node to be answered, which
 * makes the pair "the right chain" *and* "actually reachable" rather than only the first.
 */
export async function assertChain(): Promise<void> {
  const want = chain().id;
  const client = publicClient();

  const got = await client.getChainId();
  if (got !== want) {
    throw new Error(
      `the node at ${redact(rpcUrl())} reports chain ${got}; CHAIN_ID says ${want}. Refusing to ` +
        `run: an EIP-155 signature is bound to a chain id, so this is how a transaction lands ` +
        `somewhere nobody meant.`,
    );
  }

  const height = await client.getBlockNumber();
  if (height === 0n) {
    throw new Error(`the node at ${redact(rpcUrl())} reports height 0 — it is not serving a chain`);
  }
}

/** Never log a provider URL whole: they carry API keys in the path or a query string. */
export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "<unparseable RPC_URL>";
  }
}

export function walletFor(privateKey: string): WalletClient {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (key.length !== 66) throw new Error("a private key is 32 bytes of hex");
  return createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain: chain(),
    transport: http(rpcUrl()),
  });
}

export function accountOf(wallet: WalletClient): Address {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  return account.address;
}

/** Read a required environment variable, or fail with a sentence naming it. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name}=${raw} is not a number`);
  return value;
}

/**
 * Warn — loudly, and every tick — when a runner's wallet is running out of gas.
 *
 * ⚠️⚠️ **The simulation's version of this function topped the wallet up.** It could: ETH is free on
 * a fork, and `anvil_setBalance` made a low balance self-healing. On a real chain nothing can mint
 * you gas, so the same condition is an outage — and it is an outage with a particularly bad
 * disguise. The simulation already lived through it once: a sweeper with an empty wallet logged
 * "nothing to collect" every minute, because a call it could not send and a call with nothing to do
 * are indistinguishable from the outside.
 *
 * So this returns the balance and says so at `warn` rather than pretending. Wire your alerting to
 * the warning, not to the process being up: a runner out of gas stays up, stays quiet, and stops
 * delivering.
 */
export async function warnIfLowOnGas(
  address: Address,
  floorWei: bigint,
  log: { warn: (message: string) => void },
): Promise<bigint> {
  const balance = await publicClient().getBalance({ address });
  if (balance < floorWei) {
    log.warn(
      `${address} holds ${balance} wei, below the floor of ${floorWei}. Nothing here can top it ` +
        `up. Until it is funded this runner will keep ticking and keep doing nothing.`,
    );
  }
  return balance;
}
