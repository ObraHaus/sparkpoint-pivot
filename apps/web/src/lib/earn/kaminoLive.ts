/**
 * 077 — Kamino Earn (kVault) live slice, pure helpers.
 *
 * The browser never builds a Solana transaction by hand: it asks our BFF for the **unsigned**
 * transaction Kamino's public API builds for the connected wallet, decodes it, and shows exactly
 * what is about to be signed (amount, vault, share mint, programs, network fee, ATA rent). This
 * module is the shared, testable half: the curated vault allowlist, request validation, vault
 * metadata/limit parsing, the tx summary + shape validation, and the position read-back parsing.
 *
 * Nothing here signs, sends, approves or transfers. `decodeKaminoTransaction` only deserializes a
 * base64 transaction; the wallet signs it later, in the browser, after an explicit confirm.
 */

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

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
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * The exact programs an unsigned kVault deposit/withdraw may touch. Anything else is rejected
 * before the wallet is asked to sign. Documented set: kamino kVault, Kamino farms, Solana system,
 * SPL token, Token-2022, associated token account, and compute budget.
 */
export const ALLOWED_KAMINO_PROGRAMS: readonly string[] = [
  KAMINO_KVAULT_PROGRAM_ID,
  KAMINO_FARMS_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
];

/** Kamino kVault instruction discriminators observed in the public API's unsigned txs. */
export const KAMINO_DEPOSIT_DISCRIMINATOR = "f223c68952e1f2b6";
export const KAMINO_WITHDRAW_DISCRIMINATOR = "b712469c946da122";
/**
 * Kamino farm discriminators observed in the same deposit/withdraw txs. Deposits initialise the
 * user's farm position and stake; withdraws unstake and then pull the unstaked deposits back out.
 */
export const KAMINO_FARM_INITIALIZE_USER_DISCRIMINATOR = "6f11b9fa3c7a26fe";
export const KAMINO_FARM_STAKE_DISCRIMINATOR = "ceb0ca12c8d1b36c";
export const KAMINO_FARM_UNSTAKE_DISCRIMINATOR = "5a5f6b2acd7c32e1";
export const KAMINO_FARM_WITHDRAW_UNSTAKED_DISCRIMINATOR = "2466bb31dc248443";

/** u64::MAX — Kamino's withdraw endpoint encodes "redeem all shares" as this sentinel. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** Rent-exempt minimum for a standard 165-byte SPL token account (lamports). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/** Base fee per signature on Solana (lamports). */
export const BASE_FEE_PER_SIGNATURE_LAMPORTS = 5_000n;

/**
 * Conservative safety buffer reserved on every SOL deposit (0.005 SOL). It covers fee/rent drift
 * and the rent-exempt minimum staying on the wallet; it is intentionally larger than the observed
 * fees and is documented in the review copy.
 */
export const SOL_SAFETY_BUFFER_LAMPORTS = 5_000_000n;

/** Conservative priority fee used before a transaction exists (0.0001 SOL). */
export const CONSERVATIVE_PRIORITY_FEE_LAMPORTS = 100_000n;

/** A deposit may create the wSOL ATA and the share ATA; reserve rent for both. */
export const MAX_DEPOSIT_ASSUMED_TOKEN_ACCOUNT_CREATIONS = 2;

/**
 * The `tokenMint` Kamino reports for each curated vault's asset, captured read-only from
 * `GET /kvaults/vaults/{vault}` on 2026-11-09. Both are standard SPL Token (`Tokenkeg…`) mints:
 * the SOL vault's asset is wrapped SOL and the Steakhouse vault's asset is the SPL mint above.
 * The UI shows symbol + shortened mint + token program and never asserts issuer/native status.
 */
