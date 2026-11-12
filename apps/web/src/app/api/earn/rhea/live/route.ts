import { NextResponse } from "next/server";

import {
  BURROW_CONTRACT,
  BURROW_STORAGE_MIN_YOCTO,
  MAX_WITHDRAW_UNITS,
  MIN_WITHDRAW_UNITS,
  RHEA_APP_URL,
  TOKEN_STORAGE_MIN_YOCTO,
  USDC_DECIMALS,
  USDC_SYMBOL,
  USDC_TOKEN_ID,
  availableSupplyUsdc,
  availableWithdrawUsdc,
  buildSupplyPlan,
  buildWithdrawPlan,
  checkSupplyBalances,
  checkWithdrawBalances,
  formatUsdc,
  fromBurrowInnerUnits,
  parseUsdcAmount,
  suppliedInnerUnitsFor,
  toBurrowInnerUnits,
  type NearTransaction,
} from "@/lib/near/burrow";
import { isValidNearAccountId } from "@/lib/near/account";
import { formatNearYocto, serverLiveRheaEnabled } from "@/lib/near/liveEarn";
import { latestBlock, viewAccount, viewCall } from "@/lib/near/rpc";

/**
 * 078 — Rhea same-chain live earn PREFLIGHT.
 *
 * This route is READ-ONLY: it reads Burrow/token/account state and returns UNSIGNED actions for the
 * user's own wallet to sign. It never signs, submits or broadcasts. When `EARN_LIVE_RHEA` is not
 * exactly "true" the route 404s, so a browser cannot obtain a plan from a disabled deployment.
 */

export const runtime = "nodejs";

interface FtMetadata {
  decimals?: unknown;
  symbol?: unknown;
}

interface StorageBalance {
  total?: string;
  available?: string;
}

interface StorageBounds {
  min?: string;
  max?: string | null;
}

interface BurrowAsset {
  supplied?: { balance?: string };
  borrowed?: { balance?: string };
  config?: { can_deposit?: boolean; can_withdraw?: boolean; extra_decimals?: number };
}

interface AllPositions {
  supplied?: Array<{ token_id?: string; balance?: string }>;
}

interface PreflightBody {
  action?: unknown;
  accountId?: unknown;
  amount?: unknown;
  max?: unknown;
}

function configuredNetwork(): "mainnet" | "testnet" {
  return (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "").trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
}

function notFound() {
  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}

function bad(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

export async function GET(request: Request) {
  if (!serverLiveRheaEnabled()) return notFound();
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      network: configuredNetwork(),
      protocol: "rhea",
      contract: BURROW_CONTRACT,
      token: USDC_TOKEN_ID,
      symbol: USDC_SYMBOL,
      decimals: USDC_DECIMALS,
      appUrl: RHEA_APP_URL,
      note: "Supply or withdraw USDC on NEAR with your own NEAR wallet.",
    });
  }
  if (!isValidNearAccountId(accountId)) return bad("bad_account", "Enter a valid NEAR account id.");

  try {
    const [positions, tokenBalance] = await Promise.all([
      viewCall<AllPositions | null>(BURROW_CONTRACT, "get_account_all_positions", { account_id: accountId }),
      viewCall<string>(USDC_TOKEN_ID, "ft_balance_of", { account_id: accountId }),
    ]);
    const suppliedInner = suppliedInnerUnitsFor(positions);
    let walletRaw = 0n;
    try {
      walletRaw = BigInt(tokenBalance || "0");
    } catch {
      walletRaw = 0n;
    }
    return NextResponse.json({
      ok: true,
      accountId,
      walletUsdc: availableSupplyUsdc(walletRaw),
      walletUsdcRaw: walletRaw.toString(),
      suppliedUsdc: availableWithdrawUsdc(positions),
      suppliedRaw: suppliedInner.toString(),
    });
  } catch {
    return bad("rpc_unavailable", "The NEAR balance read didn't complete. Nothing was signed.", 503);
  }
}

