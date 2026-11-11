export const BALANCE_READ_TIMEOUT_MS = 12_000;
export const SIGNATURE_STATUS_TIMEOUT_MS = 8_000;

export class SolanaRpcTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaRpcTimeoutError";
  }
}

export function solanaProxyRpcUrl(origin?: string | null): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/+$/, "")}/api/solana/rpc`;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "The Solana RPC request timed out.",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SolanaRpcTimeoutError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