export const KAMINO_API_TOKEN_MINTS = {
  solBalanced: "So11111111111111111111111111111111111111112",
  steakhouseUsdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export type KaminoAssetTokenStandard = "spl-token" | "token-2022";

/** Map a token program id to the standard the review shows; unknown programs are refused. */
export function tokenStandardForProgram(programId: string): KaminoAssetTokenStandard | null {
  if (programId === TOKEN_PROGRAM_ID) return "spl-token";
  if (programId === TOKEN_2022_PROGRAM_ID) return "token-2022";
  return null;
}

export interface KaminoVaultMeta {
  readonly address: string;
  readonly name: string;
  readonly assetSymbol: string;
  readonly assetMint: string;
  readonly assetDecimals: number;
  /** The token program that owns `assetMint` according to Kamino's vault metadata. */
  readonly assetTokenProgram: string;
  readonly assetTokenStandard: KaminoAssetTokenStandard;
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
    assetMint: KAMINO_API_TOKEN_MINTS.solBalanced,
    assetDecimals: 9,
    assetTokenProgram: TOKEN_PROGRAM_ID,
    assetTokenStandard: "spl-token",
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
    assetMint: KAMINO_API_TOKEN_MINTS.steakhouseUsdc,
    assetDecimals: 6,
    assetTokenProgram: TOKEN_PROGRAM_ID,
    assetTokenStandard: "spl-token",
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

/** Shorten a base58 mint for display without hiding which mint it is. */
export function shortMint(mint: string, head = 6, tail = 6): string {
  return mint.length <= head + tail + 1 ? mint : `${mint.slice(0, head)}…${mint.slice(-tail)}`;
}

/**
 * Unambiguous label for a vault's asset mint: symbol + shortened mint + token standard. It is
 * derived from Kamino's vault metadata (`tokenMint` / `tokenProgram`), so the user can verify the
 * exact mint in their wallet. It never says "USDC mint" alone and never asserts issuer/native
 * status (the Steakhouse mint is whatever Kamino reports for that vault).
 */
export function kaminoAssetMintLabel(meta: KaminoVaultMeta): string {
  const wrapped = meta.assetMint === WSOL_MINT ? " · wrapped SOL" : "";
  return `${meta.assetSymbol} · ${shortMint(meta.assetMint)} · ${meta.assetTokenStandard}${wrapped}`;
}

export type KaminoLiveErrorCode =
  | "flag_off"
  | "invalid_mode"
  | "invalid_wallet"
  | "unknown_vault"
  | "invalid_amount"
  | "invalid_transaction"
  | "amount_too_small"
  | "amount_too_large"
  | "mint_mismatch"
  | "metadata_unavailable"
  | "position_unavailable"
  | "lookup_unresolved"
  | "wrong_fee_payer"
  | "wrong_vault"
  | "wrong_program"
  | "wrong_instruction"
  | "wrong_amount"
  | "wrong_recipient"
  | "unexpected_transfer"
  | "authority_change"
  | "insufficient_balance"
  | "zero_shares";

export class KaminoLiveError extends Error {
  readonly code: KaminoLiveErrorCode;
  constructor(code: KaminoLiveErrorCode, message: string) {
    super(message);
    this.name = "KaminoLiveError";
    this.code = code;
  }
}

/** HTTP status for a validation error (used by the thin route wrapper). */
export function kaminoErrorStatus(code: KaminoLiveErrorCode): number {
  switch (code) {
    case "flag_off":
      return 404;
    case "invalid_transaction":
    case "metadata_unavailable":
    case "position_unavailable":
    case "lookup_unresolved":
    case "wrong_fee_payer":
    case "wrong_vault":
    case "wrong_program":
    case "wrong_instruction":
    case "wrong_amount":
    case "wrong_recipient":
    case "unexpected_transfer":
    case "authority_change":
      return 502;
    default:
      return 400;
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

/** Truncating decimal → raw units (used for API decimal strings like `prevAum`). */
export function decimalToRawFloor(value: string, decimals: number): bigint | null {
  const cleaned = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

function readInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Authoritative vault state/limits fetched from `GET /kvaults/vaults/{vault}`. `depositCap` of 0
 * means uncapped; `remainingDepositRaw` is cap minus AUM when both are known.
 */
export interface KaminoVaultLimits {
  readonly assetMint: string;
  readonly sharesMint: string;
  readonly assetDecimals: number;
  readonly sharesDecimals: number;
  /** The vault's own token account; a transfer to/from any other account is refused. */
  readonly tokenVault: string;
  /** The token program owning `assetMint`; must match the curated program. */
  readonly tokenProgram: string;
  readonly vaultFarm: string | null;
  readonly minDepositAmountRaw: bigint;
  readonly minWithdrawAmountRaw: bigint;
  readonly depositCapRaw: bigint | null;
  readonly totalAssetsRaw: bigint | null;
  readonly remainingDepositRaw: bigint | null;
  readonly sharesIssuedRaw: bigint | null;
}

/** Parse the public Kamino vault response into the values the validator enforces. */
export function parseKaminoVaultLimits(
  raw: unknown,
  _meta: KaminoVaultMeta,
): KaminoVaultLimits | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const state =
    root.state && typeof root.state === "object"
      ? (root.state as Record<string, unknown>)
      : root;
  const assetMint = readString(state.tokenMint);
  const sharesMint = readString(state.sharesMint);
  const tokenVault = readString(state.tokenVault);
  const tokenProgram = readString(state.tokenProgram);
  const vaultFarm = readString(state.vaultFarm);
  const assetDecimals = readInt(state.tokenMintDecimals);
  const sharesDecimals = readInt(state.sharesMintDecimals);
  const minDepositAmountRaw = readBigInt(state.minDepositAmount);
  const minWithdrawAmountRaw = readBigInt(state.minWithdrawAmount);
  if (
    !assetMint ||
    !sharesMint ||
    !tokenVault ||
    !tokenProgram ||
    assetDecimals === null ||
    sharesDecimals === null ||
    minDepositAmountRaw === null ||
    minWithdrawAmountRaw === null
  ) {
    return null;
  }
  // Identity, not just presence: every account the validator will trust must be a real address and
  // the token program must be one of the two SPL standards we understand.
  if (
    !isValidAddress(assetMint, "sol") ||
    !isValidAddress(sharesMint, "sol") ||
    !isValidAddress(tokenVault, "sol") ||
    !isValidAddress(tokenProgram, "sol") ||
    tokenStandardForProgram(tokenProgram) === null ||
    (vaultFarm !== null && !isValidAddress(vaultFarm, "sol"))
  ) {
    return null;
  }
  const capValue = readBigInt(state.depositCap);
  const depositCapRaw = capValue !== null && capValue > 0n ? capValue : null;
  const totalAssetsRaw =
    typeof state.prevAum === "string" ? decimalToRawFloor(state.prevAum, assetDecimals) : null;
  const remainingDepositRaw =
    depositCapRaw !== null && totalAssetsRaw !== null
      ? depositCapRaw > totalAssetsRaw
        ? depositCapRaw - totalAssetsRaw
        : 0n
      : null;
  return {
    assetMint,
    sharesMint,
    assetDecimals,
    sharesDecimals,
    tokenVault,
    tokenProgram,
    vaultFarm,
    minDepositAmountRaw,
    minWithdrawAmountRaw,
    depositCapRaw,
    totalAssetsRaw,
    remainingDepositRaw,
    sharesIssuedRaw: readBigInt(state.sharesIssued),
  };
}

/** Read the vault's authoritative limits from Kamino's public API (read-only). */
export async function fetchKaminoVaultLimits(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KaminoVaultLimits | null> {
  const meta = findKaminoVault(address);
  if (!meta) return null;
  try {
    const response = await fetchImpl(
      `${KAMINO_API_URL}/kvaults/vaults/${encodeURIComponent(address)}`,
      {
        headers: { "User-Agent": "sparkpoint-web/1.0" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    return parseKaminoVaultLimits(await response.json(), meta);
  } catch {
    return null;
  }
}

/**
 * Read the wallet's current share balance in a curated vault (read-only).
 *
 * Returns `0n` when the wallet has no position (the public endpoint answers `[]`), `null` when the
 * read failed. The caller must refuse an unverified withdraw-all when this is `null`.
 */
export async function fetchKaminoPositionShares(
  address: string,
  wallet: string,
  fetchImpl: typeof fetch = fetch,
): Promise<bigint | null> {
  if (!findKaminoVault(address)) return null;
  try {
    const response = await fetchImpl(
      `${KAMINO_API_URL}/kvaults/users/${encodeURIComponent(wallet)}/positions`,
      {
        headers: { "User-Agent": "sparkpoint-web/1.0" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    if (response.status === 404) return 0n;
    if (!response.ok) return null;
    const rows = parseKaminoPositions(await response.json());
    return rows.find((row) => row.vaultAddress === address)?.sharesRaw ?? 0n;
  } catch {
    return null;
  }
}

/**
 * Validate a build request against the curated allowlist and (when supplied) the vault's live
 * limits. Throws `KaminoLiveError` with a stable code the route maps to an honest 4xx/5xx.
 */
export function validateKaminoBuildInput(
  input: KaminoBuildInput,
  limits?: KaminoVaultLimits | null,
): KaminoBuildInput & {
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
  if (limits) {
    if (
      limits.assetMint !== vaultMeta.assetMint ||
      limits.sharesMint !== vaultMeta.sharesMint ||
      limits.tokenProgram !== vaultMeta.assetTokenProgram ||
      limits.assetDecimals !== vaultMeta.assetDecimals ||
      limits.sharesDecimals !== vaultMeta.sharesDecimals
    ) {
      throw new KaminoLiveError(
        "mint_mismatch",
        "The vault's on-chain mints, token program or decimals no longer match the curated metadata; refusing to build.",
      );
    }
    const minRaw =
      input.mode === "deposit" ? limits.minDepositAmountRaw : limits.minWithdrawAmountRaw;
    const unit = input.mode === "deposit" ? vaultMeta.assetSymbol : "shares";
    if (amountRaw < minRaw) {
      throw new KaminoLiveError(
        "amount_too_small",
        `Amount is below the vault minimum of ${formatTokenAmount(minRaw, decimals)} ${unit}.`,
      );
    }
    if (input.mode === "deposit") {
      if (limits.depositCapRaw !== null && amountRaw > limits.depositCapRaw) {
        throw new KaminoLiveError(
          "amount_too_large",
          `Amount exceeds the vault deposit cap of ${formatTokenAmount(limits.depositCapRaw, decimals)} ${unit}.`,
        );
      }
      if (limits.remainingDepositRaw !== null && amountRaw > limits.remainingDepositRaw) {
        throw new KaminoLiveError(
          "amount_too_large",
          `Only ${formatTokenAmount(limits.remainingDepositRaw, decimals)} ${unit} of vault cap remains.`,
        );
      }
    } else if (limits.sharesIssuedRaw !== null && amountRaw > limits.sharesIssuedRaw) {
      throw new KaminoLiveError(
        "amount_too_large",
        `Amount exceeds the vault's issued shares (${formatTokenAmount(limits.sharesIssuedRaw, decimals)}).`,
      );
    }
  }
  return { ...input, wallet, amount: formatTokenAmount(amountRaw, decimals), vaultMeta, amountRaw };
}

/** The exact body Kamino's public API expects (`amount` is human decimal, not raw units). */
export function kaminoApiRequest(input: KaminoBuildInput, limits?: KaminoVaultLimits | null) {
  const validated = validateKaminoBuildInput(input, limits);
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

/* ------------------------------------------------------------------------------------------------
 * SOL reserve / max helpers (Max and submit must never leave the wallet unable to pay fees/rent).
 * ---------------------------------------------------------------------------------------------- */

export interface SolReserveInput {
  readonly networkFeeLamports: bigint;
  readonly tokenAccountRentLamports: bigint;
  readonly safetyBufferLamports?: bigint;
}

/** Total lamports that must stay untouched on top of the deposit amount. */
export function solDepositReserveLamports(input: SolReserveInput): bigint {
  return (
    input.networkFeeLamports +
    input.tokenAccountRentLamports +
    (input.safetyBufferLamports ?? SOL_SAFETY_BUFFER_LAMPORTS)
  );
}

/** Conservative reserve used before the unsigned tx exists. */
export function conservativeSolDepositReserveLamports(): bigint {
  return solDepositReserveLamports({
    networkFeeLamports: BASE_FEE_PER_SIGNATURE_LAMPORTS + CONSERVATIVE_PRIORITY_FEE_LAMPORTS,
    tokenAccountRentLamports:
      BigInt(MAX_DEPOSIT_ASSUMED_TOKEN_ACCOUNT_CREATIONS) * TOKEN_ACCOUNT_RENT_LAMPORTS,
  });
}

/** Maximum SOL deposit that still leaves the reserve behind. */
export function maxSolDepositLamports(balanceLamports: bigint, reserveLamports: bigint): bigint {
  const available = balanceLamports - reserveLamports;
  return available > 0n ? available : 0n;
}

export interface SolDepositCapacity {
  readonly ok: boolean;
  readonly requiredLamports: bigint;
  readonly shortfallLamports: bigint;
}

/** `balance >= amount + reserve` with an honest shortfall for the error copy. */
export function checkSolDepositCapacity(input: {
  balanceLamports: bigint;
  amountLamports: bigint;
  reserveLamports: bigint;
}): SolDepositCapacity {
  const requiredLamports = input.amountLamports + input.reserveLamports;
  if (input.balanceLamports >= requiredLamports) {
    return { ok: true, requiredLamports, shortfallLamports: 0n };
  }
  return {
    ok: false,
    requiredLamports,
    shortfallLamports: requiredLamports - input.balanceLamports,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Transaction decoding / summarising.
 * ---------------------------------------------------------------------------------------------- */

export interface KaminoInstructionSummary {
  readonly programId: string;
  readonly programLabel: string;
  readonly instruction: string;
  readonly accountCount: number;
  readonly accounts: readonly string[];
  readonly rejectReason: string | null;
  readonly authority: string | null;
  readonly action: { readonly kind: LiveEarnMode; readonly amountRaw: bigint } | null;
}

export interface KaminoLamportTransfer {
  readonly from: string;
  readonly to: string;
  readonly lamports: bigint;
}

export interface KaminoTokenTransfer {
  readonly source: string;
  readonly destination: string;
  readonly authority: string;
  readonly mint: string | null;
  readonly amount: bigint;
}

export interface KaminoAtaCreate {
  /** The associated token account address the instruction creates. */
  readonly address: string;
  readonly owner: string;
  readonly mint: string;
  readonly tokenProgram: string;
}

export interface KaminoCloseAccount {
  readonly account: string;
  readonly destination: string;
  readonly authority: string;
}

export interface KaminoTxReview {
  readonly feePayer: string;
  readonly signatures: number;
  readonly staticAccountCount: number;
  readonly lookupTables: readonly string[];
  readonly accountKeys: readonly string[];
  readonly lookupsResolved: boolean;
  readonly programIds: readonly string[];
  readonly instructions: readonly KaminoInstructionSummary[];
  readonly networkFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly priorityFeeMicroLamportsPerCu: bigint;
  readonly computeUnitLimit: bigint;
  readonly tokenAccountCreations: number;
  readonly tokenAccountRentLamports: bigint;
  readonly transferredLamports: bigint;
  readonly systemTransfers: readonly KaminoLamportTransfer[];
  readonly tokenTransfers: readonly KaminoTokenTransfer[];
  readonly ataCreates: readonly KaminoAtaCreate[];
  readonly closeAccounts: readonly KaminoCloseAccount[];
  readonly kaminoAction: { readonly kind: LiveEarnMode; readonly amountRaw: bigint } | null;
  readonly hasKaminoDeposit: boolean;
  readonly hasKaminoWithdraw: boolean;
  readonly blockhash: string;
}

export interface KaminoLookupAddresses {
  readonly writable: readonly string[];
  readonly readOnly: readonly string[];
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

interface DescribedInstruction {
  readonly label: string;
  readonly isTokenAccountCreate: boolean;
  readonly transferLamports: bigint;
  readonly lamportTransfer: KaminoLamportTransfer | null;
  readonly tokenTransfer: KaminoTokenTransfer | null;
  readonly ataCreate: KaminoAtaCreate | null;
  readonly closeAccount: KaminoCloseAccount | null;
  readonly priorityMicroLamports: bigint | null;
  readonly computeUnitLimit: bigint | null;
  readonly action: { kind: LiveEarnMode; amountRaw: bigint } | null;
  readonly authority: string | null;
  readonly rejectReason: string | null;
}

function describeInstruction(
  programId: string,
  data: Uint8Array,
  accounts: readonly string[],
): DescribedInstruction {
  const base: DescribedInstruction = {
    label: "",
    isTokenAccountCreate: false,
    transferLamports: 0n,
    lamportTransfer: null,
    tokenTransfer: null,
    ataCreate: null,
    closeAccount: null,
    priorityMicroLamports: null,
    computeUnitLimit: null,
    action: null,
    authority: null,
    rejectReason: null,
  };
  const reject = (label: string, reason: string): DescribedInstruction => ({
    ...base,
    label,
    rejectReason: reason,
  });

  if (programId === SYSTEM_PROGRAM_ID && data.length >= 4) {
    const kind = readU32LE(data, 0);
    if (kind === 2 && data.length >= 12) {
      const lamports = readU64LE(data, 4);
      const from = accounts[0] ?? "";
      const to = accounts[1] ?? "";
      return {
        ...base,
        label: `transfer ${lamports} lamports`,
        transferLamports: lamports,
        lamportTransfer: { from, to, lamports },
      };
    }
    return reject(
      `system instruction ${kind}`,
      `Unexpected SystemProgram instruction ${kind} (only a plain lamport transfer is allowed).`,
    );
  }
  if (programId === COMPUTE_BUDGET_PROGRAM_ID && data.length >= 1) {
    const kind = data[0];
    if (kind === 2 && data.length >= 5) {
      return {
        ...base,
        label: `set compute unit limit ${readU32LE(data, 1)}`,
        computeUnitLimit: BigInt(readU32LE(data, 1)),
      };
    }
    if (kind === 3 && data.length >= 9) {
      return {
        ...base,
        label: `set compute unit price ${readU64LE(data, 1)} µlamports/CU`,
        priorityMicroLamports: readU64LE(data, 1),
      };
    }
    return reject(
      `compute budget instruction ${kind}`,
      `Unexpected compute-budget instruction ${kind}.`,
    );
  }
  if (programId === ATA_PROGRAM_ID && data.length >= 1) {
    const kind = data[0];
    if (kind === 0 || kind === 1) {
      return {
        ...base,
        label: kind === 1 ? "create idempotent associated token account" : "create associated token account",
        isTokenAccountCreate: true,
        ataCreate: {
          address: accounts[1] ?? "",
          owner: accounts[2] ?? "",
          mint: accounts[3] ?? "",
          tokenProgram: accounts[5] ?? "",
        },
      };
    }
    return reject(
      `associated token account instruction ${kind}`,
      `Unexpected associated-token-account instruction ${kind}.`,
    );
  }
  if ((programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) && data.length >= 1) {
    const kind = data[0];
    if (kind === 17) return { ...base, label: "sync native (wrap SOL)" };
    if (kind === 9) {
      const owner = accounts[2] ?? null;
      return {
        ...base,
        label: "close token account (unwrap SOL)",
        authority: owner,
        closeAccount: {
          account: accounts[0] ?? "",
          destination: accounts[1] ?? "",
          authority: owner ?? "",
        },
      };
    }
    if (kind === 3) {
      const amount = data.length >= 9 ? readU64LE(data, 1) : 0n;
      return {
        ...base,
        label: `token transfer ${amount} raw units`,
        tokenTransfer: {
          source: accounts[0] ?? "",
          destination: accounts[1] ?? "",
          authority: accounts[2] ?? "",
          mint: null,
          amount,
        },
      };
    }
    if (kind === 12) {
      const amount = data.length >= 9 ? readU64LE(data, 1) : 0n;
      return {
        ...base,
        label: `token transfer checked ${amount} raw units`,
        tokenTransfer: {
          source: accounts[0] ?? "",
          destination: accounts[2] ?? "",
          authority: accounts[3] ?? "",
          mint: accounts[1] ?? null,
          amount,
        },
      };
    }
    return reject(
      `token instruction ${kind}`,
      `Unexpected SPL token instruction ${kind} (authority/approve/freeze-style instructions are refused).`,
    );
  }
  if (programId === KAMINO_KVAULT_PROGRAM_ID && data.length >= 8) {
    const discriminator = hex(data.slice(0, 8));
    if (discriminator === KAMINO_DEPOSIT_DISCRIMINATOR) {
      const amount = data.length >= 16 ? readU64LE(data, 8) : 0n;
      return {
        ...base,
        label: `kVault deposit ${amount} raw units`,
        action: { kind: "deposit", amountRaw: amount },
      };
    }
    if (discriminator === KAMINO_WITHDRAW_DISCRIMINATOR) {
      const amount = data.length >= 16 ? readU64LE(data, 8) : 0n;
      return {
        ...base,
        label:
          amount === U64_MAX
            ? "kVault withdraw ALL shares"
            : `kVault withdraw ${amount} raw shares`,
        action: { kind: "withdraw", amountRaw: amount },
      };
    }
    return reject(
      `kVault instruction ${discriminator}`,
      `Unexpected kVault instruction ${discriminator} (only deposit/withdraw are allowed).`,
    );
  }
  if (programId === KAMINO_FARMS_PROGRAM_ID && data.length >= 8) {
    const discriminator = hex(data.slice(0, 8));
    // Only the farm bookkeeping variants observed in the API's unsigned txs are allowed:
    // deposit → initialize_user + stake; withdraw → unstake + withdraw_unstaked_deposits.
    // A new/unknown variant is refused rather than shown and trusted.
    if (
      discriminator === KAMINO_FARM_INITIALIZE_USER_DISCRIMINATOR ||
      discriminator === KAMINO_FARM_STAKE_DISCRIMINATOR ||
      discriminator === KAMINO_FARM_UNSTAKE_DISCRIMINATOR ||
      discriminator === KAMINO_FARM_WITHDRAW_UNSTAKED_DISCRIMINATOR
    ) {
      return { ...base, label: `Kamino farm instruction ${discriminator}` };
    }
    return reject(
      `Kamino farm instruction ${discriminator}`,
      `Unexpected Kamino farms instruction ${discriminator} (only the observed initialize/stake/unstake/withdraw-unstaked bookkeeping is allowed).`,
    );
  }
  return reject(
    `program instruction ${hex(data.slice(0, 8))}`,
    `Unexpected program ${programId} in the unsigned transaction.`,
  );
}

/** Decode the unsigned base64 payload. Throws when it is not a versioned transaction. */
export function decodeKaminoTransaction(encodedTransaction: string): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(base64ToBytes(encodedTransaction));
  } catch {
    throw new KaminoLiveError(
      "invalid_transaction",
      "Kamino returned a transaction that could not be decoded.",
    );
  }
}

/** All account keys in v0 order: static, then writable lookups, then read-only lookups. */
export function kaminoAccountKeys(
  tx: VersionedTransaction,
  lookupAddresses?: KaminoLookupAddresses | null,
): string[] {
  const staticKeys = tx.message.staticAccountKeys.map((key) => key.toBase58());
  if (tx.message.addressTableLookups.length === 0) return staticKeys;
  if (!lookupAddresses) return staticKeys;
  return [...staticKeys, ...lookupAddresses.writable, ...lookupAddresses.readOnly];
}

/**
 * Decode the unsigned base64 transaction and summarize what it does. Throws when the payload is
 * not a versioned transaction, so a malformed API response can never reach the wallet.
 */
export function summarizeKaminoTransaction(
  encodedTransaction: string,
  options?: { readonly lookupAddresses?: KaminoLookupAddresses | null },
): KaminoTxReview {
  const tx = decodeKaminoTransaction(encodedTransaction);
  const message = tx.message;
  const staticKeys = message.staticAccountKeys.map((key) => key.toBase58());
  const lookupTables = message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());
  const accountKeys = kaminoAccountKeys(tx, options?.lookupAddresses);
  const keyAt = (index: number): string => accountKeys[index] ?? "";

  let priorityMicroLamportsPerCu = 0n;
  let computeUnitLimit = 200_000n;
  let tokenAccountCreations = 0;
  let transferredLamports = 0n;
  let hasKaminoDeposit = false;
  let hasKaminoWithdraw = false;
  let kaminoAction: { kind: LiveEarnMode; amountRaw: bigint } | null = null;
  let unresolved = false;
  const systemTransfers: KaminoLamportTransfer[] = [];
  const tokenTransfers: KaminoTokenTransfer[] = [];
  const ataCreates: KaminoAtaCreate[] = [];
  const closeAccounts: KaminoCloseAccount[] = [];

  const instructions = message.compiledInstructions.map((instruction): KaminoInstructionSummary => {
    const programId = keyAt(instruction.programIdIndex) || "lookup-table-program";
    if (
      instruction.programIdIndex >= accountKeys.length ||
      instruction.accountKeyIndexes.some((index) => index >= accountKeys.length)
    ) {
      unresolved = true;
    }
    const accounts = instruction.accountKeyIndexes.map((index) => keyAt(index));
    const data = Uint8Array.from(instruction.data);
    const described = describeInstruction(programId, data, accounts);
    tokenAccountCreations += described.isTokenAccountCreate ? 1 : 0;
    transferredLamports += described.transferLamports;
    if (described.lamportTransfer) systemTransfers.push(described.lamportTransfer);
    if (described.tokenTransfer) tokenTransfers.push(described.tokenTransfer);
    if (described.ataCreate) ataCreates.push(described.ataCreate);
    if (described.closeAccount) closeAccounts.push(described.closeAccount);
    if (described.priorityMicroLamports !== null) {
      priorityMicroLamportsPerCu = described.priorityMicroLamports;
    }
    if (described.computeUnitLimit !== null) computeUnitLimit = described.computeUnitLimit;
    if (described.action?.kind === "deposit") {
      hasKaminoDeposit = true;
      kaminoAction = described.action;
    }
    if (described.action?.kind === "withdraw") {
      hasKaminoWithdraw = true;
      kaminoAction = described.action;
    }
    return {
      programId,
      programLabel: programLabel(programId),
      instruction: described.label,
      accountCount: instruction.accountKeyIndexes.length,
      accounts,
      rejectReason: described.rejectReason,
      authority: described.authority,
      action: described.action,
    };
  });

  const lookupsResolved =
    !unresolved && (lookupTables.length === 0 || options?.lookupAddresses != null);
  const signatures = staticKeys.length > 0 ? tx.signatures.length : 0;
  const priorityFeeLamports =
    (priorityMicroLamportsPerCu * computeUnitLimit + 999_999n) / 1_000_000n;
  const networkFeeLamports =
    BASE_FEE_PER_SIGNATURE_LAMPORTS * BigInt(Math.max(signatures, 1)) + priorityFeeLamports;

  return {
    feePayer: staticKeys[0] ?? "",
    signatures,
    staticAccountCount: staticKeys.length,
    lookupTables,
    accountKeys,
    lookupsResolved,
    programIds: [...new Set(instructions.map((ix) => ix.programId))],
    instructions,
    networkFeeLamports,
    priorityFeeLamports,
    priorityFeeMicroLamportsPerCu: priorityMicroLamportsPerCu,
    computeUnitLimit,
    tokenAccountCreations,
    tokenAccountRentLamports: BigInt(tokenAccountCreations) * TOKEN_ACCOUNT_RENT_LAMPORTS,
    transferredLamports,
    systemTransfers,
    tokenTransfers,
    ataCreates,
    closeAccounts,
    kaminoAction,
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

/** Derive the ATA for (owner, mint) under the SPL token program. */
export function deriveAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM_ID,
): string {
  const [address] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ATA_PROGRAM_ID),
  );
  return address.toBase58();
}

/** Resolve the v0 address lookup tables of an unsigned tx via read-only RPC. */
export async function resolveKaminoLookupAddresses(
  connection: Connection,
  transaction: VersionedTransaction,
): Promise<KaminoLookupAddresses | null> {
  const writable: string[] = [];
  const readOnly: string[] = [];
  for (const lookup of transaction.message.addressTableLookups) {
    const resolved = await connection.getAddressLookupTable(lookup.accountKey);
    if (!resolved.value) return null;
    const addresses = resolved.value.state.addresses.map((address) => address.toBase58());
    for (const index of lookup.writableIndexes) {
      const address = addresses[index];
      if (!address) return null;
      writable.push(address);
    }
    for (const index of lookup.readonlyIndexes) {
      const address = addresses[index];
      if (!address) return null;
      readOnly.push(address);
    }
  }
  return { writable, readOnly };
}

export interface KaminoTransactionExpectation {
  readonly feePayer: string;
  readonly mode: LiveEarnMode;
  readonly vault: KaminoVaultMeta;
  readonly amountRaw: bigint;
  /**
   * Vault's token account, used to validate token transfer destination/source. Required: a build
   * without it cannot prove where the funds go, so it is refused rather than trusted blindly.
   */
  readonly tokenVault: string;
  /** Vault farm account, used to validate Kamino farm instructions. */
  readonly vaultFarm?: string | null;
  /**
   * The wallet's full share balance. A withdraw-all (`u64::MAX`) tx is only accepted if this is
   * known and equals the requested amount; `undefined` refuses the sentinel.
   */
  readonly positionSharesRaw?: bigint | null;
}

/**
 * Full shape validation for an unsigned Kamino transaction. This is the same check the BFF runs
 * and the browser re-runs before the wallet is asked to sign. Throws `KaminoLiveError`.
 */
export function assertKaminoTransactionMatches(
  review: KaminoTxReview,
  expectation: KaminoTransactionExpectation,
): void {
  function fail(code: KaminoLiveErrorCode, message: string): never {
    throw new KaminoLiveError(code, message);
  }

  if (!review.lookupsResolved) {
    fail(
      "lookup_unresolved",
      "The transaction's address lookup tables could not be resolved, so its accounts cannot be verified.",
    );
  }
  if (review.feePayer.trim() !== expectation.feePayer.trim()) {
    fail("wrong_fee_payer", "The transaction's fee payer is not your connected wallet.");
  }
  if (review.signatures !== 1) {
    fail("wrong_instruction", "Expected exactly one signature on the unsigned transaction.");
  }

  const allowed = new Set(ALLOWED_KAMINO_PROGRAMS);
  for (const instruction of review.instructions) {
    if (!allowed.has(instruction.programId)) {
      fail(
        "wrong_program",
        `Unexpected program ${instruction.programId} in the transaction; refusing to sign.`,
      );
    }
    if (instruction.rejectReason) {
      fail("authority_change", instruction.rejectReason);
    }
  }

  const action = review.kaminoAction;
  const actionCount = review.instructions.filter((ix) => ix.action).length;
  if (actionCount !== 1 || !action) {
    fail("wrong_instruction", "Expected exactly one Kamino deposit/withdraw instruction.");
  }
  if (expectation.mode === "deposit") {
    if (!review.hasKaminoDeposit || review.hasKaminoWithdraw) {
      fail("wrong_instruction", "This transaction is not the requested Kamino deposit.");
    }
    if (action.amountRaw !== expectation.amountRaw) {
      fail("wrong_amount", "The transaction amount does not match the amount you requested.");
    }
  } else {
    if (!review.hasKaminoWithdraw || review.hasKaminoDeposit) {
      fail("wrong_instruction", "This transaction is not the requested Kamino withdraw.");
    }
    if (action.amountRaw === U64_MAX) {
      const positionShares = expectation.positionSharesRaw;
      if (positionShares === undefined) {
        fail(
          "wrong_amount",
          "Kamino built a withdraw-ALL transaction, but your current share balance could not be verified. Refusing to sign.",
        );
      }
      if (positionShares === null || positionShares <= 0n) {
        fail("zero_shares", "You have no shares to withdraw from this vault.");
      }
      if (positionShares !== expectation.amountRaw) {
        fail(
          "wrong_amount",
          "Kamino built a withdraw-ALL transaction, but the requested amount is not your full share balance. Refusing to sign.",
        );
      }
    } else if (action.amountRaw !== expectation.amountRaw) {
      fail("wrong_amount", "The transaction share amount does not match the amount you requested.");
    }
  }

  const keys = new Set(review.accountKeys);
  if (!keys.has(expectation.vault.address)) {
    fail("wrong_vault", "The transaction does not reference the selected curated vault.");
  }
  if (!keys.has(expectation.vault.sharesMint)) {
    fail("mint_mismatch", "The transaction does not reference the vault's share mint.");
  }
  if (!keys.has(expectation.vault.assetMint)) {
    fail("mint_mismatch", "The transaction does not reference the vault's asset mint.");
  }
  for (const other of KAMINO_VAULTS) {
    if (other.address === expectation.vault.address) continue;
    if (keys.has(other.address)) {
      fail("wrong_vault", "The transaction references a different curated vault.");
    }
    if (keys.has(other.sharesMint)) {
      fail("mint_mismatch", "The transaction references a different vault's share mint.");
    }
  }

  const expectedAta = deriveAssociatedTokenAddress(
    expectation.feePayer,
    expectation.vault.assetMint,
    expectation.vault.assetTokenProgram,
  );
  for (const transfer of review.systemTransfers) {
    if (transfer.from !== expectation.feePayer) {
      fail("unexpected_transfer", "A lamport transfer on this transaction is not from your wallet.");
    }
    if (expectation.mode !== "deposit" || expectation.vault.assetMint !== WSOL_MINT) {
      fail("unexpected_transfer", "Unexpected lamport transfer in this transaction.");
    }
    if (transfer.to !== expectedAta) {
      fail("unexpected_transfer", "Lamports are being sent somewhere other than your vault token account.");
    }
  }
  if (
    expectation.mode === "deposit" &&
    expectation.vault.assetMint === WSOL_MINT
  ) {
    const wrapped = review.systemTransfers.reduce((sum, transfer) => sum + transfer.lamports, 0n);
    if (wrapped !== expectation.amountRaw) {
      fail("wrong_amount", "The wrapped SOL amount does not match the amount you requested.");
    }
  }

  if (!expectation.tokenVault || !isValidAddress(expectation.tokenVault, "sol")) {
    fail(
      "metadata_unavailable",
      "The vault's token account is missing or invalid, so the transfer cannot be verified. Refusing to sign.",
    );
  }

  for (const transfer of review.tokenTransfers) {
    if (transfer.mint !== null && transfer.mint !== expectation.vault.assetMint) {
      fail("mint_mismatch", "A token transfer in this transaction uses a different mint.");
    }
    if (transfer.amount <= 0n) {
      fail("wrong_amount", "A token transfer in this transaction has a zero amount.");
    }
    if (expectation.mode === "deposit") {
      if (transfer.destination !== expectation.tokenVault) {
        fail("unexpected_transfer", "Tokens are not being sent to the vault's token account.");
      }
      if (transfer.source !== expectedAta) {
        fail("wrong_recipient", "Tokens are being sent from an account that is not yours.");
      }
      if (transfer.amount !== expectation.amountRaw) {
        fail("wrong_amount", "The token transfer amount does not match the amount you requested.");
      }
    } else {
      if (transfer.source !== expectation.tokenVault) {
        fail("unexpected_transfer", "Tokens are not coming from the vault's token account.");
      }
      if (transfer.destination !== expectedAta) {
        fail("wrong_recipient", "Tokens are not being sent to your wallet's token account.");
      }
    }
  }

  // Closing a token account pays its remaining lamports to `destination`. On a withdraw Kamino
  // closes the wallet's own wSOL account and, once every share has been redeemed, its empty share
  // account too. Only those canonical accounts may be closed, by the wallet, back to the wallet.
  const expectedSharesAta = deriveAssociatedTokenAddress(
    expectation.feePayer,
    expectation.vault.sharesMint,
  );
  const closableAccounts = new Set([expectedAta, expectedSharesAta]);
  for (const close of review.closeAccounts) {
    if (close.authority !== expectation.feePayer) {
      fail("wrong_recipient", "A token account is being closed by a different authority.");
    }
    if (expectation.mode !== "withdraw") {
      fail("unexpected_transfer", "Unexpected token-account close in this transaction.");
    }
    if (!closableAccounts.has(close.account)) {
      fail(
        "unexpected_transfer",
        "A token account other than your wSOL or share account is being closed.",
      );
    }
    if (close.destination !== expectation.feePayer) {
      fail("unexpected_transfer", "A closed token account's lamports are going to a different address.");
    }
  }

  for (const create of review.ataCreates) {
    if (create.owner !== expectation.feePayer) {
      fail("wrong_recipient", "A token account is being created for a different owner.");
    }
    if (
      create.mint !== expectation.vault.assetMint &&
      create.mint !== expectation.vault.sharesMint
    ) {
      fail("mint_mismatch", "A token account is being created for an unexpected mint.");
    }
    if (tokenStandardForProgram(create.tokenProgram) === null) {
      fail("wrong_program", "A token account is being created under an unexpected token program.");
    }
    const derived = deriveAssociatedTokenAddress(
      create.owner,
      create.mint,
      create.tokenProgram,
    );
    if (create.address !== derived) {
      fail(
        "wrong_recipient",
        "A token account is being created at a non-canonical address.",
      );
    }
  }

  for (const instruction of review.instructions) {
    if (instruction.action) {
      if (instruction.accounts[0] !== expectation.feePayer) {
        fail("wrong_recipient", "The Kamino action is not for your connected wallet.");
      }
      if (instruction.accounts[1] !== expectation.vault.address) {
        fail("wrong_vault", "The Kamino action targets a different vault.");
      }
      if (!instruction.accounts.includes(expectation.vault.sharesMint)) {
        fail("mint_mismatch", "The Kamino action does not reference the vault's share mint.");
      }
      if (!instruction.accounts.includes(expectation.vault.assetMint)) {
        fail("mint_mismatch", "The Kamino action does not reference the vault's asset mint.");
      }
      if (!instruction.accounts.includes(expectation.tokenVault)) {
        fail("unexpected_transfer", "The Kamino action does not reference the vault's token account.");
      }
      if (!instruction.accounts.includes(expectedAta)) {
        fail("wrong_recipient", "The Kamino action does not reference your wallet's asset token account.");
      }
    }
    if (instruction.authority && instruction.authority !== expectation.feePayer) {
      fail("wrong_recipient", "A token authority on this transaction is not your wallet.");
    }
  }

  const farmInstructions = review.instructions.filter(
    (instruction) => instruction.programId === KAMINO_FARMS_PROGRAM_ID,
  );
  if (farmInstructions.length > 0) {
    if (!expectation.vaultFarm) {
      fail(
        "wrong_vault",
        "The vault has no farm account, but the transaction includes a Kamino farm instruction.",
      );
    }
    for (const instruction of farmInstructions) {
      if (!instruction.accounts.includes(expectation.vaultFarm)) {
        fail("wrong_vault", "A Kamino farm instruction does not reference the selected vault's farm.");
      }
    }
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
    const total =
      typeof value.totalShares === "string"
        ? value.totalShares
        : typeof value.totalShares === "number" && Number.isFinite(value.totalShares)
          ? String(value.totalShares)
          : null;
    if (total === null) continue;
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

/** Human-facing subset of the vault limits returned with a build. */
export interface KaminoVaultLimitsView {
  readonly minDepositAmount: string;
  readonly minWithdrawAmount: string;
  readonly depositCap: string | null;
  readonly remainingDeposit: string | null;
  readonly tokenVault: string | null;
  readonly vaultFarm: string | null;
}

export function kaminoVaultLimitsView(
  limits: KaminoVaultLimits,
  meta: KaminoVaultMeta,
): KaminoVaultLimitsView {
  return {
    minDepositAmount: formatTokenAmount(limits.minDepositAmountRaw, meta.assetDecimals),
    minWithdrawAmount: formatTokenAmount(limits.minWithdrawAmountRaw, meta.sharesDecimals),
    depositCap:
      limits.depositCapRaw === null
        ? null
        : formatTokenAmount(limits.depositCapRaw, meta.assetDecimals),
    remainingDeposit:
      limits.remainingDepositRaw === null
        ? null
        : formatTokenAmount(limits.remainingDepositRaw, meta.assetDecimals),
    tokenVault: limits.tokenVault,
    vaultFarm: limits.vaultFarm,
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
  readonly vaultLimits: KaminoVaultLimitsView;
  readonly withdrawsAllShares: boolean;
}

/** One row from the BFF positions route. */
export interface KaminoPositionView {
  readonly vaultAddress: string;
  readonly vaultName: string;
  readonly shares: string;
  readonly sharesRaw: string;
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

export interface SolanaSignatureStatusLike {
  readonly err: unknown;
  readonly confirmationStatus?: string | null;
  readonly confirmations?: number | null;
}

/** Honest outcome of a signature status: confirmed / failed / pending. */
export function signatureOutcome(
  status: SolanaSignatureStatusLike | null | undefined,
): "confirmed" | "failed" | "pending" {
  if (!status) return "pending";
  if (status.err) return "failed";
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    return "confirmed";
  }
  return "pending";
}
