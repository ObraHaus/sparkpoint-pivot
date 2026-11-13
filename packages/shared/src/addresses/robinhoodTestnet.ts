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

  // §fee (007/014) — routing-fee treasury. Robinhood has NO vault, so there is no vault `feeRecipient()`
  // to follow; this is a hard constant (moving it is an address-book edit + a web redeploy, no Timelock).
  // Feature 014: re-pointed from the deployer EOA to the **2-of-3 fee-treasury Safe**, deployed at the
  // SAME address on 46630 as on Base Sepolia (`0xCB13…578f`; canonical Safe v1.4.1 factory/singleton are
  // present on 46630, so replaying the identical `createProxyWithNonce` gives the identical CREATE2
  // address — one treasury address across every network). Synthra exposes `sweepTokenWithFee` +
  // `unwrapWETH9WithFee`, so the 0.20% fee is taken IN the user-signed swap and swept to the Safe.
  swapFeeRecipient: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",

  // The fee-treasury Safe (address of record) — same 2-of-3 Safe as Base Sepolia, same address (N5:
  // a plain recipient with nil power over user funds). Mirrors `baseSepolia.ts` `feeTreasury`.
  feeTreasury: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",

  // ── ERC-20 tokens — Robinhood-testnet WETH + USDC (the Synthra WETH/USDC pool pair). NOTE: this
  // testnet's "USDC" is 18-decimals (not 6) — swapTokens() pins USDC decimals per-chain. ──
  usdc: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
  weth: "0x33e4191705c386532ba27cBF171Db86919200B94",
  usdcFaucet: undefined,

  // ── SRK + its faucet (043 phase 1) — deployed 2026-08-13 via script/DeploySRK.s.sol and
  // script/DeploySrkFaucet.s.sol, the SAME recipe used on Base Sepolia, pointed at this chain.
  //
  // WHY SRK EXISTS HERE AT ALL: the Sparky Broker NFT lives on Robinhood Chain, and activating a
  // broker retires SRK. A burn on one chain cannot flip state on another in the same transaction, so
  // the SRK a broker retires has to live on the broker's chain or activation can never be atomic.
  // This deployment is that rehearsal on testnet.
  //
  // ⚠️ THIS IS A SEPARATE TOKEN FROM THE BASE-SEPOLIA SRK at 0x2dF9…eD52. Same contract, same fixed
  // 1e9 supply, different chain — the two balances are unrelated and must never be summed. Neither
  // is the CoinMarketCap-listed mainnet SparkPoint token.
  // The faucet holds a hand-transferred 10,000,000 SRK float and pays 5,000 SRK per address per 24h
  // — identical parameters to Base Sepolia. Owner = deployer; parameter admins = deployer + the
  // client demo wallet 0x32Ed…e8b5. A real user-signed claim + the cooldown revert were both proven
  // on-chain at deploy time.
  //   SRK   deploy tx 0xd43899516ff772d868e9448da8700f80d8b42fd1f81c3fe270f76ebcb49acd35
  //   faucet deploy tx 0x48bf8afdc62740d2962ccb0dff0688810ac5ff3e9e60c6ebc96ab7ef34e1231c
  //   faucet fund   tx 0xaee0169745e779c91e15e65115ae5e8c1e093c626d404a20f5c8eb58372f1f4c
  srk: "0x4538B536b1da5940deC8e15048Ce07a053699B04",
  srkFaucet: "0x39C38c86611FF3679802D5341E830c83DB7F4537",

  // ⚠️⚠️ `premiumTreasury` IS DELIBERATELY UNSET — do not fill it in because `feeTreasury` above is
  // set and the Safe happens to exist here too. Premium is bought by transferring SRK and is then
  // credited by `services/agent/.../chain/payment_verifier.py`, which is built with ONE `srk_address`
  // and ONE RPC (`SRK_ADDRESS_84532`) — it can only ever see Base Sepolia. `/premium/pay` reads the
  // address book for the CONNECTED chain and enables the buy on `srk && premiumTreasury`, so a
  // `premiumTreasury` here would let a tester send real SRK on 46630 into a payment nobody can
  // verify: money out, no Premium, no repair path. Leaving it undefined is what fails that closed.
  // A guard test asserts this (`addresses.premium-parity.test.ts`).

  // ── Sparky Broker (043) — the membership NFT and its two roles. Deployed 2026-08-13/14.
  //
  // A broker is NOT a vault or a yield position: it affects the Premium tier and nothing else, so
  // none of this changes `offersVault(46630) === false` or the fail-closed vault path below.
  //
  //   brokerNft      the collection (10,000 cap, ids from 1). Metadata is served by its OWN deploy
  //                  at <internal-host> — never from apps/web, whose middleware would
  //                  silently 307 a marketplace crawler to a holding page.
  //   brokerRegistry the `activator`: retires SRK and activates, atomically, user-signed.
  //   brokerSale     the `minter`: free and open, per-wallet cap 5.
  //
  // ⚠️ `brokerRegistry` names only the CURRENT registry, for the app's write path. The AGENT must
  // read every registry ever wired (`BROKER_REGISTRY_ADDRESS`, comma-separated) because re-pointing
  // `setActivator` orphans the previous one's record with no on-chain recovery — a holder who paid
  // would silently stop qualifying for Premium.
  //
  // Superseded, and STILL IN THE AGENT'S LIST — never remove one:
  //   0xD95067667E5ff2B1e898AF83063e8D2ca7D8D775  (flat 10,000 SRK; replaced by tiers in 043c)
  //   0x5370d06bFA9049234C471e0877e249D9322728FF  (pre-dedup)
  brokerNft: "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2",
  brokerRegistry: "0xf081167b1DF61BAe096338b5716369894447a88E",
  brokerSale: "0x488268134af3d01E0672A9Ea17d529D4C5E275Dd",
  brokerRevenueDistributor: "0x7f377fe96DaD2eEa494F0fb095233EF4aB438420",

  // ── SparkPoint contracts — vault is Base-only ⇒ undefined here (fail-closed) ──
  sparkPointAccountImpl: undefined,
  accountFactory: undefined,
  sessionKeyValidator: undefined,
  policyModule: undefined,
  vault: undefined,
  capRegistry: undefined,
  killSwitch: undefined,
};
