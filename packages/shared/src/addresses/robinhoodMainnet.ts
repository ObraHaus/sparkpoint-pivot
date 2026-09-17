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

  // ── Uniswap V3 (user-signed swap) — VERIFIED on-chain on 4663 (eth_getCode non-empty, 2026-09-10)
  // and cross-checked against robin-brokers/docs/ADDRESSES.md (all verified on Blockscout). Canonical
  // v3 factory; SwapRouter02 + QuoterV2 present with a live WETH/USDG pool (fee tier 100). Powers the
  // manual, user-signed swap page ONLY — non-custodial, NOT a policy target — so wiring these does
  // NOT touch the fail-closed agent path (the 4663 policy allowlist stays empty). ──
  uniswapV3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  uniswapV3QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",

  // Phase-1 beta swap is FEE-FREE. The interim `sweepWithFee` hook is verified ABSENT on the deployed
  // SwapRouter02, so the Phase-2 fee path is the custom `feeRouter` below (W.7) — NOT this field.
  swapFeeRecipient: undefined,

  // W.7 fee-router (specs/047-beta-fee-router): undefined until the beta deploy lands
  // (`DeployFeeRouter.s.sol` — the proxy address gets recorded in contracts/deployments/4663 and
  // mirrored here). While undefined the swap page keeps the fee-free direct-SwapRouter02 path; once
  // wired, the page routes through the router and discloses the fee + its splitter destination.
  feeRouter: undefined,

  // ── ERC-20 tokens — VERIFIED on 4663 (2026-09-10). USDG is the 4663 stable and is 6 DECIMALS (NOT
  // 18) — tokens.ts pins USDG decimals per-chain. WETH is the 4663 predeploy. The `usdc` field is the
  // generic stablecoin slot (named for Base); on 4663 it holds USDG. ──
  usdc: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG, 6 dp
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdcFaucet: undefined,

  // Pons-launched utility token — address known only after the launch (feature C3). Undefined ⇒ the
  // Premium / token surfaces say "unavailable" honestly.
  srk: undefined,
  // Premium is NOT settled on 4663 in the beta (payment_verifier is single-chain) — leave unset so a
  // tester cannot send a payment nobody can verify (mirrors robinhoodTestnet).
  premiumTreasury: undefined,
  srkFaucet: undefined,

  // ── §beta-revenue (Phase 2) — DEPLOYED and verified on 4663, 2026-09-16. These are the beta
  // set; alpha (Base Sepolia) never reads them. Mirrors contracts/deployments/4663/addresses.json.
  // The legacy broker fields above stay undefined on purpose: the pre-pivot registry/sale/
  // distributor are NOT deployed here, and the app must not treat them as live. ──
  utilityToken: "0x790316a2a1B403b55c6E8a6857Dd768078503553", // Sparky - Test (SPARKYTEST), OZ ERC20Burnable
  brokerEngine: "0x08a578D2Fa194E24786f5644AFabC578f2daDB43", // PROXY — wire THIS
  brokerVault: "0x4B0b09086Bd1D3c3D6eF94BC59D36ba8e37B8455",
  revenueSplitter: "0xD4dD7E2CAfBcC40f25d2D5Fb975B8E6E033609C1", // immutable; the Pons creatorFeeRecipient
  royaltySink: "0x0009a0fEf5a5371B05727e257FF9500EeF0a7d66",
  revenueTreasury: "0x376293DDb027555aB7F483c00e1D61b2a7757dE8", // the splitter's immutable 10% destination
  ponsCurve: "0xbE38eE16810d2ac0a9AA944fdDd68b07a5E17C53",
  ponsFeeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",

  // Sparky Broker - Test (SPKBTest, supply 5,555) — deployed on 4663 2026-09-16 and wired here for
  // the beta broker surfaces (W.3). The legacy pre-pivot fields below stay undefined: the
  // registry/sale/distributor are NOT deployed on 4663 and the app must not treat them as live.
  brokerNft: "0x706b4b449d9b007b7fbd29866122e758d9903d3f",
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
