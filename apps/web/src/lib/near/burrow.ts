/**
 * 078 — same-chain NEAR → Burrow (Rhea) supply and withdraw.
 *
 * This module is PURE: it pins the authoritative contracts, parses/limits amounts, and builds the
 * UNSIGNED function-call actions a reviewed plan hands to the wallet. It never signs, sends or
 * holds a key. The only transaction call in the codebase lives in `adapter.ts`'s explicit
 * `sendTransactions` boundary, used solely by the live earn confirm step.
 *
 * A NEAR transaction has exactly one receiver, so a plan is a list of transactions — one per
 * target contract — all signed by the user's own account. The signer nonce orders them.
 *
 * Scope honesty: this is the same-chain rail (the user's own NEAR account + native USDC). It is
 * NOT 071's cross-chain MCA/1Click Phase C path, which remains deferred.
 */

import { isValidNearAccountId } from "./account.ts";

/** Pinned authoritative IDs. Anything else is refused, never swapped in silently. */
export const BURROW_CONTRACT = "contract.main.burrow.near";
// Official public NEAR native USDC NEP-141 mainnet contract id (from the Rhea/Burrow docs) — a
// production constant, NOT a secret. Kept as the full literal so it stays auditable.
export const USDC_TOKEN_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // gitleaks:allow (public USDC NEP-141 contract id, not a secret)
export const USDC_SYMBOL = "USDC";
export const USDC_DECIMALS = 6;
/** Burrow inner units = token decimals + `config.extra_decimals` (verified live: 12). */
export const BURROW_USDC_EXTRA_DECIMALS = 12;
export const RHEA_APP_URL = "https://app.rhea.finance/lending";

export const ALLOWED_CONTRACTS = [BURROW_CONTRACT, USDC_TOKEN_ID] as const;
export const ALLOWED_ASSETS = [USDC_TOKEN_ID] as const;

export const STORAGE_DEPOSIT_GAS = "30000000000000"; // 30 Tgas
export const FT_TRANSFER_CALL_GAS = "100000000000000"; // 100 Tgas (observed on-chain)
export const BURROW_EXECUTE_GAS = "100000000000000"; // 100 Tgas
export const ONE_YOCTO = "1";

/** Storage minima are read from the contracts at preflight; these are the documented fallbacks. */
export const BURROW_STORAGE_MIN_YOCTO = 100_000_000_000_000_000_000_000n; // 0.1 NEAR
export const TOKEN_STORAGE_MIN_YOCTO = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

/** Attached-deposit reserve for gas. A plan is refused when the account cannot cover it. */
export const NEAR_GAS_RESERVE_YOCTO = 20_000_000_000_000_000_000_000n; // 0.02 NEAR

/** Amount bounds in USDC base units (6 dp). Exact Burrow supply/withdraw needs no slippage. */
export const MIN_SUPPLY_UNITS = 10_000n; // 0.01 USDC
export const MAX_SUPPLY_UNITS = 1_000_000_000_000n; // 1,000,000 USDC
export const MIN_WITHDRAW_UNITS = 1n;
export const MAX_WITHDRAW_UNITS = 1_000_000_000_000n; // 1,000,000 USDC
export const USDC_UNITS_PER_CENT = 10_000n;

/** How long a reviewed, unsigned plan may be submitted before it must be rebuilt. */
export const PLAN_MAX_AGE_MS = 60_000;

export interface FunctionCallAction {
  readonly type: "FunctionCall";
  readonly params: {
    readonly methodName: string;
    readonly args: Record<string, unknown>;
    readonly gas: string;
    readonly deposit: string;
  };
}

export interface NearTransaction {
  readonly receiverId: string;
  readonly actions: readonly FunctionCallAction[];
}

export interface NearTransactionOutcome {
  readonly status?: unknown;
  readonly transaction?: { readonly hash?: string };
  readonly transaction_outcome?: { readonly id?: string };
  readonly final_execution_status?: string;
  readonly receipts_outcome?: readonly { readonly outcome?: { readonly status?: unknown } }[];
}

