/**
 * Chains, addresses and the guards that keep this tool on the testnets.
 *
 * ⚠️ The allowlist below is the whole safety model, and it is a POSITIVE list on purpose. A
 * blocklist of mainnet chain ids would be one forgotten entry away from signing a real
 * transaction with a funded key; a positive list fails closed on anything it has not been told
 * about. Same reasoning as the simulation stack's RPC allowlist.
 */

import { defineChain, type Address } from "viem";
import { baseSepolia } from "viem/chains";

/** The ONLY chains this tool will ever sign for. */
export const ALLOWED_CHAIN_IDS = [84532, 46630] as const;
export type AllowedChainId = (typeof ALLOWED_CHAIN_IDS)[number];

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
});

export interface ChainConfig {
  readonly id: AllowedChainId;
  readonly label: string;
  readonly chain: typeof baseSepolia | typeof robinhoodTestnet;
  readonly rpcEnv: string;
  readonly rpcFallback: string;
  readonly weth: Address;
  readonly usdc: Address;
  /** 6 on Base Sepolia, 18 on Robinhood — the trap that makes a hardcoded 6 silently wrong. */
  readonly usdcDecimals: number;
  readonly swapRouter02: Address;
  readonly quoterV2: Address;
  /** Where the 0.20% routing fee is sent. Must match what the app uses or the row is not "ours". */
  readonly feeRecipient: Address;
  /** The Aave-market test-USDC faucet: `mint(token, to, amount)`. Absent on Robinhood. */
  readonly usdcFaucet?: Address;
  /** The SparkPoint vault. Absent on Robinhood by design (offersVault=false). */
  readonly vault?: Address;
  /**
   * The ONE pool fee tier the bots may trade, or `undefined` to refuse swapping entirely.
   *
   * ⚠️ Pinned rather than quote-shopped, and that is the whole point. Both testnets carry large
   * cross-tier price dislocations — Base Sepolia quotes ~3,104 USDC/ETH at tier 500 against
   * ~1,381 at tier 3000; Robinhood ~185 against ~58. A bot that takes the best quote per
   * direction therefore buys in one pool and sells in the other, and a "round trip" comes back
   * +172% instead of −1%. That is an arbitrage bot: it drains the thin side of the pair, moves
   * the price a real tester is quoted, and produces a trading pattern nothing like a user's.
   *
   * Pinned to one deep pool, the same round trip costs a flat 0.996% at every size — 0.3%x2 to
   * the pool and 0.2%x2 to us — which is the honest number.
   */
  readonly swapPoolFee?: number;
  /** Reserves of the pinned pool are read live; a trade above this share of them is refused. */
  readonly maxPoolShareBps?: number;
  readonly uniswapV3Factory?: Address;
}

export const CHAINS: Record<AllowedChainId, ChainConfig> = {
  84532: {
    id: 84532,
    label: "Base Sepolia",
    chain: baseSepolia,
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    rpcFallback: "https://sepolia.base.org",
    weth: "0x4200000000000000000000000000000000000006",
    // ⚠️ TWO USDCs exist here. This is the Aave-market test token — the only one the pool and
    // the launch vault accept. Circle's 0x036CbD53… also reports symbol()=="USDC" at 6dp and is
    // NOT interchangeable.
    usdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
    usdcDecimals: 6,
    swapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
    quoterV2: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
    feeRecipient: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",
    usdcFaucet: "0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc",
    vault: "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2",
    // ⚠️ NO SWAPPING HERE. Measured 2026-08-18: the WETH/USDC pools hold 0.0338 WETH (tier 500)
    // and 0.1805 WETH (tier 3000) — the tier-500 pool is SMALLER THAN THE FUNDER'S OWN BALANCE.
    // Any bot volume worth generating would visibly move the price a real tester is quoted on
    // /swap, and could drain the pool outright. This chain gets the vault leg, which touches no
    // pool at all; swaps go to Robinhood, where the tier-3000 pool holds 2,311 WETH.
    swapPoolFee: undefined,
    uniswapV3Factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
  },
  46630: {
    id: 46630,
    label: "Robinhood Testnet",
    chain: robinhoodTestnet,
    rpcEnv: "ROBINHOOD_TESTNET_RPC_URL",
    rpcFallback: "https://rpc.testnet.chain.robinhood.com",
    weth: "0x33e4191705c386532ba27cBF171Db86919200B94",
    usdc: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
    usdcDecimals: 18, // ⚠️ NOT 6. Synthra's USDC on this chain is 18dp.
    swapRouter02: "0x3Ce954107b1A675826B33bF23060Dd655e3758fE",
    quoterV2: "0x231606c321A99DE81e28fE48B07a93F1ba49e713",
    feeRecipient: "0xCB135893C84876aab9E10792b56e5bEa91dc578f",
    // No faucet and no vault here: this chain carries the broker/SRK half, not the yield half.
    // Tier 3000 measured at 2,311 WETH / 133,361 USDC — deep enough that a 0.02 ETH trade moves
    // it immeasurably (round-trip cost is a flat 0.996% from 0.0002 to 0.02 ETH).
    swapPoolFee: 3000,
    maxPoolShareBps: 50, // 0.50% of reserves — well below anything that would move the quote
    uniswapV3Factory: "0x911b4000D3422F482F4062a913885f7b035382Df",
  },
};

/** The SparkPoint routing fee, in bips. Mirrors `apps/web/src/lib/swap/math.ts`. */
export const ROUTING_FEE_BIPS = 20n;

/** Uniswap's `ADDRESS_THIS` sentinel — keeps swap output in the router for the fee leg. */
export const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";

/** Pool fee tiers to quote across, same set the app tries. */
export const FEE_TIERS = [500, 3000, 10000] as const;

/**
 * Refuse to act on anything that is not a sanctioned testnet.
 *
 * Called after reading `eth_chainId` from the LIVE connection — never from config alone. A config
 * file can say 84532 while the RPC URL points somewhere else entirely, and the whole point of the
 * check is to catch exactly that mismatch.
 */
export function assertTestnet(liveChainId: number, configured: number): asserts liveChainId is AllowedChainId {
  if (!(ALLOWED_CHAIN_IDS as readonly number[]).includes(liveChainId)) {
    throw new Error(
      `refusing to act on chain ${liveChainId}: not in the testnet allowlist ` +
        `(${ALLOWED_CHAIN_IDS.join(", ")}). Check the RPC URL.`,
    );
  }
  if (liveChainId !== configured) {
    throw new Error(
      `chain mismatch: the RPC reports ${liveChainId} but ${configured} was requested. ` +
        `The RPC URL points at a different chain than the addresses being used.`,
    );
  }
}

export function chainConfig(id: number): ChainConfig {
  const cfg = CHAINS[id as AllowedChainId];
  if (!cfg) throw new Error(`unsupported chain ${id}; expected one of ${ALLOWED_CHAIN_IDS.join(", ")}`);
  return cfg;
}
