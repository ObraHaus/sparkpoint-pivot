/**
 * Robinhood Chain Testnet (chainId 46630) address book — §B3 + manual swap (§B-swap).
 *
 * The SparkPoint vault is BASE-ONLY. There is NO official Aave deployment here, so every AAVE/VAULT
 * policy target stays the ZERO address and `vault` is `undefined`: with the 46630 allowlist EMPTY
 * (policy/constants.ts) no agent-mediated vault/swap action can form a `(target, selector)` pair —
 * every such action fails allowlisting (fail-closed). We also never target the unofficial, resettable
 * "stock market" pilot pools on this chain.
 *
 * What IS live here (verified on-chain 2026-07-17): the MANUAL, user-signed swap. Synthra V3 — a
 * Uniswap-V3 fork with the ABI-identical SwapRouter02 (`exactInputSingle` + `multicall`) and QuoterV2
 * — has a deep WETH/USDC 0.3% pool; real WETH→USDC swaps executed (both the ERC-20 and native-ETH
 * multicall paths). The swap page is non-custodial and is NOT a policy target, so wiring real
 * usdc/weth/uniswap addresses here enables it WITHOUT touching the fail-closed vault/agent path.
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

  // ── Synthra V3 (Uniswap-V3 fork; ABI-identical SwapRouter02 + QuoterV2) — verified on-chain
  // 2026-07-17 (eth_getCode non-empty; live WETH/USDC 0.3% pool 0x9640…Fa4A with deep liquidity;
  // real swaps executed). Powers ONLY the manual, user-signed swap page (non-custodial; NOT a policy
  // target) — the vault/agent path stays Base-only + fail-closed (empty 46630 allowlist above). ──
  uniswapV3SwapRouter02: "0x3Ce954107b1A675826B33bF23060Dd655e3758fE",
  uniswapV3QuoterV2: "0x231606c321A99DE81e28fE48B07a93F1ba49e713",
  uniswapV3Factory: "0x911b4000D3422F482F4062a913885f7b035382Df",

  // §fee (007) — routing-fee treasury. Robinhood has NO vault, so there is no vault `feeRecipient()` to
  // fall back to; without this the swap would be fee-free here. Set to the SparkPoint deployer EOA — the
  // SAME address the Base Sepolia vault's `feeRecipient()` resolves to (0xA71e…5c30, verified on-chain) —
  // so the 0.20% routing fee is collected on 46630 too. Synthra exposes `sweepTokenWithFee` +
  // `unwrapWETH9WithFee` + `exactInput`/`quoteExactInput` (verified on-chain 2026-07-20), so the fee is
  // taken IN the user-signed swap exactly like Base. EOAs are chain-agnostic (same key, same address).
  swapFeeRecipient: "0xA71e24359A6cb7A939aae2d62dD12b6256365c30",

  // ── ERC-20 tokens — Robinhood-testnet WETH + USDC (the Synthra WETH/USDC pool pair). NOTE: this
  // testnet's "USDC" is 18-decimals (not 6) — swapTokens() pins USDC decimals per-chain. ──
  usdc: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
  weth: "0x33e4191705c386532ba27cBF171Db86919200B94",
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
