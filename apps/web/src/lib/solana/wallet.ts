/**
 * 077 — minimal injected Solana wallet adapter.
 *
 * Deliberately tiny: connect, read the public key, and (only when the user explicitly confirms)
 * hand an unsigned `VersionedTransaction` to the wallet. `signTransaction` lets the app broadcast
 * the signed bytes itself (see sendTransaction.ts); `signAndSendTransaction` is the fallback. The
 * wallet is the only signer; SparkPoint holds no key, and nothing in this module signs at connect
 * time or on import.
 *
 * Library-free on purpose: Phantom, Solflare and the generic `window.solana` provider all expose
 * the same handful of methods, so no extra wallet-adapter SDK is needed. SSR is a no-op.
 */

import type { VersionedTransaction } from "@solana/web3.js";

export interface SolanaPublicKeyLike {
  toBase58(): string;
}

export interface SolanaInjectedProvider {
  readonly isPhantom?: boolean;
  readonly isSolflare?: boolean;
  readonly publicKey?: SolanaPublicKeyLike | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: SolanaPublicKeyLike } | void>;
  disconnect?(): Promise<void>;
  signAndSendTransaction(
    transaction: VersionedTransaction,
    options?: { skipPreflight?: boolean; preflightCommitment?: string },
  ): Promise<{ signature: string }>;
  /**
   * Sign **without** broadcasting. Phantom and Solflare both expose this; when present the app
   * sends the signed bytes itself so it can surface preflight errors and rebroadcast until the
   * transaction lands or its blockhash expires.
   */
  signTransaction?(transaction: VersionedTransaction): Promise<VersionedTransaction>;
}

type SolanaWindow = Window & {
  phantom?: { solana?: SolanaInjectedProvider };
  solflare?: SolanaInjectedProvider;
  solana?: SolanaInjectedProvider;
};

/** The first injected provider that looks usable, or `null` on the server / without a wallet. */
export function getInjectedSolanaProvider(): SolanaInjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as SolanaWindow;
  const candidates = [w.phantom?.solana, w.solflare, w.solana];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate.connect === "function" &&
      (typeof candidate.signAndSendTransaction === "function" ||
        typeof candidate.signTransaction === "function")
    ) {
      return candidate;
    }
  }
  return null;
}

export class SolanaWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaWalletError";
  }
}

/** Connect (or reuse an already-trusted session) and return the wallet's base58 address. */
export async function connectSolanaWallet(provider: SolanaInjectedProvider): Promise<string> {
  const result = await provider.connect({ onlyIfTrusted: false });
  const publicKey =
    provider.publicKey ??
    (result && typeof result === "object" && "publicKey" in result ? result.publicKey : undefined);
  const address = publicKey?.toBase58?.().trim();
  if (!address) throw new SolanaWalletError("The Solana wallet did not return a public key.");
  return address;
}

/**
 * Hand the **unsigned** transaction to the wallet. This is only called from the user's explicit
 * "Confirm in wallet" click; the wallet shows its own confirmation UI before signing/sending.
 */
export async function submitSolanaTransaction(
  provider: SolanaInjectedProvider,
  transaction: VersionedTransaction,
): Promise<string> {
  const result = await provider.signAndSendTransaction(transaction, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const signature = typeof result?.signature === "string" ? result.signature : "";
  if (!signature) throw new SolanaWalletError("The Solana wallet returned no transaction signature.");
  return signature;
}

export function solanaWalletErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel|closed|user refused/i.test(raw)) {
    return "You cancelled the Solana wallet request. Nothing was signed or sent.";
  }
  return raw || "The Solana wallet could not complete that request.";
}
