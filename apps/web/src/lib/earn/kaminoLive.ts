/**
 * 077 — Kamino Earn (kVault) live slice, pure helpers.
 *
 * The browser never builds a Solana transaction by hand: it asks our BFF for the **unsigned**
 * transaction Kamino's public API builds for the connected wallet, decodes it, and shows exactly
 * what is about to be signed (amount, vault, share mint, programs, network fee, ATA rent). This
 * module is the shared, testable half: the curated vault allowlist, request validation, the tx
 * summary, and the position read-back parsing.
 *
 * Nothing here signs, sends, approves or transfers. `decodeKaminoTransaction` only deserializes a
 * base64 transaction; the wallet signs it later, in the browser, after an explicit confirm.
 */

import { VersionedTransaction } from "@solana/web3.js";

import { isValidAddress } from "../crosschain/address.ts";
import type { LiveEarnMode } from "./liveFlags.ts";

export const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export const KAMINO_API_URL = "https://api.kamino.finance";

/** Pinned program ids (read-only constants; never derived). */
export const KAMINO_KVAULT_PROGRAM_ID = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd";
export const KAMINO_FARMS_PROGRAM_ID = "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

/** Kamino kVault instruction discriminators observed in the public API's unsigned txs. */
export const KAMINO_DEPOSIT_DISCRIMINATOR = "f223c68952e1f2b6";
export const KAMINO_WITHDRAW_DISCRIMINATOR = "1383709baadc2239";

/** Rent-exempt minimum for a standard 165-byte SPL token account (lamports). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/** Base fee per signature on Solana (lamports). */
export const BASE_FEE_PER_SIGNATURE_LAMPORTS = 5_000n;

export interface KaminoVaultMeta {
  readonly address: string;
  readonly name: string;
  readonly assetSymbol: string;
  readonly assetMint: string;
  readonly assetDecimals: number;
  readonly sharesMint: string;
  readonly sharesDecimals: number;
  readonly managementFeeBps: number;
  readonly performanceFeeBps: number;
  readonly appUrl: string;
}

/** The only vaults the BFF may build a transaction for. Curated, not user-supplied. */
export const KAMINO_VAULTS: readonly KaminoVaultMeta[] = [
  {
    address: "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
    name: "SOL Balanced",
    assetSymbol: "SOL",
    assetMint: "So11111111111111111111111111111111111111112",
    assetDecimals: 9,
    sharesMint: "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
    sharesDecimals: 9,
    managementFeeBps: 0,
    performanceFeeBps: 0,
    appUrl: "https://app.kamino.finance/lending/earn",
  },
  {
    address: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
    name: "Steakhouse USDC",
    assetSymbol: "USDC",
    assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    assetDecimals: 6,
    sharesMint: "7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS",
    sharesDecimals: 6,
    managementFeeBps: 0,
    performanceFeeBps: 500,
    appUrl: "https://app.kamino.finance/lending/earn",
  },
];

export function findKaminoVault(address: string | null | undefined): KaminoVaultMeta | null {
  if (!address) return null;
  return KAMINO_VAULTS.find((v) => v.address === address) ?? null;
}

export type KaminoLiveErrorCode =
  | "flag_off"
  | "invalid_mode"
  | "invalid_wallet"
  | "unknown_vault"
  | "invalid_amount"
  | "amount_too_small";

export class KaminoLiveError extends Error {
  readonly code: KaminoLiveErrorCode;
  constructor(code: KaminoLiveErrorCode, message: string) {
    super(message);
    this.name = "KaminoLiveError";
    this.code = code;
  }
}

export interface KaminoBuildInput {
  readonly mode: LiveEarnMode;
  readonly wallet: string;
  readonly vault: string;
  readonly amount: string;
}

/** Parse a positive decimal string into raw units without floats. `null` when invalid/zero. */
export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > decimals) return null;
  if (whole === "" && fraction === "") return null;
  const wholeRaw = whole === "" ? 0n : BigInt(whole);
  const fractionRaw = fraction === "" ? 0n : BigInt(fraction.padEnd(decimals, "0"));
  const scale = 10n ** BigInt(decimals);
  const raw = wholeRaw * scale + fractionRaw;
  return raw > 0n ? raw : null;
}

