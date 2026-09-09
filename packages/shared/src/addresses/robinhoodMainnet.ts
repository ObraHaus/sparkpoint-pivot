/**
 * Robinhood Chain MAINNET (chainId 4663) address book — §B fail-closed SCAFFOLD.
 *
 * This is the beta scaffold: 4663 is wired into the shared registry so `getAddresses(4663)` resolves
 * (rather than throwing), but EVERY concrete target is still a placeholder. With the 4663 policy
 * allowlist EMPTY (policy/constants.ts) and every vault/Aave field ZERO/undefined, no agent-mediated
 * `(target, selector)` pair can form — every such action fails allowlisting (fail-closed). The vault
 * is NOT offered on 4663 in the beta (chains/index.ts `offersVault=false`).
 *
 * Real addresses are filled in as they are deployed/verified on-chain, per the beta build order:
 *   • token (Pons launchpad) + broker NFT (OpenSea) + the revenue-engine set (splitter / engine /
 *     vault / sink) + our swap router — recorded in contracts/deployments/4663/ and mirrored here
 *     (feature C);
 *   • the Uniswap-V3 router/quoter/factory + the stable (USDG, 6dp) + WETH — VERIFIED on-chain and
 *     wired for the user-signed swap (feature D3). Until then `usdc`/`weth` are the zero address and
 *     the DEX selector shows "unavailable" (fail-closed).
 *
 * ⚠️ Do NOT fabricate addresses here. A placeholder that resolves to a real-looking-but-wrong address
 * is worse than an unavailable feature — ZERO / undefined is the honest fail-closed state.
 */

import { CHAIN_ID } from "../policy/index";
import type { Address, AddressBook } from "./types";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export const robinhoodMainnet: AddressBook = {
  chainId: CHAIN_ID.robinhoodMainnet,
  network: "robinhoodMainnet",

  // Canonical ERC-4337 EntryPoint v0.7 singleton (same address on every chain). Inert in the beta —
  // no ERC-4337 account is deployed on 4663. Pinned for parity; verify on-chain before any AA use.
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",

  // ── Aave v3 — NOT deployed on Robinhood Chain; zero (never used: empty allowlist + vault Base-only) ──
  aavePool: ZERO,
  aUsdc: ZERO,
  reserveUsdc: ZERO,
  wrappedTokenGateway: undefined,

  // ── Aerodrome — not deployed ──
  aerodromeRouter: undefined,
  aerodromeFactory: undefined,

  // ── Uniswap V3 (user-signed swap) — verify on-chain + wire in D3. Undefined ⇒ DEX shows unavailable. ──
  uniswapV3SwapRouter02: undefined,
  uniswapV3QuoterV2: undefined,
  uniswapV3Factory: undefined,

  // Our own fee-router + its recipient are deployed in C6/D3; unset ⇒ no vault-independent fee yet.
  swapFeeRecipient: undefined,

  // ── ERC-20 tokens — filled in D3 after on-chain verification (USDG, 6dp, is the 4663 stable; WETH
  // predeploy). ZERO placeholders keep the required fields typed while the swap stays fail-closed
  // (undefined DEX above), so nothing reads these until real addresses land. ──
  usdc: ZERO,
  weth: ZERO,
  usdcFaucet: undefined,

  // Pons-launched utility token — address known only after the launch (feature C3). Undefined ⇒ the
  // Premium / token surfaces say "unavailable" honestly.
  srk: undefined,
  // Premium is NOT settled on 4663 in the beta (payment_verifier is single-chain) — leave unset so a
  // tester cannot send a payment nobody can verify (mirrors robinhoodTestnet).
  premiumTreasury: undefined,
  srkFaucet: undefined,

  // Sparky Broker (OpenSea) + the revenue-engine set — deployed in feature C, recorded here then.
  brokerNft: undefined,
  brokerRegistry: undefined,
  brokerSale: undefined,
  brokerRevenueDistributor: undefined,

  feeTreasury: undefined,

  // ── SparkPoint vault stack — Base-only ⇒ undefined here (fail-closed) ──
  sparkPointAccountImpl: undefined,
  accountFactory: undefined,
  sessionKeyValidator: undefined,
  policyModule: undefined,
  vault: undefined,
  capRegistry: undefined,
  killSwitch: undefined,
};
