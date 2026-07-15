// ITEM 3 / T098 — TS source-of-truth extractor for the policy-parity gate.
//
// Prints, as a single JSON line, the drift-critical policy values that
// packages/shared/src/policy/constants.ts (getPolicyConstants) +
// packages/shared/src/addresses (getAddresses) resolve for a given chainId.
// The parity check asserts these equal the LIVE on-chain reads AND the
// services/agent Python policy constants (see policy_parity_compare.py).
//
// Usage:  node policy_parity_ts_dump.mjs <abs/path/to/packages/shared/dist> <chainId>
//
// We import the tsc-built `dist/` (not the .ts source) so no TS runtime is
// needed. `dist` is emitted with "Bundler" module resolution, so its relative
// imports are extension-less (e.g. `./enums`); Node ESM requires a real file, so
// a tiny in-process resolve hook appends `.js` (then `/index.js`) as a fallback.
// The hook is registered from a data: URL to keep this a single committed file.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const RESOLVE_HOOK = `
export async function resolve(specifier, context, nextResolve) {
  if (/^\\.{1,2}\\//.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err && err.code === "ERR_MODULE_NOT_FOUND") {
        try {
          return await nextResolve(specifier + ".js", context);
        } catch {
          return await nextResolve(specifier + "/index.js", context);
        }
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
`;
register("data:text/javascript," + encodeURIComponent(RESOLVE_HOOK));

const distDir = process.argv[2];
const chainId = Number(process.argv[3]);
if (!distDir || !Number.isInteger(chainId)) {
  console.error("usage: node policy_parity_ts_dump.mjs <shared/dist dir> <chainId>");
  process.exit(2);
}

const policyUrl = pathToFileURL(`${distDir}/policy/index.js`).href;
const addressesUrl = pathToFileURL(`${distDir}/addresses/index.js`).href;
const { getPolicyConstants } = await import(policyUrl);
const { getAddresses } = await import(addressesUrl);

const pc = getPolicyConstants(chainId);
const book = getAddresses(chainId);
const usdc = book.usdc;
if (typeof usdc !== "string" || usdc.length === 0) {
  // fail-closed: the vault's asset() must have a concrete address to compare.
  console.error(`policy_parity_ts_dump: no usdc address for chainId ${chainId}`);
  process.exit(2);
}

// All numerics as strings — the on-chain caps are up to 1e12+ and are compared
// as exact integers on the Python side (never as JS/JSON floats).
process.stdout.write(
  JSON.stringify({
    chainId,
    performanceFeeBps: String(pc.governance.performanceFee.defaultBps),
    maxPerformanceFeeBps: String(pc.governance.performanceFee.ceilingBps),
    perUserCap: pc.caps.perUserTvl.amount.toString(),
    totalCap: pc.caps.totalProtocol.amount.toString(),
    vaultCap: pc.caps.vaultDeposit.amount.toString(),
    asset: usdc.toLowerCase(),
  }) + "\n",
);
