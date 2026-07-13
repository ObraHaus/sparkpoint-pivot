/**
 * Base Sepolia (chainId 84532) address book.
 *
 * Protocol addresses are the pinned values verified on-chain 2026-07-11 (CTX):
 *   - EntryPoint v0.7: identical singleton to Base mainnet.
 *   - Aave v3 Pool: 0x8bAB…aE27.
 *   - reserveUsdc 0xba50…4D5f: the Aave-market test USDC — the ONLY USDC the
 *     Sepolia pool accepts, and therefore the token the vault's `asset()` must be.
 *   - aUSDC: 0x10F1…0ACC.
 *
 * Divergences from Base mainnet (deliberate):
 *   - `usdc` == `reserveUsdc` (the Aave test USDC). On Base Sepolia the SYSTEM's
 *     USDC is the Aave-reserve token; the canonical Circle Base-Sepolia USDC is
 *     NOT used by any path here (vault deposit → Aave supply is the only flow),
 *     so pinning the Aave-reserve token as `usdc` keeps the deposit path correct.
 *   - Aerodrome has NO Base-Sepolia deployment ⇒ `aerodromeRouter`/`aerodromeFactory`
 *     left `undefined`. Swaps are fork-only; this matches the `undeployed:true`
 *     Aerodrome entry that policy/constants.ts filters out (fail-closed).
 *   - `wrappedTokenGateway` left `undefined` (native-ETH path deferred; TODO_VERIFY).
 */

import { CHAIN_ID } from "../policy/index.js";
import type { AddressBook } from "./types.js";

export const baseSepolia: AddressBook = {
  chainId: CHAIN_ID.baseSepolia,
  network: "baseSepolia",

  // ── ERC-4337 (identical singleton to Base mainnet) ──
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",

  // ── Aave v3 (Base Sepolia market) ──
  aavePool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  aUsdc: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
  reserveUsdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f", // the ONLY USDC the Sepolia pool accepts
  wrappedTokenGateway: undefined, // TODO_VERIFY: native-ETH gateway not pinned on Base Sepolia (deferred)

  // ── Aerodrome — NO Base-Sepolia deployment (undeployed; swaps are fork-only) ──
  aerodromeRouter: undefined,
  aerodromeFactory: undefined,

  // ── ERC-20 tokens ──
  usdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f", // == reserveUsdc: system USDC on Sepolia is the Aave test token
  weth: "0x4200000000000000000000000000000000000006", // OP-stack WETH predeploy (same on Base Sepolia)

  // ── SparkPoint contracts — filled by deploy (undefined ⇒ fail-closed) ──
  sparkPointAccountImpl: undefined,
  accountFactory: undefined,
  sessionKeyValidator: undefined,
  policyModule: undefined,
  vault: undefined,
  capRegistry: undefined,
  killSwitch: undefined,
};