export async function POST(request: Request) {
  if (!serverLiveRheaEnabled()) return notFound();

  let body: PreflightBody;
  try {
    body = (await request.json()) as PreflightBody;
  } catch {
    return bad("bad_json", "The request body must be JSON.");
  }

  if (configuredNetwork() !== "mainnet") {
    return bad(
      "unsupported_network",
      "This Rhea flow is mainnet-only. The app is not configured for NEAR mainnet; refusing to build.",
      409,
    );
  }

  const action = body.action === "withdraw" ? "withdraw" : body.action === "supply" ? "supply" : null;
  if (!action) return bad("bad_action", "Action must be supply or withdraw.");
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!isValidNearAccountId(accountId)) return bad("bad_account", "Enter a valid NEAR account id.");

  // `max` is resolved against the live supplied balance below; any sent amount is not trusted for it.
  const isMax = action === "withdraw" && body.max === true;

  let amount6: bigint | null = null;
  if (!isMax) {
    const rawAmount = typeof body.amount === "string" ? body.amount : String(body.amount ?? "");
    const parsed = parseUsdcAmount(rawAmount, action);
    if (!parsed.ok) {
      return bad(
        `bad_amount_${parsed.error}`,
        amountMessage(parsed.error, action),
      );
    }
    amount6 = parsed.raw;
    if (action === "withdraw" && amount6 < MIN_WITHDRAW_UNITS) {
      return bad("bad_amount_below_minimum", "Enter an amount greater than zero.");
    }
    if (action === "withdraw" && amount6 > MAX_WITHDRAW_UNITS) {
      return bad("bad_amount_above_maximum", "The withdraw amount is above the supported bound.");
    }
  }

  let block: { height: number; hash: string };
  let metadata: FtMetadata;
  let asset: BurrowAsset;
  let account: { amount: string };
  let tokenBalance: string;
  let burrowStorage: StorageBalance | null;
  let tokenReceiverStorage: StorageBalance | null;
  let positions: AllPositions | null;
  let burrowBounds: StorageBounds;
  let tokenBounds: StorageBounds;
  try {
    [block, metadata, asset, account, tokenBalance, burrowStorage, tokenReceiverStorage, positions, burrowBounds, tokenBounds] =
      await Promise.all([
        latestBlock(),
        viewCall<FtMetadata>(USDC_TOKEN_ID, "ft_metadata"),
        viewCall<BurrowAsset>(BURROW_CONTRACT, "get_asset", { token_id: USDC_TOKEN_ID }),
        viewAccount(accountId),
        viewCall<string>(USDC_TOKEN_ID, "ft_balance_of", { account_id: accountId }),
        viewCall<StorageBalance | null>(BURROW_CONTRACT, "storage_balance_of", { account_id: accountId }),
        viewCall<StorageBalance | null>(USDC_TOKEN_ID, "storage_balance_of", { account_id: BURROW_CONTRACT }),
        viewCall<AllPositions | null>(BURROW_CONTRACT, "get_account_all_positions", { account_id: accountId }),
        viewCall<StorageBounds>(BURROW_CONTRACT, "storage_balance_bounds"),
        viewCall<StorageBounds>(USDC_TOKEN_ID, "storage_balance_bounds"),
      ]);
  } catch {
    return bad("rpc_unavailable", "The NEAR RPC read didn't complete. Nothing was built or signed.", 503);
  }

  if (metadata.decimals !== USDC_DECIMALS || (metadata.symbol && metadata.symbol !== USDC_SYMBOL)) {
    return bad("unknown_asset", "The pinned USDC token metadata did not match. Refusing to build.");
  }
  if (!asset || asset.config?.extra_decimals !== 12) {
    return bad("unknown_asset", "Burrow did not return the expected USDC asset config. Refusing to build.");
  }

  const suppliedInnerUnits = suppliedInnerUnitsFor(positions);
  if (action === "withdraw" && isMax) {
    if (suppliedInnerUnits <= 0n) {
      return bad("no_position", "There is no supplied USDC position to withdraw for this account.");
    }
    amount6 = fromBurrowInnerUnits(suppliedInnerUnits);
    if (amount6 < MIN_WITHDRAW_UNITS) {
      return bad("no_position", "The supplied balance is too small to withdraw.");
    }
  }
  if (amount6 === null) return bad("bad_amount", "Enter an amount.");

  const nearBalance = BigInt(account.amount || "0");
  const tokenBalanceRaw = BigInt(tokenBalance || "0");

  try {
    if (action === "supply") {
      if (asset.config?.can_deposit === false) {
        return bad("deposit_disabled", "Burrow has currently disabled deposits for USDC. Nothing was built.");
      }
      const plan = buildSupplyPlan({
        accountId,
        amount6,
        storage: {
          burrowRegistered: burrowStorage !== null,
          tokenReceiverRegistered: tokenReceiverStorage !== null,
          burrowStorageMinYocto: storageMin(burrowBounds, BURROW_STORAGE_MIN_YOCTO),
          tokenStorageMinYocto: storageMin(tokenBounds, TOKEN_STORAGE_MIN_YOCTO),
        },
      });
      const failure = checkSupplyBalances({
        tokenBalance6: tokenBalanceRaw,
        nearBalanceYocto: nearBalance,
        nearRequiredYocto: plan.nearRequiredYocto,
        amount6,
      });
      if (failure) return balanceFailure(failure, tokenBalanceRaw, nearBalance, plan.nearRequiredYocto, amount6);
      return planResponse({
        action,
        accountId,
        amount6,
        plan,
        tokenBalanceRaw,
        nearBalance,
        suppliedInnerUnits,
        block,
      });
    }

    if (asset.config?.can_withdraw === false) {
      return bad("withdraw_disabled", "Burrow has currently disabled withdrawals for USDC. Nothing was built.");
    }
    const plan = buildWithdrawPlan({
      accountId,
      amount6,
      suppliedInnerUnits,
      canWithdraw: true,
      maxAmountInnerUnits: isMax ? suppliedInnerUnits : undefined,
    });
    const failure = checkWithdrawBalances({
      nearBalanceYocto: nearBalance,
      nearRequiredYocto: plan.nearRequiredYocto,
      suppliedInnerUnits,
      requested6: amount6,
    });
    if (failure === "insufficient_supplied") {
      return bad("insufficient_supplied", "You cannot withdraw more than your supplied USDC balance.", 409);
    }
    if (failure) return balanceFailure(failure, tokenBalanceRaw, nearBalance, plan.nearRequiredYocto, amount6);
    return planResponse({
      action,
      accountId,
      amount6,
      plan,
      tokenBalanceRaw,
      nearBalance,
      suppliedInnerUnits,
      block,
    });
  } catch (error) {
    return bad("build_refused", error instanceof Error ? error.message : "The plan was refused.", 409);
  }
}