/** Format raw units as a plain decimal string (no exponent, trailing zeros trimmed). */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText =
    decimals === 0 ? "" : fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fractionText ? `${whole}.${fractionText}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/** Multiply a raw amount by a decimal rate string (e.g. tokensPerShare) without floats. */
export function applyDecimalRate(raw: bigint, rate: string): bigint | null {
  const parsed = parseTokenAmount(rate, 30);
  if (parsed === null) return null;
  return (raw * parsed) / 10n ** 30n;
}

/**
 * Validate a build request against the curated allowlist. Throws `KaminoLiveError` with a stable
 * code the route maps to an honest 4xx.
 */
export function validateKaminoBuildInput(input: KaminoBuildInput): KaminoBuildInput & {
  vaultMeta: KaminoVaultMeta;
  amountRaw: bigint;
} {
  if (input.mode !== "deposit" && input.mode !== "withdraw") {
    throw new KaminoLiveError("invalid_mode", "Mode must be deposit or withdraw.");
  }
  const wallet = input.wallet.trim();
  if (!isValidAddress(wallet, "sol")) {
    throw new KaminoLiveError("invalid_wallet", "Connect a Solana wallet (base58 address).");
  }
  const vaultMeta = findKaminoVault(input.vault.trim());
  if (!vaultMeta) {
    throw new KaminoLiveError("unknown_vault", "That vault is not enabled for live deposits.");
  }
  const decimals = input.mode === "deposit" ? vaultMeta.assetDecimals : vaultMeta.sharesDecimals;
  const amountRaw = parseTokenAmount(input.amount, decimals);
  if (amountRaw === null) {
    throw new KaminoLiveError(
      "invalid_amount",
      `Enter a ${input.mode === "deposit" ? vaultMeta.assetSymbol : "share"} amount with at most ${decimals} decimals.`,
    );
  }
  return { ...input, wallet, amount: formatTokenAmount(amountRaw, decimals), vaultMeta, amountRaw };
}

/** The exact body Kamino's public API expects (`amount` is human decimal, not raw units). */
export function kaminoApiRequest(input: KaminoBuildInput) {
  const validated = validateKaminoBuildInput(input);
  return {
    url: `${KAMINO_API_URL}/ktx/kvault/${validated.mode}`,
    body: {
      wallet: validated.wallet,
      kvault: validated.vaultMeta.address,
      amount: validated.amount,
    },
    vaultMeta: validated.vaultMeta,
    amountRaw: validated.amountRaw,
  };
}

export interface KaminoInstructionSummary {
  readonly programId: string;
  readonly programLabel: string;
  readonly instruction: string;
  readonly accountCount: number;
}

export interface KaminoTxReview {
  readonly feePayer: string;
  readonly signatures: number;
  readonly staticAccountCount: number;
  readonly lookupTables: readonly string[];
  readonly instructions: readonly KaminoInstructionSummary[];
  readonly networkFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly priorityFeeMicroLamportsPerCu: bigint;
  readonly computeUnitLimit: bigint;
  readonly tokenAccountCreations: number;
  readonly tokenAccountRentLamports: bigint;
  readonly transferredLamports: bigint;
  readonly hasKaminoDeposit: boolean;
  readonly hasKaminoWithdraw: boolean;
  readonly blockhash: string;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return value;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Browser-safe base64 → Uint8Array (no Node Buffer dependency in client code). */
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function describeInstruction(programId: string, data: Uint8Array): {
  label: string;
  isTokenAccountCreate: boolean;
  transferLamports: bigint;
  priorityMicroLamports: bigint | null;
  computeUnitLimit: bigint | null;
  isKaminoDeposit: boolean;
  isKaminoWithdraw: boolean;
} {
  const base = {
    isTokenAccountCreate: false,
    transferLamports: 0n,
    priorityMicroLamports: null as bigint | null,
    computeUnitLimit: null as bigint | null,
    isKaminoDeposit: false,
    isKaminoWithdraw: false,
  };
  if (programId === SYSTEM_PROGRAM_ID && data.length >= 4) {
    const kind = readU32LE(data, 0);
    if (kind === 2 && data.length >= 12) {
      return { ...base, label: `transfer ${readU64LE(data, 4)} lamports`, transferLamports: readU64LE(data, 4) };
    }
    return { ...base, label: `system instruction ${kind}` };
  }
  if (programId === COMPUTE_BUDGET_PROGRAM_ID && data.length >= 1) {
    const kind = data[0];
    if (kind === 2 && data.length >= 5) {
      return { ...base, label: `set compute unit limit ${readU32LE(data, 1)}`, computeUnitLimit: BigInt(readU32LE(data, 1)) };
    }
    if (kind === 3 && data.length >= 9) {
      return { ...base, label: `set compute unit price ${readU64LE(data, 1)} µlamports/CU`, priorityMicroLamports: readU64LE(data, 1) };
    }
    return { ...base, label: `compute budget instruction ${kind}` };
  }
  if (programId === ATA_PROGRAM_ID && data.length >= 1) {
    const kind = data[0];
    const label = kind === 1 ? "create idempotent associated token account" : kind === 0 ? "create associated token account" : `associated token account instruction ${kind}`;
    return { ...base, label, isTokenAccountCreate: kind === 0 || kind === 1 };
  }
  if ((programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) && data.length >= 1) {
    const kind = data[0];
    if (kind === 17) return { ...base, label: "sync native (wrap SOL)" };
    if (kind === 9) return { ...base, label: "close token account (unwrap SOL)" };
    if (kind === 3) return { ...base, label: "token transfer" };
    if (kind === 12) return { ...base, label: "token transfer checked" };
    if (kind === 4) return { ...base, label: "token approve" };
    return { ...base, label: `token instruction ${kind}` };
  }
  if (programId === KAMINO_KVAULT_PROGRAM_ID && data.length >= 8) {
    const discriminator = hex(data.slice(0, 8));
    if (discriminator === KAMINO_DEPOSIT_DISCRIMINATOR) {
      const amount = data.length >= 16 ? readU64LE(data, 8) : null;
      return {
        ...base,
        label: amount === null ? "kVault deposit" : `kVault deposit ${amount} raw units`,
        isKaminoDeposit: true,
      };
    }
    if (discriminator === KAMINO_WITHDRAW_DISCRIMINATOR) {
      const shares = data.length >= 16 ? readU64LE(data, 8) : null;
      return {
        ...base,
        label: shares === null ? "kVault withdraw" : `kVault withdraw ${shares} raw shares`,
        isKaminoWithdraw: true,
      };
    }
    return { ...base, label: `kVault instruction ${discriminator}` };
  }
  if (programId === KAMINO_FARMS_PROGRAM_ID && data.length >= 8) {
    return { ...base, label: `Kamino farm instruction ${hex(data.slice(0, 8))}` };
  }
  return { ...base, label: `program instruction (${data.length} bytes)` };
}

/** Decode the unsigned base64 payload. Throws when it is not a versioned transaction. */
export function decodeKaminoTransaction(encodedTransaction: string): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(base64ToBytes(encodedTransaction));
  } catch {
    throw new KaminoLiveError("invalid_amount", "Kamino returned a transaction that could not be decoded.");
  }
}

/**
 * Decode the unsigned base64 transaction and summarize what it does. Throws when the payload is
 * not a versioned transaction, so a malformed API response can never reach the wallet.
 */
export function summarizeKaminoTransaction(encodedTransaction: string): KaminoTxReview {
  const tx = decodeKaminoTransaction(encodedTransaction);
  const message = tx.message;
  const staticKeys = message.staticAccountKeys.map((key) => key.toBase58());
  const lookupTables = message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());

  let priorityMicroLamportsPerCu = 0n;
  let computeUnitLimit = 200_000n;
  let tokenAccountCreations = 0;
  let transferredLamports = 0n;
  let hasKaminoDeposit = false;
  let hasKaminoWithdraw = false;

  const instructions = message.compiledInstructions.map((instruction): KaminoInstructionSummary => {
    const programId = staticKeys[instruction.programIdIndex] ?? "lookup-table-program";
    const data = Uint8Array.from(instruction.data);
    const described = describeInstruction(programId, data);
    tokenAccountCreations += described.isTokenAccountCreate ? 1 : 0;
    transferredLamports += described.transferLamports;
    if (described.priorityMicroLamports !== null) priorityMicroLamportsPerCu = described.priorityMicroLamports;
    if (described.computeUnitLimit !== null) computeUnitLimit = described.computeUnitLimit;
    hasKaminoDeposit ||= described.isKaminoDeposit;
    hasKaminoWithdraw ||= described.isKaminoWithdraw;
    return {
      programId,
      programLabel: programLabel(programId),
      instruction: described.label,
      accountCount: instruction.accountKeyIndexes.length,
    };
  });

  const signatures = staticKeys.length > 0 ? tx.signatures.length : 0;
  const priorityFeeLamports = (priorityMicroLamportsPerCu * computeUnitLimit + 999_999n) / 1_000_000n;
  const networkFeeLamports = BASE_FEE_PER_SIGNATURE_LAMPORTS * BigInt(Math.max(signatures, 1)) + priorityFeeLamports;

  return {
    feePayer: staticKeys[0] ?? "",
    signatures,
    staticAccountCount: staticKeys.length,
    lookupTables,
    instructions,
    networkFeeLamports,
    priorityFeeLamports,
    priorityFeeMicroLamportsPerCu: priorityMicroLamportsPerCu,
    computeUnitLimit,
    tokenAccountCreations,
    tokenAccountRentLamports: BigInt(tokenAccountCreations) * TOKEN_ACCOUNT_RENT_LAMPORTS,
    transferredLamports,
    hasKaminoDeposit,
    hasKaminoWithdraw,
    blockhash: message.recentBlockhash,
  };
}

export function programLabel(programId: string): string {
  switch (programId) {
    case KAMINO_KVAULT_PROGRAM_ID:
      return "Kamino kVault";
    case KAMINO_FARMS_PROGRAM_ID:
      return "Kamino farms";
    case SYSTEM_PROGRAM_ID:
      return "Solana system";
    case TOKEN_PROGRAM_ID:
    case TOKEN_2022_PROGRAM_ID:
      return "SPL token";
    case ATA_PROGRAM_ID:
      return "Associated token account";
    case COMPUTE_BUDGET_PROGRAM_ID:
      return "Compute budget";
    default:
      return "Solana program";
  }
}

/** A token balance / position row from the Kamino user-positions endpoint. */
export interface KaminoPositionRow {
  readonly vaultAddress: string;
  readonly vaultName: string;
  readonly shares: string;
  readonly sharesRaw: bigint;
}

export function parseKaminoPositions(raw: unknown): KaminoPositionRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: KaminoPositionRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const vaultAddress = typeof value.vaultAddress === "string" ? value.vaultAddress : null;
    if (!vaultAddress) continue;
    const meta = findKaminoVault(vaultAddress);
    if (!meta) continue;
    const total = value.totalShares;
    if (typeof total !== "string") continue;
    const sharesRaw = parseTokenAmount(total, meta.sharesDecimals);
    if (sharesRaw === null) continue;
    rows.push({
      vaultAddress,
      vaultName: meta.name,
      shares: formatTokenAmount(sharesRaw, meta.sharesDecimals),
      sharesRaw,
    });
  }
  return rows;
}

export interface KaminoBuildResult {
  readonly transaction: string;
  readonly mode: LiveEarnMode;
  readonly wallet: string;
  readonly vault: KaminoVaultMeta;
  readonly amount: string;
  readonly amountRaw: bigint;
  readonly tokensPerShare: string | null;
  readonly apy: string | null;
  readonly tokenPriceUsd: string | null;
  readonly estimate: string | null;
  readonly estimateUnit: "shares" | "tokens";
}

/** Build the human-facing estimate from the metrics endpoint (an estimate, never a quote). */
export function deriveKaminoEstimate(
  amountRaw: bigint,
  mode: LiveEarnMode,
  tokensPerShare: string | null,
  outputDecimals: number,
): { estimate: string | null; estimateUnit: "shares" | "tokens" } {
  if (!tokensPerShare) return { estimate: null, estimateUnit: mode === "deposit" ? "shares" : "tokens" };
  if (mode === "deposit") {
    const scale = 10n ** 30n;
    const rate = parseTokenAmount(tokensPerShare, 30);
    if (rate === null) return { estimate: null, estimateUnit: "shares" };
    return {
      estimate: formatTokenAmount((amountRaw * scale) / rate, outputDecimals),
      estimateUnit: "shares",
    };
  }
  const estimate = applyDecimalRate(amountRaw, tokensPerShare);
  return {
    estimate: estimate === null ? null : formatTokenAmount(estimate, outputDecimals),
    estimateUnit: "tokens",
  };
}

/** The BFF build response shape (bigints are strings on the wire). */
export interface KaminoBuildResponse {
  readonly unsigned: true;
  readonly transaction: string;
  readonly mode: LiveEarnMode;
  readonly wallet: string;
  readonly vault: KaminoVaultMeta;
  readonly amount: string;
  readonly amountRaw: string;
  readonly tokensPerShare: string | null;
  readonly apy: string | null;
  readonly tokenPriceUsd: string | null;
  readonly estimate: string | null;
  readonly estimateUnit: "shares" | "tokens";
  readonly networkFeeLamports: string;
  readonly tokenAccountCreations: number;
}

/** One row from the BFF positions route. */
export interface KaminoPositionView {
  readonly vaultAddress: string;
  readonly vaultName: string;
  readonly shares: string;
  readonly tokensPerShare: string | null;
  readonly estimatedTokens: string | null;
  readonly assetSymbol: string | null;
}

/** Raw lamports → a short SOL amount without exponent notation. */
export function formatLamports(value: bigint): string {
  return formatTokenAmount(value, 9);
}

/** Fraction string (`0.039689…`) → `3.97%`; `null` when absent/unparseable. */
export function apyPercent(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${(n * 100).toFixed(2)}%`;
}
