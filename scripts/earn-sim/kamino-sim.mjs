#!/usr/bin/env node
/**
 * 077 — Kamino SIMULATION smoke test.
 *
 * Fetches real UNSIGNED deposit/withdraw transactions from Kamino's public API for the task's
 * public Solana probe wallet, then asks a public Solana RPC to SIMULATE them (replace blockhash,
 * signature verification off). It never signs, never calls sendTransaction, and never moves funds.
 *
 * The probe is a public address with a small SOL balance and no Kamino position. The deposit
 * simulation may succeed (it does not execute), and the withdraw is expected to fail because the
 * probe holds no shares. Either way the output is SIMULATED: nothing is signed or sent.
 *
 * Run: node scripts/earn-sim/kamino-sim.mjs
 */

const API = "https://api.kamino.finance";
const RPC = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const PROBE = "J9EH8VmiXd58kuhhUCbED6Pm1dZU9fFQELhVE9UyMEKz";
const VAULT = "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg";

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function build(kind, amount) {
  const response = await fetch(`${API}/ktx/kvault/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "sparkpoint-earn-sim/1.0" },
    body: JSON.stringify({ wallet: PROBE, kvault: VAULT, amount }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`${kind} build failed: HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body.transaction !== "string") throw new Error(`${kind} build returned no transaction`);
  return body.transaction;
}

async function simulate(label, base64) {
  const result = await rpc("simulateTransaction", [
    base64,
    {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
      commitment: "confirmed",
    },
  ]);
  const value = result?.value ?? {};
  const logs = Array.isArray(value.logs) ? value.logs : [];
  console.log(`\n[${label}] SIMULATED`);
  console.log(`  err        : ${value.err ? JSON.stringify(value.err) : "none"}`);
  console.log(`  units      : ${value.unitsConsumed ?? "n/a"}`);
  console.log(`  logs (tail): ${logs.slice(-4).join(" | ") || "(none)"}`);
  if (value.err) {
    console.log("  expected   : the public probe has no position / not enough balance — this revert is the honest result, NOT a pass.");
  } else {
    console.log("  note       : simulation only — this transaction was NOT signed or sent, so it is NOT funded-execution proof.");
  }
}

async function main() {
  console.log("Kamino earn simulation — SIMULATED, nothing is signed or sent.");
  console.log(`  RPC    : ${RPC}`);
  console.log(`  wallet : ${PROBE} (public probe, no Kamino position)`);
  console.log(`  vault  : ${VAULT} (SOL Balanced)`);

  const deposit = await build("deposit", "0.01");
  const withdraw = await build("withdraw", "0.01");
  console.log(`  built  : deposit ${deposit.length} b64 chars, withdraw ${withdraw.length} b64 chars (unsigned)`);

  await simulate("deposit 0.01 SOL", deposit);
  await simulate("withdraw 0.01 shares", withdraw);

  console.log("\nSIMULATED only. No transaction was signed or sent. An expected withdraw failure is NOT a success.");
}

main().catch((error) => {
  console.error("SIMULATED run failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