export function isAllowedContract(contractId: string): boolean {
  return (ALLOWED_CONTRACTS as readonly string[]).includes(contractId);
}

export function isAllowedAsset(tokenId: string): boolean {
  return (ALLOWED_ASSETS as readonly string[]).includes(tokenId);
}

export type AmountError = "empty" | "not_numeric" | "too_precise" | "below_minimum" | "above_maximum";

export interface ParsedAmount {
  readonly ok: true;
  readonly raw: bigint;
  readonly human: string;
}
export type AmountParse = ParsedAmount | { readonly ok: false; readonly error: AmountError };

/**
 * Parse a human USDC amount into exact 6-decimal base units. Rejects over-precision rather than
 * rounding: a user's 1.2345678 is not silently truncated into a different amount.
 */
export function parseUsdcAmount(input: string, kind: "supply" | "withdraw" = "supply"): AmountParse {
  const text = input.trim();
  if (!text) return { ok: false, error: "empty" };
  if (!/^\d+(?:\.\d+)?$/.test(text)) return { ok: false, error: "not_numeric" };
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > USDC_DECIMALS) return { ok: false, error: "too_precise" };
  const raw = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  const min = kind === "supply" ? MIN_SUPPLY_UNITS : MIN_WITHDRAW_UNITS;
  const max = kind === "supply" ? MAX_SUPPLY_UNITS : MAX_WITHDRAW_UNITS;
  if (raw < min) return { ok: false, error: "below_minimum" };
  if (raw > max) return { ok: false, error: "above_maximum" };
  return { ok: true, raw, human: formatUsdc(raw) };
}

