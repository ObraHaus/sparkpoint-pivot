/**
 * Solana send path that the app controls.
 *
 * The wallet is still the only signer, but a dApp that hands a transaction to
 * `signAndSendTransaction` cannot see preflight failures and cannot rebroadcast, so a dropped or
 * expired transaction looks identical to a pending one. Here we:
 *
 *   1. refresh the recent blockhash (Kamino's build can be a minute old by the time the user
 *      confirms) through our read-only RPC proxy,
 *   2. simulate to measure compute units and add `ComputeBudget` instructions **before** the wallet
 *      sees the transaction — otherwise Phantom injects its own 200k CU default and a Kamino
 *      deposit (which needs ~234k) fails without ever reaching the network,
 *   3. ask the wallet to `signTransaction` only, then broadcast the signed bytes ourselves with
 *      `skipPreflight:false` so a preflight failure is a visible error with logs, and
 *   4. rebroadcast the same bytes while polling until confirmed, failed or expired.
 *
 * Falls back to `signAndSendTransaction` (longer polling, no rebroadcast) when a wallet only
 * exposes the combined method.
 */

import {
  PublicKey,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";

import type { SolanaInjectedProvider } from "./wallet.ts";

export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export const MAX_TRANSACTION_BYTES = 1_232;
export const MIN_COMPUTE_UNIT_LIMIT = 300_000;
export const FALLBACK_COMPUTE_UNIT_LIMIT = 400_000;
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
export const COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.2;
export const COMPUTE_UNIT_MARGIN_UNITS = 10_000;
export const MIN_PRIORITY_FEE_MICRO_LAMPORTS = 20_000n;
export const MAX_PRIORITY_FEE_MICRO_LAMPORTS = 200_000n;
export const DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 50_000n;

export const DEFAULT_REBROADCAST_INTERVAL_MS = 2_000;
export const DEFAULT_CONFIRMATION_ATTEMPTS = 45;
export const FALLBACK_CONFIRMATION_ATTEMPTS = 60;

export type SolanaSendOutcome = "confirmed" | "failed" | "expired" | "pending";

export interface SolanaRpcTransport {
  call<T = unknown>(method: string, params: readonly unknown[]): Promise<T>;
}

export class SolanaRpcError extends Error {
  readonly code: number | string | null;
  readonly logs: readonly string[] | null;
  readonly data: unknown;

  constructor(
    message: string,
    options: { code?: number | string | null; logs?: readonly string[] | null; data?: unknown } = {},
  ) {
    super(message);
    this.name = "SolanaRpcError";
    this.code = options.code ?? null;
    this.logs = options.logs ?? null;
    this.data = options.data;
  }
}

export class SolanaSendError extends Error {
  readonly logs: readonly string[] | null;

  constructor(message: string, logs?: readonly string[] | null) {
    super(message);
    this.name = "SolanaSendError";
    this.logs = logs ?? null;
  }
}

interface JsonRpcPayload {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

function logsFromData(data: unknown): string[] | null {
  if (!data || typeof data !== "object") return null;
  const logs = (data as { logs?: unknown }).logs;
  return Array.isArray(logs) && logs.every((line) => typeof line === "string") ? logs : null;
}

/** A JSON-RPC transport that POSTs to our `/api/solana/rpc` proxy. */
export function createHttpSolanaRpc(url: string, fetchImpl?: typeof fetch): SolanaRpcTransport {
  let nextId = 1;
  return {
    async call<T = unknown>(method: string, params: readonly unknown[]): Promise<T> {
      const doFetch = fetchImpl ?? fetch;
      const id = nextId++;
      const response = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        cache: "no-store",
      });
      let payload: JsonRpcPayload;
      try {
        payload = (await response.json()) as JsonRpcPayload;
      } catch {
        throw new SolanaRpcError(`The Solana RPC returned an unreadable response (HTTP ${response.status}).`);
      }
      if (payload.error) {
        const value = payload.error as { code?: unknown; message?: unknown; data?: unknown };
        const code =
          typeof value.code === "number" || typeof value.code === "string" ? value.code : null;
        const message =
          typeof value.message === "string" && value.message.length > 0
            ? value.message
            : "The Solana RPC rejected the request.";
        throw new SolanaRpcError(message, { code, logs: logsFromData(value.data), data: value.data });
      }
      if (!response.ok) {
        throw new SolanaRpcError(`The Solana RPC returned HTTP ${response.status}.`);
      }
      return payload.result as T;
    },
  };
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeU64LE(bytes: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let i = 0; i < 8; i += 1) {
    bytes[offset + i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** How many compute-budget instructions the message already carries. */
export function countComputeBudgetInstructions(transaction: VersionedTransaction): number {
  const staticKeys = transaction.message.staticAccountKeys;
  return transaction.message.compiledInstructions.filter((instruction) => {
    const program = staticKeys[instruction.programIdIndex];
    return program?.toBase58() === COMPUTE_BUDGET_PROGRAM_ID;
  }).length;
}

/** Clamp simulated units to a safe limit: +20% + margin, min 300k, max 1.4M. */
export function computeUnitLimitFor(unitsConsumed: number | null | undefined): number {
  if (typeof unitsConsumed !== "number" || !Number.isFinite(unitsConsumed) || unitsConsumed <= 0) {
    return FALLBACK_COMPUTE_UNIT_LIMIT;
  }
  const withMargin = Math.ceil(unitsConsumed * COMPUTE_UNIT_MARGIN_MULTIPLIER) + COMPUTE_UNIT_MARGIN_UNITS;
  return Math.min(Math.max(withMargin, MIN_COMPUTE_UNIT_LIMIT), MAX_COMPUTE_UNIT_LIMIT);
}

/** Median of recent prioritization fees, clamped to a sane range (µlamports per CU). */
export function medianPriorityFeeMicroLamports(fees: readonly unknown[]): bigint {
  const values = fees
    .map((fee) =>
      typeof fee === "number"
        ? fee
        : fee && typeof fee === "object" && typeof (fee as { prioritizationFee?: unknown }).prioritizationFee === "number"
          ? (fee as { prioritizationFee: number }).prioritizationFee
          : null,
    )
    .filter((fee): fee is number => typeof fee === "number" && Number.isFinite(fee) && fee >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? Math.round(((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2)
      : values[middle]!;
  const clamped = BigInt(Math.max(0, Math.round(median)));
  if (clamped < MIN_PRIORITY_FEE_MICRO_LAMPORTS) return MIN_PRIORITY_FEE_MICRO_LAMPORTS;
  if (clamped > MAX_PRIORITY_FEE_MICRO_LAMPORTS) return MAX_PRIORITY_FEE_MICRO_LAMPORTS;
  return clamped;
}

/**
 * Prepend `setComputeUnitLimit` + `setComputeUnitPrice` to a v0 transaction without decompiling
 * its lookup tables. The ComputeBudget program id is appended as the last read-only unsigned
 * static key; every instruction index at or beyond the old static-key count (i.e. any lookup
 * account) shifts by one. Returns the original transaction unchanged when it already carries
 * compute-budget instructions, is not v0, or the augmented message would exceed 1232 bytes.
 */
export function withComputeBudgetInstructions(
  transaction: VersionedTransaction,
  unitLimit: number,
  microLamportsPerCu: bigint,
): VersionedTransaction {
  if (transaction.message.version !== 0) return transaction;
  if (countComputeBudgetInstructions(transaction) > 0) return transaction;

  let augmented: VersionedTransaction;
  try {
    augmented = VersionedTransaction.deserialize(transaction.serialize());
  } catch {
    return transaction;
  }
  const message = augmented.message as MessageV0;
  const oldStaticCount = message.staticAccountKeys.length;
  const programIndex = oldStaticCount;

  message.staticAccountKeys.push(new PublicKey(COMPUTE_BUDGET_PROGRAM_ID));
  message.header.numReadonlyUnsignedAccounts += 1;

  for (const instruction of message.compiledInstructions) {
    instruction.accountKeyIndexes = instruction.accountKeyIndexes.map((index) =>
      index >= oldStaticCount ? index + 1 : index,
    );
    if (instruction.programIdIndex >= oldStaticCount) instruction.programIdIndex += 1;
  }

  const limitData = new Uint8Array(5);
  limitData[0] = 2;
  writeU32LE(limitData, 1, unitLimit);

  const priceData = new Uint8Array(9);
  priceData[0] = 3;
  writeU64LE(priceData, 1, microLamportsPerCu);

  message.compiledInstructions.unshift(
    { programIdIndex: programIndex, accountKeyIndexes: [], data: limitData },
    { programIdIndex: programIndex, accountKeyIndexes: [], data: priceData },
  );

  try {
    if (augmented.serialize().length > MAX_TRANSACTION_BYTES) return transaction;
  } catch {
    return transaction;
  }
  return augmented;
}

function writableAddresses(transaction: VersionedTransaction): string[] {
  const message = transaction.message;
  const staticKeys = message.staticAccountKeys;
  const required = message.header.numRequiredSignatures;
  const writableSigners = staticKeys.slice(0, required);
  const writableUnsignedStart = required + message.header.numReadonlySignedAccounts;
  const writableUnsignedEnd = staticKeys.length - message.header.numReadonlyUnsignedAccounts;
  const writableUnsigned = staticKeys.slice(writableUnsignedStart, writableUnsignedEnd);
  return [...writableSigners, ...writableUnsigned]
    .slice(0, 16)
    .map((key) => key.toBase58());
}

export interface PrepareSolanaTransactionResult {
  readonly transaction: VersionedTransaction;
  readonly computeUnitLimit: number | null;
  readonly priorityFeeMicroLamports: bigint | null;
  readonly computeBudgetAdded: boolean;
  readonly simulatedUnits: number | null;
  readonly lastValidBlockHeight: number | null;
}

export interface PrepareSolanaTransactionOptions {
  readonly commitment?: "processed" | "confirmed" | "finalized";
}

async function refreshBlockhash(
  transaction: VersionedTransaction,
  rpc: SolanaRpcTransport,
  commitment: string,
): Promise<{ lastValidBlockHeight: number | null }> {
  const latest = await rpc.call<{
    value?: { blockhash?: unknown; lastValidBlockHeight?: unknown };
  }>("getLatestBlockhash", [{ commitment }]);
  const value = latest?.value;
  const blockhash = typeof value?.blockhash === "string" ? value.blockhash : "";
  if (!blockhash) {
    throw new SolanaSendError("The Solana RPC did not return a recent blockhash; review again.");
  }
  transaction.message.recentBlockhash = blockhash;
  return {
    lastValidBlockHeight:
      typeof value?.lastValidBlockHeight === "number" ? value.lastValidBlockHeight : null,
  };
}

async function simulateUnits(
  transaction: VersionedTransaction,
  rpc: SolanaRpcTransport,
  commitment: string,
): Promise<number | null> {
  try {
    const result = await rpc.call<{
      value?: { err?: unknown; unitsConsumed?: unknown; logs?: unknown };
    }>("simulateTransaction", [
      bytesToBase64(transaction.serialize()),
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment,
      },
    ]);
    const value = result?.value;
    if (!value || value.err) return null;
    return typeof value.unitsConsumed === "number" ? value.unitsConsumed : null;
  } catch {
    // A simulation failure here is not fatal: fall back to a safe limit and let the real preflight
    // (which surfaces logs) be the authority.
    return null;
  }
}

async function recentPriorityFee(
  transaction: VersionedTransaction,
  rpc: SolanaRpcTransport,
): Promise<bigint> {
  try {
    const addresses = writableAddresses(transaction);
    if (addresses.length === 0) return DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS;
    const fees = await rpc.call<unknown[]>("getRecentPrioritizationFees", [addresses]);
    return medianPriorityFeeMicroLamports(Array.isArray(fees) ? fees : []);
  } catch {
    return DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS;
  }
}

/**
 * Refresh the blockhash and (when possible) add compute-budget instructions. Never mutates the
 * caller's transaction: it is cloned first so a failed retry starts from the reviewed bytes.
 */
export async function prepareSolanaTransaction(
  transaction: VersionedTransaction,
  rpc: SolanaRpcTransport,
  options: PrepareSolanaTransactionOptions = {},
): Promise<PrepareSolanaTransactionResult> {
  const commitment = options.commitment ?? "confirmed";
  let prepared: VersionedTransaction;
  try {
    prepared = VersionedTransaction.deserialize(transaction.serialize());
  } catch {
    prepared = transaction;
  }

  const { lastValidBlockHeight } = await refreshBlockhash(prepared, rpc, commitment);
  const simulatedUnits = await simulateUnits(prepared, rpc, commitment);
  const unitLimit = computeUnitLimitFor(simulatedUnits);
  const microLamportsPerCu = await recentPriorityFee(prepared, rpc);
  const augmented = withComputeBudgetInstructions(prepared, unitLimit, microLamportsPerCu);
  const added = augmented !== prepared;

  return {
    transaction: augmented,
    computeUnitLimit: added ? unitLimit : null,
    priorityFeeMicroLamports: added ? microLamportsPerCu : null,
    computeBudgetAdded: added,
    simulatedUnits,
    lastValidBlockHeight,
  };
}

interface SignatureStatusEntry {
  readonly err?: unknown;
  readonly confirmationStatus?: unknown;
  readonly confirmations?: unknown;
}

function outcomeOf(status: SignatureStatusEntry | null | undefined): SolanaSendOutcome {
  if (!status) return "pending";
  if (status.err) return "failed";
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    return "confirmed";
  }
  return "pending";
}

function describeTransactionError(status: SignatureStatusEntry): string | null {
  if (!status.err) return null;
  try {
    return JSON.stringify(status.err);
  } catch {
    return "The transaction failed on-chain.";
  }
}

export interface SendSolanaTransactionOptions {
  readonly provider: SolanaInjectedProvider;
  readonly transaction: VersionedTransaction;
  readonly rpc: SolanaRpcTransport;
  readonly commitment?: "processed" | "confirmed" | "finalized";
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rebroadcastIntervalMs?: number;
  readonly maxConfirmationAttempts?: number;
  readonly onSignature?: (signature: string, prepared: PrepareSolanaTransactionResult) => void;
}

export interface SendSolanaTransactionResult {
  readonly signature: string;
  readonly outcome: SolanaSendOutcome;
  readonly error: string | null;
  readonly computeUnitLimit: number | null;
  readonly priorityFeeMicroLamports: bigint | null;
  readonly computeBudgetAdded: boolean;
  readonly simulatedUnits: number | null;
  readonly lastValidBlockHeight: number | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pollAndRebroadcast(params: {
  signature: string;
  signedBase64: string | null;
  rpc: SolanaRpcTransport;
  commitment: string;
  lastValidBlockHeight: number | null;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  maxAttempts: number;
}): Promise<{ outcome: SolanaSendOutcome; error: string | null }> {
  const { signature, signedBase64, rpc, commitment, lastValidBlockHeight, sleep, intervalMs } = params;

  for (let attempt = 0; attempt < params.maxAttempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);

    if (signedBase64) {
      try {
        await rpc.call("sendTransaction", [
          signedBase64,
          {
            encoding: "base64",
            skipPreflight: true,
            preflightCommitment: commitment,
            maxRetries: 0,
          },
        ]);
      } catch {
        // Rebroadcasts are best-effort: an "already processed" or transient error is not a failure.
      }
    }

    try {
      const result = await rpc.call<{ value?: Array<SignatureStatusEntry | null> }>(
        "getSignatureStatuses",
        [[signature], { searchTransactionHistory: true }],
      );
      const status = result?.value?.[0] ?? null;
      const outcome = outcomeOf(status);
      if (outcome === "confirmed") return { outcome, error: null };
      if (outcome === "failed") {
        return { outcome, error: describeTransactionError(status ?? {}) };
      }
    } catch {
      // Keep polling; a transient RPC error is not a confirmed success.
    }

    if (lastValidBlockHeight !== null) {
      try {
        const blockHeight = await rpc.call<number>("getBlockHeight", [{ commitment }]);
        if (typeof blockHeight === "number" && blockHeight > lastValidBlockHeight) {
          return { outcome: "expired", error: null };
        }
      } catch {
        // Without a block height we keep polling until the attempt budget is spent.
      }
    }
  }

  return { outcome: "pending", error: null };
}

function saveBase64(transaction: VersionedTransaction): string | null {
  try {
    return bytesToBase64(transaction.serialize());
  } catch {
    return null;
  }
}

/**
 * Sign (wallet-side only) and broadcast through our RPC proxy, then track it to a terminal state.
 */
export async function sendSolanaTransaction(
  options: SendSolanaTransactionOptions,
): Promise<SendSolanaTransactionResult> {
  const {
    provider,
    transaction,
    rpc,
    commitment = "confirmed",
    sleep = defaultSleep,
    rebroadcastIntervalMs = DEFAULT_REBROADCAST_INTERVAL_MS,
    onSignature,
  } = options;

  const prepared = await prepareSolanaTransaction(transaction, rpc, { commitment });
  const meta = {
    computeUnitLimit: prepared.computeUnitLimit,
    priorityFeeMicroLamports: prepared.priorityFeeMicroLamports,
    computeBudgetAdded: prepared.computeBudgetAdded,
    simulatedUnits: prepared.simulatedUnits,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  };

  if (typeof provider.signTransaction === "function") {
    let signed: VersionedTransaction;
    try {
      signed = await provider.signTransaction(prepared.transaction);
    } catch (cause) {
      if (cause instanceof Error) throw cause;
      throw new SolanaSendError("The Solana wallet could not sign the transaction.");
    }
    const signedBase64 = saveBase64(signed);
    if (!signedBase64) {
      throw new SolanaSendError("The wallet returned a transaction that could not be serialized.");
    }

    let signature: string;
    try {
      signature = await rpc.call<string>("sendTransaction", [
        signedBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: commitment,
          maxRetries: 0,
        },
      ]);
    } catch (cause) {
      const rpcError = cause instanceof SolanaRpcError ? cause : null;
      const detail = rpcError?.message ?? (cause instanceof Error ? cause.message : "unknown error");
      const logs = rpcError?.logs ?? null;
      const logText = logs && logs.length > 0 ? ` Logs: ${logs.slice(-4).join(" | ")}` : "";
      throw new SolanaSendError(
        `The transaction failed preflight and was not sent: ${detail}.${logText} Nothing was spent — review again.`,
        logs,
      );
    }
    if (!signature) {
      throw new SolanaSendError("The Solana RPC accepted the send but returned no signature.");
    }
    onSignature?.(signature, prepared);

    const { outcome, error } = await pollAndRebroadcast({
      signature,
      signedBase64,
      rpc,
      commitment,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      sleep,
      intervalMs: rebroadcastIntervalMs,
      maxAttempts: options.maxConfirmationAttempts ?? DEFAULT_CONFIRMATION_ATTEMPTS,
    });

    return { signature, outcome, error, ...meta };
  }

  if (typeof provider.signAndSendTransaction !== "function") {
    throw new SolanaSendError("This Solana wallet cannot sign transactions.");
  }

  const result = await provider.signAndSendTransaction(prepared.transaction, {
    skipPreflight: false,
    preflightCommitment: commitment,
  });
  const signature = typeof result?.signature === "string" ? result.signature : "";
  if (!signature) throw new SolanaSendError("The Solana wallet returned no transaction signature.");
  onSignature?.(signature, prepared);

  const { outcome, error } = await pollAndRebroadcast({
    signature,
    signedBase64: null,
    rpc,
    commitment,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
    sleep,
    intervalMs: rebroadcastIntervalMs,
    maxAttempts: options.maxConfirmationAttempts ?? FALLBACK_CONFIRMATION_ATTEMPTS,
  });

  return { signature, outcome, error, ...meta };
}
