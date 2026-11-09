#!/usr/bin/env node
/**
 * 077 — Morpho Base SIMULATION smoke test.
 *
 * Read-only `eth_call` reads plus `eth_estimateGas` for the unfunded Base probe wallet. It never
 * signs, never sends a transaction and never approves anything. The probe has no USDC, so the
 * deposit/approve gas estimates are EXPECTED to fail with insufficient funds / a revert.
 *
 * Run: node scripts/earn-sim/morpho-sim.mjs
 */

const RPC = process.env.BASE_MAINNET_RPC_URL?.trim() || "https://mainnet.base.org";
const VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"; // Gauntlet USDC Prime
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
const PROBE = "0xBddA41D11014FdD9a656386e29Af1a1349f94f13"; // public, unfunded

// Pinned selectors (no hash dependency; standard ERC-4626/ERC-20).
const SELECTOR = {
  asset: "0x38d52e0f",
  decimals: "0x313ce567",
  totalAssets: "0x01e1d114",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  previewDeposit: "0xef8b30f7",
  convertToAssets: "0x07a2d13a",
  approve: "0x095ea7b3",
  deposit: "0x6e553f65",
  redeem: "0xba087652",
};

function addressWord(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json();
  if (body.error) return { error: body.error };
  return { result: body.result };
}

async function call(to, data, label) {
  const { result, error } = await rpc("eth_call", [{ to, data }, "latest"]);
  if (error) {
    console.log(`  ${label.padEnd(26)} ERROR ${error.message}`);
    return null;
  }
  return result;
}

function asBigInt(hex) {
  return hex && hex !== "0x" ? BigInt(hex) : 0n;
}

async function estimate(label, tx) {
  const { result, error } = await rpc("eth_estimateGas", [tx]);
  if (error) {
    const expected = /insufficient funds|exceeds balance|transfer amount exceeds balance|revert/i.test(error.message);
    console.log(`  ${label.padEnd(26)} ERROR${expected ? " (expected: unfunded probe)" : ""}: ${error.message}`);
    return null;
  }
  console.log(`  ${label.padEnd(26)} ${BigInt(result).toString()} gas (SIMULATED estimate)`);
  return BigInt(result);
}

async function main() {
  console.log("Morpho Base simulation — SIMULATED, nothing is signed or sent.");
  console.log(`  RPC    : ${RPC}`);
  console.log(`  wallet : ${PROBE} (public, unfunded)`);
  console.log(`  vault  : ${VAULT} (Gauntlet USDC Prime)`);

  const chain = await rpc("eth_chainId", []);
  console.log(`  chainId: ${chain.result ? BigInt(chain.result).toString() : "unavailable"}`);

  const asset = await call(VAULT, SELECTOR.asset, "vault.asset()");
  const decimals = await call(VAULT, SELECTOR.decimals, "vault.decimals()");
  const totalAssets = await call(VAULT, SELECTOR.totalAssets, "vault.totalAssets()");
  const vaultBalance = await call(VAULT, SELECTOR.balanceOf + addressWord(PROBE), "vault.balanceOf(probe)");
  const usdcBalance = await call(ASSET, SELECTOR.balanceOf + addressWord(PROBE), "usdc.balanceOf(probe)");
  const allowance = await call(
    ASSET,
    SELECTOR.allowance + addressWord(PROBE) + addressWord(VAULT),
    "usdc.allowance(probe,vault)",
  );
  const oneUsdc = 1_000_000n;
  const preview = await call(VAULT, SELECTOR.previewDeposit + uintWord(oneUsdc), "previewDeposit(1 USDC)");

  console.log(`  asset   : ${asset ?? "unavailable"}`);
  console.log(`  decimals: ${decimals ? Number(asBigInt(decimals)) : "unavailable"}`);
  console.log(`  totalAssets (raw): ${totalAssets ? asBigInt(totalAssets).toString() : "unavailable"}`);
  console.log(`  probe shares      : ${vaultBalance ? asBigInt(vaultBalance).toString() : "unavailable"}`);
  console.log(`  probe USDC        : ${usdcBalance ? asBigInt(usdcBalance).toString() : "unavailable"}`);
  console.log(`  probe allowance   : ${allowance ? asBigInt(allowance).toString() : "unavailable"}`);
  console.log(`  previewDeposit(1 USDC) shares (18 dp): ${preview ? asBigInt(preview).toString() : "unavailable"}`);

  console.log("\nGas estimates from the unfunded probe (SIMULATED; expected to fail):");
  await estimate("approve USDC", {
    from: PROBE,
    to: ASSET,
    data: SELECTOR.approve + addressWord(VAULT) + uintWord(oneUsdc),
  });
  await estimate("deposit 1 USDC", {
    from: PROBE,
    to: VAULT,
    data: SELECTOR.deposit + uintWord(oneUsdc) + addressWord(PROBE),
  });
  await estimate("redeem 0 shares", {
    from: PROBE,
    to: VAULT,
    data: SELECTOR.redeem + uintWord(0) + addressWord(PROBE) + addressWord(PROBE),
  });

  console.log("\nSIMULATED only. Nothing was signed or sent.");
}

main().catch((error) => {
  console.error("SIMULATED run failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