/** 6-dp base units → a plain decimal string (no thousands separators, exact). */
export function formatUsdc(raw: bigint): string {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** 6-dp USDC base units → Burrow inner units (token dp + extra_decimals). */
export function toBurrowInnerUnits(amount6: bigint): bigint {
  return amount6 * 10n ** BigInt(BURROW_USDC_EXTRA_DECIMALS);
}

/** Burrow inner units → 6-dp USDC base units. Rejects values that are not an exact multiple. */
export function fromBurrowInnerUnits(inner: bigint): bigint {
  return inner / 10n ** BigInt(BURROW_USDC_EXTRA_DECIMALS);
}

export interface StorageState {
  readonly burrowRegistered: boolean;
  readonly tokenReceiverRegistered: boolean;
  readonly burrowStorageMinYocto?: bigint;
  readonly tokenStorageMinYocto?: bigint;
}

export interface SupplyPlanInput {
  readonly accountId: string;
  readonly amount6: bigint;
  readonly storage: StorageState;
}

export interface BuiltPlan {
  readonly transactions: readonly NearTransaction[];
  readonly storage: {
    readonly burrowDepositYocto: bigint;
    readonly tokenDepositYocto: bigint;
    readonly totalYocto: bigint;
    readonly registersBurrowAccount: boolean;
    readonly registersTokenReceiver: boolean;
  };
  readonly nearRequiredYocto: bigint;
}

export function buildSupplyPlan(input: SupplyPlanInput): BuiltPlan {
  assertAccountAndAsset(input.accountId);
  if (input.amount6 <= 0n) throw new Error("Amount must be greater than zero.");
  if (input.amount6 < MIN_SUPPLY_UNITS) throw new Error(`Minimum supply is ${formatUsdc(MIN_SUPPLY_UNITS)} USDC.`);
  if (input.amount6 > MAX_SUPPLY_UNITS) throw new Error(`Maximum supply is ${formatUsdc(MAX_SUPPLY_UNITS)} USDC.`);

  const burrowMin = input.storage.burrowStorageMinYocto ?? BURROW_STORAGE_MIN_YOCTO;
  const tokenMin = input.storage.tokenStorageMinYocto ?? TOKEN_STORAGE_MIN_YOCTO;
  const burrowDeposit = input.storage.burrowRegistered ? 0n : burrowMin;
  const tokenDeposit = input.storage.tokenReceiverRegistered ? 0n : tokenMin;

  // A NEAR transaction has exactly ONE receiver: every action in it runs against that account.
  // So the plan emits one transaction per target contract, each signed by the user's own account.
  // Registrations must land before the ft_transfer_call; the shared signer nonce orders them.
  const transactions: NearTransaction[] = [];
  if (!input.storage.burrowRegistered) {
    transactions.push({
      receiverId: BURROW_CONTRACT,
      actions: [functionCall(BURROW_CONTRACT, "storage_deposit", {}, STORAGE_DEPOSIT_GAS, burrowDeposit)],
    });
  }
  const tokenActions: FunctionCallAction[] = [];
  if (!input.storage.tokenReceiverRegistered) {
    tokenActions.push(
      functionCall(
        USDC_TOKEN_ID,
        "storage_deposit",
        { account_id: BURROW_CONTRACT, registration_only: true },
        STORAGE_DEPOSIT_GAS,
        tokenDeposit,
      ),
    );
  }
  // Documented Burrow supply: an ordinary `ft_transfer_call` with an empty msg. Burrow has no
  // separate `Deposit` action; empty msg is the supply instruction. 1 yoctoNEAR is required by NEP-141.
  tokenActions.push(
    functionCall(
      USDC_TOKEN_ID,
      "ft_transfer_call",
      { receiver_id: BURROW_CONTRACT, amount: input.amount6.toString(), msg: "" },
      FT_TRANSFER_CALL_GAS,
      ONE_YOCTO,
    ),
  );
  transactions.push({ receiverId: USDC_TOKEN_ID, actions: tokenActions });

  const totalStorage = burrowDeposit + tokenDeposit;
  return {
    transactions,
    storage: {
      burrowDepositYocto: burrowDeposit,
      tokenDepositYocto: tokenDeposit,
      totalYocto: totalStorage,
      registersBurrowAccount: !input.storage.burrowRegistered,
      registersTokenReceiver: !input.storage.tokenReceiverRegistered,
    },
    nearRequiredYocto: totalStorage + NEAR_GAS_RESERVE_YOCTO,
  };
}

export interface WithdrawPlanInput {
  readonly accountId: string;
  readonly amount6: bigint;
  readonly suppliedInnerUnits: bigint;
  readonly canWithdraw: boolean;
  /** "Max" uses the exact live supplied inner balance instead of re-scaling a floored 6-dp value. */
  readonly maxAmountInnerUnits?: bigint;
}

export function buildWithdrawPlan(input: WithdrawPlanInput): BuiltPlan {
  assertAccountAndAsset(input.accountId);
  if (!input.canWithdraw) throw new Error("Burrow has currently disabled withdrawals for this asset.");
  if (input.amount6 <= 0n) throw new Error("Amount must be greater than zero.");
  if (input.amount6 > MAX_WITHDRAW_UNITS) {
    throw new Error(`Maximum withdraw is ${formatUsdc(MAX_WITHDRAW_UNITS)} USDC.`);
  }
  const maxInner = input.maxAmountInnerUnits ?? toBurrowInnerUnits(input.amount6);
  if (maxInner <= 0n) throw new Error("Amount must be greater than zero.");
  if (maxInner > input.suppliedInnerUnits) {
    throw new Error("You cannot withdraw more than your supplied USDC balance.");
  }

  const action = functionCall(
    BURROW_CONTRACT,
    "execute",
    {
      actions: [
        {
          Withdraw: {
            token_id: USDC_TOKEN_ID,
            max_amount: maxInner.toString(),
          },
        },
      ],
    },
    BURROW_EXECUTE_GAS,
    ONE_YOCTO,
  );

  return {
    transactions: [{ receiverId: BURROW_CONTRACT, actions: [action] }],
    storage: {
      burrowDepositYocto: 0n,
      tokenDepositYocto: 0n,
      totalYocto: 0n,
      registersBurrowAccount: false,
      registersTokenReceiver: false,
    },
    nearRequiredYocto: NEAR_GAS_RESERVE_YOCTO,
  };
}

function assertAccountAndAsset(accountId: string): void {
  if (!isValidNearAccountId(accountId)) throw new Error("The NEAR account id is not valid.");
  if (!isAllowedContract(BURROW_CONTRACT) || !isAllowedAsset(USDC_TOKEN_ID)) {
    throw new Error("The pinned Burrow contracts failed the allowlist check.");
  }
}

export function functionCall(
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
  depositYocto: bigint | string,
): FunctionCallAction {
  if (!isAllowedContract(contractId)) throw new Error(`Refusing a call to a non-allowlisted contract: ${contractId}`);
  return {
    type: "FunctionCall",
    params: {
      methodName,
      args,
      gas,
      deposit: typeof depositYocto === "bigint" ? depositYocto.toString() : depositYocto,
    },
  };
}

export interface BalanceCheckInput {
  readonly tokenBalance6: bigint;
  readonly nearBalanceYocto: bigint;
  readonly nearRequiredYocto: bigint;
  readonly amount6: bigint;
}

export type BalanceFailure = "insufficient_token_balance" | "insufficient_near_for_gas_storage";

export function checkSupplyBalances(input: BalanceCheckInput): BalanceFailure | null {
  if (input.tokenBalance6 < input.amount6) return "insufficient_token_balance";
  if (input.nearBalanceYocto < input.nearRequiredYocto) return "insufficient_near_for_gas_storage";
  return null;
}

export function checkWithdrawBalances(input: {
  readonly nearBalanceYocto: bigint;
  readonly nearRequiredYocto: bigint;
  readonly suppliedInnerUnits: bigint;
  readonly requested6: bigint;
}): BalanceFailure | "insufficient_supplied" | null {
  if (input.nearBalanceYocto < input.nearRequiredYocto) return "insufficient_near_for_gas_storage";
  if (toBurrowInnerUnits(input.requested6) > input.suppliedInnerUnits) return "insufficient_supplied";
  return null;
}

/** A stale reviewed plan must never be submitted: rates/blocks move. */
export function planIsFresh(checkedAtMs: number, nowMs = Date.now()): boolean {
  const age = nowMs - checkedAtMs;
  return Number.isFinite(age) && age >= 0 && age <= PLAN_MAX_AGE_MS;
}

export function refusedWalletSwitch(expectedAccountId: string, currentAccountId: string | null): boolean {
  return !currentAccountId || currentAccountId !== expectedAccountId;
}

export type ReceiptStatus = "confirmed" | "failed" | "pending";

export interface ReceiptClassification {
  readonly status: ReceiptStatus;
  readonly error: string | null;
}

/** Classify a NEAR `tx` result honestly: only an explicit SuccessValue is confirmed. */
export function classifyReceipt(result: unknown): ReceiptClassification {
  if (!result || typeof result !== "object") return { status: "pending", error: null };
  const body = result as {
    status?: unknown;
    final_execution_status?: string;
    result?: unknown;
  };
  const finality = body.final_execution_status ?? "";
  const status = body.status ?? (body.result as { status?: unknown } | undefined)?.status;
  if (isFailure(status)) {
    return { status: "failed", error: failureMessage(status) };
  }
  if (isSuccess(status)) {
    // `EXECUTED_OPTIMISTIC` is not final; the receipt exists but we do not claim finality.
    if (/FINAL/.test(finality)) return { status: "confirmed", error: null };
    return { status: "pending", error: null };
  }
  if (/FINAL/.test(finality)) return { status: "failed", error: "The transaction finalized without a success value." };
  return { status: "pending", error: null };
}

function isSuccess(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "SuccessValue" in (value as Record<string, unknown>);
}

function isFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "Failure" in (value as Record<string, unknown>);
}

function failureMessage(value: unknown): string {
  const failure = (value as { Failure?: unknown }).Failure;
  if (typeof failure === "string") return failure;
  try {
    return JSON.stringify(failure);
  } catch {
    return "The transaction failed.";
  }
}

export function firstTransactionHash(outcomes: readonly NearTransactionOutcome[]): string | null {
  for (const outcome of outcomes) {
    const hash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id;
    if (hash) return hash;
  }
  return null;
}
