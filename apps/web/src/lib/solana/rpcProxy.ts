import { SOLANA_MAINNET_RPC } from "../earn/kaminoLive.ts";

export const SOLANA_PUBLICNODE_RPC = "https://solana-rpc.publicnode.com";

export const SOLANA_RPC_PROXY_PATH = "/api/solana/rpc";

export const ALLOWED_SOLANA_RPC_METHODS = [
  "getBalance",
  "getTokenAccountsByOwner",
  "getAccountInfo",
  "getSignatureStatuses",
] as const;

type AllowedSolanaRpcMethod = (typeof ALLOWED_SOLANA_RPC_METHODS)[number];

const ALLOWED_METHOD_SET: ReadonlySet<string> = new Set(ALLOWED_SOLANA_RPC_METHODS);

export type SolanaRpcEnv = Readonly<Record<string, string | undefined>>;

export interface SolanaRpcProxyResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface SolanaRpcProxyDependencies {
  readonly fetchImpl: typeof fetch;
  readonly upstreams?: readonly string[];
  readonly timeoutMs?: number;
}

interface SolanaRpcRequest {
  readonly method: AllowedSolanaRpcMethod;
  readonly params: readonly unknown[];
  readonly id: string | number | null;
}

const DEFAULT_TIMEOUT_MS = 9_000;

export function solanaRpcUrls(env: SolanaRpcEnv = process.env): string[] {
  const configured = env.SOLANA_RPC_URL?.trim();
  const urls = [configured, SOLANA_MAINNET_RPC, SOLANA_PUBLICNODE_RPC].filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  );
  return [...new Set(urls)];
}

function error(status: number, code: string, message: string): SolanaRpcProxyResult {
  return { status, body: { error: { code, message } } };
}

export function parseSolanaRpcRequest(rawBody: unknown): SolanaRpcRequest {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new Error("Send a JSON-RPC body with method, params and id.");
  }
  const body = rawBody as Record<string, unknown>;
  if (typeof body.method !== "string" || body.method.trim() === "") {
    throw new Error("The JSON-RPC body must include a method.");
  }
  if (!ALLOWED_METHOD_SET.has(body.method)) {
    throw new Error(`The JSON-RPC method ${body.method} is not allowed through this proxy.`);
  }
  if (body.params !== undefined && !Array.isArray(body.params)) {
    throw new Error("The JSON-RPC params must be an array.");
  }
  if (!("id" in body)) {
    throw new Error("The JSON-RPC body must include an id.");
  }
  const { id } = body;
  if (id !== null && typeof id !== "string" && typeof id !== "number") {
    throw new Error("The JSON-RPC id must be a string, number or null.");
  }
  return {
    method: body.method as AllowedSolanaRpcMethod,
    params: (body.params as readonly unknown[] | undefined) ?? [],
    id,
  };
}

function isUnusableRpcError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { code, message } = value as { code?: unknown; message?: unknown };
  if (
    typeof code === "number" &&
    [-32000, -32001, -32002, -32005, -32603, -32429].includes(code)
  ) {
    return true;
  }
  return (
    typeof message === "string" &&
    /unavailable|timed?\s*out|timeout|rate.?limit|too many requests|forbidden|blocked|internal error/i.test(
      message,
    )
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The Solana RPC request timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

async function fetchUpstream(
  fetchImpl: typeof fetch,
  url: string,
  request: SolanaRpcRequest,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const attempt = (async () => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "sparkpoint-web/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        method: request.method,
        params: request.params,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`The Solana RPC upstream returned HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("The Solana RPC upstream returned an invalid JSON-RPC response.");
    }
    return payload as Record<string, unknown>;
  })();

  try {
    return await withTimeout(attempt, timeoutMs);
  } catch (cause) {
    controller.abort();
    throw cause;
  }
}

export async function proxySolanaRpc(
  rawBody: unknown,
  deps: SolanaRpcProxyDependencies,
): Promise<SolanaRpcProxyResult> {
  let request: SolanaRpcRequest;
  try {
    request = parseSolanaRpcRequest(rawBody);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The JSON-RPC body could not be read.";
    const code = /not allowed/.test(message) ? "method_not_allowed" : "invalid_request";
    return error(code === "method_not_allowed" ? 403 : 400, code, message);
  }

  const upstreams = deps.upstreams?.length ? deps.upstreams : solanaRpcUrls();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const upstream of upstreams) {
    let payload: Record<string, unknown>;
    try {
      payload = await fetchUpstream(deps.fetchImpl, upstream, request, timeoutMs);
    } catch {
      continue;
    }
    if (isUnusableRpcError(payload.error)) continue;
    return { status: 200, body: payload };
  }

  return error(
    502,
    "rpc_unavailable",
    "The Solana RPC upstreams could not be reached; your balance was not read.",
  );
}
