import "server-only";

/**
 * 076/078 — read-only NEAR RPC lookups.
 *
 * Only view/query/block/tx requests are made. This module has NO transaction/send surface: it never
 * signs, submits or broadcasts. The login verifier uses `view_access_key`; the Rhea live earn
 * preflight uses the contract views below to build an UNSIGNED plan.
 */

const RPC_TIMEOUT_MS = 5_000;

function rpcUrl(): string {
  const explicit = process.env.NEAR_RPC_URL ?? process.env.NEXT_PUBLIC_NEAR_RPC_URL;
  if (explicit) return explicit;
  const network = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "").trim().toLowerCase();
  return network === "testnet" ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org";
}

async function rpcCall<T>(body: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  const resp = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`NEAR RPC HTTP ${resp.status}`);
  const data = (await resp.json()) as { result?: T; error?: unknown };
  if (data.error) throw new Error(`NEAR RPC error: ${safeError(data.error)}`);
  if (data.result === undefined) throw new Error("NEAR RPC returned no result.");
  return data.result;
}

function safeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const cause = record.cause;
    const name =
      (record.name as string | undefined) ??
      (cause && typeof cause === "object" ? ((cause as Record<string, unknown>).name as string | undefined) : undefined);
    if (name) return name;
    const message = record.message;
    if (typeof message === "string") return message.slice(0, 200);
  }
  return "unknown";
}

/** True iff `publicKey` is a FullAccess key of `accountId`. Throws only on a transport failure. */
export async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  const resp = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "sp-near-login",
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`NEAR RPC HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    result?: { permission?: unknown };
    error?: unknown;
  };
  if (data.error) {
    // UnknownAccount / UnknownAccessKey / etc. are a settled "not a key on this account".
    return false;
  }
  return data.result?.permission === "FullAccess";
}

/** 078 — generic read-only contract view. `args` is JSON; the RPC result bytes are decoded. */
export async function viewCall<T>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await rpcCall<{ result?: number[]; logs?: string[] }>({
    jsonrpc: "2.0",
    id: "sp-rhea-view",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
    },
  });
  const bytes = Buffer.from(result.result ?? []);
  if (bytes.length === 0) return null as T;
  return JSON.parse(bytes.toString("utf8")) as T;
}

export interface RpcAccount {
  readonly amount: string;
  readonly storage_usage: number;
  readonly block_height?: number;
  readonly block_hash?: string;
}

/** 078 — native NEAR balance (yocto) for gas/storage checks. */
export async function viewAccount(accountId: string): Promise<RpcAccount> {
  return rpcCall<RpcAccount>({
    jsonrpc: "2.0",
    id: "sp-rhea-account",
    method: "query",
    params: { request_type: "view_account", finality: "final", account_id: accountId },
  });
}

export interface RpcBlock {
  readonly height: number;
  readonly hash: string;
}

/** 078 — the latest final block, pinned in a reviewed plan so staleness is visible. */
export async function latestBlock(): Promise<RpcBlock> {
  const result = await rpcCall<{
    header?: { height?: number; hash?: string };
  }>({
    jsonrpc: "2.0",
    id: "sp-rhea-block",
    method: "block",
    params: { finality: "final" },
  });
  const height = result.header?.height;
  const hash = result.header?.hash;
  if (typeof height !== "number" || typeof hash !== "string") {
    throw new Error("NEAR RPC returned no final block header.");
  }
  return { height, hash };
}

export interface RpcTransactionStatus {
  readonly final_execution_status?: string;
  readonly status?: unknown;
  readonly transaction?: { hash?: string };
  readonly receipts_outcome?: unknown[];
}

/**
 * 078 — read-only receipt lookup for post-send finality polling. This is a `tx` QUERY; it does not
 * submit anything. `wait_until` is optimistic so the UI can show an honest pending state.
 */
export async function viewTransactionStatus(
  txHash: string,
  senderAccountId: string,
): Promise<RpcTransactionStatus> {
  return rpcCall<RpcTransactionStatus>({
    jsonrpc: "2.0",
    id: "sp-rhea-receipt",
    method: "tx",
    params: {
      tx_hash: txHash,
      sender_account_id: senderAccountId,
      wait_until: "EXECUTED_OPTIMISTIC",
    },
  });
}
