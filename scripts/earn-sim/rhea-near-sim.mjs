#!/usr/bin/env node
/**
 * 078 — Rhea same-chain NEAR simulation (READ-ONLY).
 *
 * Reads Burrow/NEAR state and dry-builds the UNSIGNED actions the live UI would hand to a wallet.
 * It NEVER signs, approves, transfers, submits or broadcasts. Everything here is SIMULATED.
 *
 * An expected insufficient-token-balance / missing-storage / no-position result is NOT a pass for
 * the funded path. It is reported as an expected preflight refusal so the funded gap stays visible.
 *
 * Usage: node scripts/earn-sim/rhea-near-sim.mjs [accountId]
 */

const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";
const ACCOUNT = process.argv[2] || "sparkpoint2026.near";

const BURROW = "contract.main.burrow.near";
// Official public NEAR native USDC NEP-141 mainnet contract id (Rhea/Burrow docs) — not a secret.
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // gitleaks:allow (public USDC NEP-141 contract id, not a secret)
const USDC_DECIMALS = 6;
const EXTRA_DECIMALS = 12;
const GAS_STORAGE = "30000000000000";
const GAS_FT = "100000000000000";
const GAS_EXECUTE = "100000000000000";
const ONE_YOCTO = "1";
const BURROW_STORAGE_MIN = 100_000_000_000_000_000_000_000n;
const TOKEN_STORAGE_MIN = 1_250_000_000_000_000_000_000n;
const NEAR_GAS_RESERVE = 20_000_000_000_000_000_000_000n;

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "rhea-sim", method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error).slice(0, 300)}`);
  return data.result;
}

async function view(contract, method, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
  });
  const bytes = Buffer.from(result.result || []);
  return bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
}

async function account(accountId) {
  return rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
}

function usdc(raw) {
  const value = BigInt(raw || "0");
  const whole = value / 10n ** 6n;
  const fraction = (value % 10n ** 6n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function near(yocto) {
  const value = BigInt(yocto || "0");
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
}

function fn(contract, methodName, args, gas, deposit) {
  return { type: "FunctionCall", params: { methodName, args, gas, deposit } };
}

function buildSupply(amount6, burrowRegistered, tokenReceiverRegistered, burrowMin, tokenMin) {
  const actions = [];
  if (!burrowRegistered) actions.push(fn(BURROW, "storage_deposit", {}, GAS_STORAGE, burrowMin.toString()));
  if (!tokenReceiverRegistered) {
    actions.push(
      fn(
        USDC,
        "storage_deposit",
        { account_id: BURROW, registration_only: true },
        GAS_STORAGE,
        tokenMin.toString(),
      ),
    );
  }
  actions.push(fn(USDC, "ft_transfer_call", { receiver_id: BURROW, amount: amount6.toString(), msg: "" }, GAS_FT, ONE_YOCTO));
  return { receiverId: ACCOUNT, actions };
}

function buildWithdraw(amount6) {
  return {
    receiverId: ACCOUNT,
    actions: [
      fn(
        BURROW,
        "execute",
        { actions: [{ Withdraw: { token_id: USDC, max_amount: (amount6 * 10n ** BigInt(EXTRA_DECIMALS)).toString() } }] },
        GAS_EXECUTE,
        ONE_YOCTO,
      ),
    ],
  };
}

function withdrawFromPositions(positions) {
  if (!positions || !Array.isArray(positions.supplied)) return 0n;
  const entry = positions.supplied.find((item) => item.token_id === USDC);
  return entry && entry.balance ? BigInt(entry.balance) : 0n;
}

async function main() {
  const out = {
    SIMULATED: true,
    sent: false,
    signed: false,
    network: RPC_URL.includes("testnet") ? "testnet" : "mainnet",
    account: ACCOUNT,
    pinned: { burrow: BURROW, token: USDC, symbol: "USDC" },
    note: "READ-ONLY simulation. No key, signature, approval, transfer, submit or broadcast.",
    expectedFailuresAreNotPasses: true,
  };

  const [block, metadata, asset, acct, tokenBalance, burrowStorage, tokenReceiverStorage, positions, burrowBounds, tokenBounds] =
    await Promise.all([
      rpc("block", { finality: "final" }),
      view(USDC, "ft_metadata"),
      view(BURROW, "get_asset", { token_id: USDC }),
      account(ACCOUNT),
      view(USDC, "ft_balance_of", { account_id: ACCOUNT }),
      view(BURROW, "storage_balance_of", { account_id: ACCOUNT }),
      view(USDC, "storage_balance_of", { account_id: BURROW }),
      view(BURROW, "get_account_all_positions", { account_id: ACCOUNT }),
      view(BURROW, "storage_balance_bounds"),
      view(USDC, "storage_balance_bounds"),
    ]);
  const burrowMin = BigInt(burrowBounds?.min || BURROW_STORAGE_MIN);
  const tokenMin = BigInt(tokenBounds?.min || TOKEN_STORAGE_MIN);

  const suppliedInner = withdrawFromPositions(positions);
  const tokenRaw = BigInt(tokenBalance || "0");
  const nearRaw = BigInt(acct.amount || "0");
  const oneUsdc = 1_000_000n;

  out.reads = {
    block: { height: block.header?.height ?? null, hashPrefix: String(block.header?.hash || "").slice(0, 10) },
    usdcMetadata: { decimals: metadata?.decimals ?? null, symbol: metadata?.symbol ?? null },
    burrowUsdc: {
      extraDecimals: asset?.config?.extra_decimals ?? null,
      canDeposit: asset?.config?.can_deposit ?? null,
      canWithdraw: asset?.config?.can_withdraw ?? null,
      suppliedInner: asset?.supplied?.balance ?? null,
    },
    account: { nearBalance: near(nearRaw), usdcBalance: usdc(tokenRaw) },
    registration: {
      burrowRegistered: burrowStorage !== null,
      burrowStorageMinNear: near(burrowMin),
      tokenReceiverRegistered: tokenReceiverStorage !== null,
      tokenStorageMinNear: near(tokenMin),
    },
    supplied: { innerUnits: suppliedInner.toString(), usdc: usdc(suppliedInner / 10n ** 12n) },
  };

  const storageNeeded = (burrowStorage === null ? burrowMin : 0n) + (tokenReceiverStorage === null ? tokenMin : 0n);
  const nearRequired = storageNeeded + NEAR_GAS_RESERVE;
  out.preflight = {
    tokenSufficient: tokenRaw >= oneUsdc,
    nearSufficient: nearRaw >= nearRequired,
    nearRequired: near(nearRequired),
    expectedFailures: [
      ...(tokenRaw < oneUsdc ? ["insufficient_token_balance (expected, NOT a pass)"] : []),
      ...(nearRaw < nearRequired ? ["insufficient_near_for_gas_storage (expected, NOT a pass)"] : []),
      ...(suppliedInner === 0n ? ["no_position_for_withdraw (expected, NOT a pass)"] : []),
    ],
  };

  out.dryBuild = {
    simulated: true,
    sent: false,
    supply: {
      amount: usdc(oneUsdc),
      unsignedTransaction: buildSupply(oneUsdc, burrowStorage !== null, tokenReceiverStorage !== null, burrowMin, tokenMin),
    },
    withdraw: {
      amount: suppliedInner > 0n ? usdc(suppliedInner / 10n ** 12n) : usdc(oneUsdc),
      available: suppliedInner > 0n,
      unsignedTransaction: suppliedInner > 0n ? buildWithdraw(suppliedInner / 10n ** 12n) : buildWithdraw(oneUsdc),
      note:
        suppliedInner > 0n
          ? "Built from the live supplied balance."
          : "ILLUSTRATIVE ONLY: this account has no Burrow position, so the withdraw would be refused by preflight. NOT a funded pass.",
    },
  };

  out.verdict = {
    readOnlySimulation: "PASS",
    fundedSupplyWithdraw: "NOT TESTED — expected failures above must be resolved with a funded test account",
    signed: false,
    submitted: false,
  };

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        SIMULATED: true,
        sent: false,
        signed: false,
        verdict: { readOnlySimulation: "FAIL", reason: error instanceof Error ? error.message : String(error) },
      },
      null,
      2,
    )}\n`,
  );
  process.exit(2);
});
