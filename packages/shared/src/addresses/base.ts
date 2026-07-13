/**
 * Base mainnet (chainId 8453) address book.
 *
 * All protocol/token addresses below were verified for CODE PRESENCE + identity
 * on a Base-mainnet fork (sim-fork RPC, 2026-07-13):
 *   - EntryPoint v0.7, USDC, WETH, Aave v3 Pool, Aerodrome Router: code present.
 *   - aUSDC 0x4e65…c0AB: `symbol()` == "aBasUSDC", `UNDERLYING_ASSET_ADDRESS()` == USDC.
 *   - Aerodrome factory 0x420D…40Da: equals Router.`defaultFactory()`.
 *   - WrappedTokenGatewayV3 0x8be4…2E74: `getWETHAddress()` == WETH.
 *
 * The SparkPoint contracts (account impl, factory, validator, policy module,
 * vault, cap registry, kill switch) are deploy-time-determined and are filled by
 * the deploy/arm scripts — left `undefined` here (fail-closed).
 */

import { CHAIN_ID } from "../policy/index";
import type { AddressBook } from "./types";

export const base: AddressBook = {
  chainId: CHAIN_ID.base,
  network: "base",

  // ── ERC-4337 (identical singleton on Base mainnet + Base Sepolia) ──
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",

  // ── Aave v3 (Base market) ──
  aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  aUsdc: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", // aBasUSDC — underlying == USDC (verified)
  reserveUsdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // == usdc on Base mainnet
  wrappedTokenGateway: "0x8be473dCfA93132658821E67CbEB684ec8Ea2E74", // getWETHAddress() == WETH (verified)

  // ── Aerodrome ──
  aerodromeRouter: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  aerodromeFactory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // == Router.defaultFactory() (verified)

  // ── ERC-20 tokens ──
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // native Circle USDC on Base
  weth: "0x4200000000000000000000000000000000000006", // OP-stack WETH predeploy

  // ── SparkPoint contracts — filled by deploy (undefined ⇒ fail-closed) ──
  sparkPointAccountImpl: undefined,
  accountFactory: undefined,
  sessionKeyValidator: undefined,
  policyModule: undefined,
  vault: undefined,
  capRegistry: undefined,
  killSwitch: undefined,
};