function storageMin(bounds: StorageBounds, fallback: bigint): bigint {
  if (typeof bounds?.min === "string") {
    try {
      const parsed = BigInt(bounds.min);
      if (parsed > 0n) return parsed;
    } catch {
      // fall through to the documented constant
    }
  }
  return fallback;
}

function amountMessage(error: string, action: "supply" | "withdraw"): string {
  switch (error) {
    case "empty":
      return "Enter an amount.";
    case "not_numeric":
      return "Use a plain number, for example 25 or 12.5.";
    case "too_precise":
      return "USDC has 6 decimals — use no more than 6 decimal places.";
    case "below_minimum":
      return action === "supply" ? "The minimum supply is 0.01 USDC." : "Enter an amount greater than zero.";
    case "above_maximum":
      return action === "supply" ? "The supply amount is above the supported bound." : "The withdraw amount is above the supported bound.";
    default:
      return "That amount is not valid.";
  }
}

function balanceFailure(
  failure: string,
  tokenBalance: bigint,
  nearBalance: bigint,
  nearRequired: bigint,
  amount6: bigint,
) {
  if (failure === "insufficient_token_balance") {
    return bad(
      "insufficient_token_balance",
      `This account holds ${formatYoctoToken(tokenBalance)} USDC; the plan needs ${formatYoctoToken(amount6)} USDC. Nothing was built or signed.`,
      409,
    );
  }
  return bad(
    "insufficient_near_for_gas_storage",
    `This account holds ${formatNearYocto(nearBalance)} NEAR; gas + storage needs ${formatNearYocto(nearRequired)} NEAR. Nothing was built or signed.`,
    409,
  );
}

function formatYoctoToken(raw: bigint): string {
  const whole = raw / 10n ** 6n;
  const fraction = (raw % 10n ** 6n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function planResponse(input: {
  action: "supply" | "withdraw";
  accountId: string;
  amount6: bigint;
  plan: { transactions: readonly NearTransaction[]; storage: { totalYocto: bigint; registersBurrowAccount: boolean; registersTokenReceiver: boolean }; nearRequiredYocto: bigint };
  tokenBalanceRaw: bigint;
  nearBalance: bigint;
  suppliedInnerUnits: bigint;
  block: { height: number; hash: string };
}) {
  const amountHuman = formatYoctoToken(input.amount6);
  return NextResponse.json({
    ok: true,
    simulated: false,
    sent: false,
    action: input.action,
    accountId: input.accountId,
    amount: amountHuman,
    amountRaw: input.amount6.toString(),
    transactions: input.plan.transactions,
    review: {
      action: input.action,
      accountId: input.accountId,
      amount: amountHuman,
      amountRaw: input.amount6.toString(),
      tokenBalance: formatYoctoToken(input.tokenBalanceRaw),
      nearBalance: formatNearYocto(input.nearBalance),
      nearRequired: formatNearYocto(input.plan.nearRequiredYocto),
      supplied: input.action === "withdraw" ? formatUsdc(fromBurrowInnerUnits(input.suppliedInnerUnits)) : null,
      storage: {
        registersBurrowAccount: input.plan.storage.registersBurrowAccount,
        registersTokenReceiver: input.plan.storage.registersTokenReceiver,
        totalNear: formatNearYocto(input.plan.storage.totalYocto),
      },
      contract: BURROW_CONTRACT,
      token: USDC_TOKEN_ID,
      blockHeight: input.block.height,
      blockHash: input.block.hash,
      checkedAtMs: Date.now(),
    },
    note:
      input.action === "supply"
        ? "UNSIGNED. Review, then your NEAR wallet signs the ft_transfer_call (plus storage_deposit only if registration is missing). Nothing is sent by this route."
        : "UNSIGNED. Review, then your NEAR wallet signs the Burrow execute Withdraw call. Nothing is sent by this route.",
    crossChain: {
      satisfied: false,
      note: "This flow supplies and withdraws USDC on NEAR only.",
    },
    innerUnits: toBurrowInnerUnits(input.amount6).toString(),
  });
}
