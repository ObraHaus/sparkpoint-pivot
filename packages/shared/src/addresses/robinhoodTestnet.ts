/**
 * Robinhood Chain Testnet (chainId 46630) address book — §B3.
 *
 * The SparkPoint vault is BASE-ONLY, and this chain has NO official Aave/USDC deployment (only an
 * unofficial, resettable "stock market" pilot we must NEVER target). So every policy target here is
 * the ZERO address (a non-target) and `vault` is `undefined`: with the 46630 allowlist EMPTY
 * (policy/constants.ts) no action can form a `(target, selector)` pair, so every vault/swap action
 * fails allowlisting (fail-closed). This book exists only so the registry honors the same
 * supported-chain contract as the policy layer; 46630 is chat + read-only (native-balance) portfolio.
 *
 * The EntryPoint v0.7 singleton IS deployed on Robinhood testnet (verified) — pinned for parity with
 * the other chains, though no ERC-4337 account is deployed here in this build.
 */

import { CHAIN_ID } from "../policy/index";
import type { Address, AddressBook } from "./types";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export const robinhoodTestnet: AddressBook = {
  chainId: CHAIN_ID.robinhoodTestnet,
  network: "robinhoodTestnet",

  // ── ERC-4337 (canonical EntryPoint v0.7 singleton, verified on Robinhood testnet) ──
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",

  // ── Aave v3 — NO official deployment; zero (never used: empty allowlist + vault Base-only) ──
  aavePool: ZERO,
  aUsdc: ZERO,
  reserveUsdc: ZERO,
  wrappedTokenGateway: undefined,

  // ── Aerodrome — not deployed ──
  aerodromeRouter: undefined,
  aerodromeFactory: undefined,

  // ── ERC-20 tokens — no official USDC/WETH on Robinhood testnet (zero = non-target) ──
  usdc: ZERO,
  weth: ZERO,
  usdcFaucet: undefined,

  // ── SparkPoint contracts — vault is Base-only ⇒ undefined here (fail-closed) ──
  sparkPointAccountImpl: undefined,
  accountFactory: undefined,
  sessionKeyValidator: undefined,
  policyModule: undefined,
  vault: undefined,
  capRegistry: undefined,
  killSwitch: undefined,
};
