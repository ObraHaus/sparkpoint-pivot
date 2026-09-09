"use client";

/**
 * useSwapConfirm — the resolver "brain" that BOTH `/swap` and the in-chat inline swap card use to build a
 * `SwapExec` from one place (the swap analog of `useVaultConfirm`).
 *
 * Feature 007 made it TOKEN-GENERIC: callers pass explicit `tokenIn`/`tokenOut` (any resolved
 * `SwapToken`, incl. a pasted custom ERC-20). The legacy `ethToUsdc` boolean is still accepted and maps
 * onto the chain's two recommended tokens, so the chat card (still ETH↔USDC until chat parity lands)
 * keeps working unchanged. Given the pair + amount + slippage it reads addresses/tokens/vault/balances/
 * allowance on-chain (direct-RPC + wagmi), fetches a live QuoterV2 quote, computes net/min/fee/needs-
 * approve, and assembles the fully-resolved `SwapExec` — or `undefined` until every input is ready
 * (fail-closed; never a fabricated number). It does NOT sign. Non-custody: recipient is always the
 * connecting account and the 0.20% routing fee is split on-chain to the vault's `feeRecipient`.
 *
 * The fee gate is SYNCHRONOUS (`feeActive = !!vault`) and `exec` is separately blocked until the (async)
 * recipient resolves — so a still-loading recipient can never degrade to a fee-free swap.
 */

import { useMemo } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { wagmiConfig } from "@/lib/wagmi";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { dexById, dexDisplayLabel, dexLiveOn } from "@/lib/swap/dex";
import { swapTokens, isConfiguredToken, type SwapToken } from "@/lib/swap/tokens";
import { useSwapQuote, type SwapQuoteResult } from "@/lib/swap/useSwapQuote";
import { type SwapExec } from "@/lib/swap/useExecuteSwapTx";
import {
  afterFee,
  amountOutMinimum,
  DEFAULT_DEADLINE_SECONDS,
  HIGH_IMPACT_BPS,
  ROUTING_FEE_BIPS,
} from "@/lib/swap/math";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];
const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Parse a decimal amount string to base units; empty/invalid ⇒ 0n (fail-closed, never throws). */
function parseSafe(s: string, decimals: number): bigint {
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return 0n;
  try {
    return parseUnits(cleaned, decimals);
  } catch {
    return 0n;
  }
}

const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface SwapConfirmParams {
  /** Explicit pay token (any resolved `SwapToken`, incl. a pasted custom ERC-20). */
  tokenIn?: SwapToken;
  /** Explicit receive token. */
  tokenOut?: SwapToken;
  /** Legacy direction over the chain's two recommended tokens — used when tokenIn/tokenOut are omitted. */
  ethToUsdc?: boolean;
  /** input amount as a decimal string in `tokenIn` units — parsed with the LIVE token decimals. */
  amount: string;
  slippageBps: number;
}

export interface SwapConfirmResult {
  activeChain: number | undefined;
  netLabel: string;
  uniswapVenue: string;
  dexLive: boolean;
  tokenIn?: SwapToken;
  tokenOut?: SwapToken;
  pairReady: boolean;
  amountIn: bigint;
  balanceIn?: bigint;
  quote: SwapQuoteResult;
  grossOut?: bigint;
  netOut?: bigint;
  netMinOut?: bigint;
  /** routing-fee amount in `tokenOut` base units (grossOut − netOut). */
  feeAmount?: bigint;
  needsApprove: boolean;
  insufficient: boolean;
  highImpact: boolean;
  feeActive: boolean;
  feeRecipient?: Address;
  /** a fee chain whose recipient hasn't resolved yet — must not execute until it does. */
  feeRecipientPending: boolean;
  canQuote: boolean;
  /** fully-resolved intent (undefined until quote + recipient + amount all ready). */
  exec?: SwapExec;
}

export function useSwapConfirm(params: SwapConfirmParams): SwapConfirmResult {
  const { tokenIn: explicitIn, tokenOut: explicitOut, ethToUsdc = true, amount, slippageBps } = params;
  const { address, isConnected, chainId } = useAccount();
  const activeChain = isConnected ? chainId : DISPLAY_CHAIN_ID;

  const dex = dexById("uniswap_v3");
  const dexLive = dexLiveOn(dex, activeChain);
  const netLabel = activeChain === 46630 ? "Robinhood Testnet" : activeChain === 8453 ? "Base" : "Base Sepolia";
  const uniswapVenue = dexDisplayLabel(dex, activeChain);

  const { router: routerAddr, quoter, vault, weth, usdc, swapFeeRecipient } = useMemo(() => {
    try {
      const b = getAddresses(activeChain ?? DISPLAY_CHAIN_ID);
      // A configured routing-fee treasury, ignoring an unset/zero value (never activate a fee to 0x0).
      const treasury = b.swapFeeRecipient && b.swapFeeRecipient.toLowerCase() !== ZERO_ADDR ? b.swapFeeRecipient : undefined;
      return {
        router: b.uniswapV3SwapRouter02,
        quoter: b.uniswapV3QuoterV2,
        vault: b.vault,
        weth: b.weth,
        usdc: b.usdc,
        swapFeeRecipient: treasury,
      };
    } catch {
      return { router: undefined, quoter: undefined, vault: undefined, weth: undefined, usdc: undefined, swapFeeRecipient: undefined };
    }
  }, [activeChain]);

  // Resolve the pair: explicit tokens win; otherwise the legacy boolean over the chain's recommended set.
  const { tokenIn, tokenOut } = useMemo(() => {
    const rec = swapTokens(activeChain);
    const recEth = rec.find((t) => t.isNative);
    const recUsdc = rec.find((t) => !t.isNative);
    return {
      tokenIn: explicitIn ?? (ethToUsdc ? recEth : recUsdc),
      tokenOut: explicitOut ?? (ethToUsdc ? recUsdc : recEth),
    };
  }, [explicitIn, explicitOut, ethToUsdc, activeChain]);

  const pairReady =
    !!tokenIn &&
    !!tokenOut &&
    isConfiguredToken(tokenIn) &&
    isConfiguredToken(tokenOut) &&
    !eqAddr(tokenIn.address, tokenOut.address);
  const amountIn = tokenIn ? parseSafe(amount, tokenIn.decimals) : 0n;

  // §fee (007) — the 0.20% routing-fee recipient: a configured per-chain treasury (`swapFeeRecipient`)
  // wins SYNCHRONOUSLY, so a chain with NO vault (e.g. Robinhood 46630) still charges the fee. Where unset,
  // fall back to the vault's live `feeRecipient()` (kept auditable on vault chains). The vault read is
  // disabled when a treasury is configured (no async read needed there).
  const feeRecipientRead = useReadContract({
    address: vault,
    abi: sparkPointVaultAbi,
    functionName: "feeRecipient",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!vault && !swapFeeRecipient },
  });
  const vaultFeeRecipient = feeRecipientRead.data as Address | undefined;
  const feeRecipient = swapFeeRecipient ?? vaultFeeRecipient;
  // `feeExpected` is SYNCHRONOUS (never derived from the async recipient value), so a still-loading vault
  // recipient BLOCKS the swap below rather than silently degrading it to a fee-free swap.
  const feeExpected = !!swapFeeRecipient || !!vault;
  const feeReady = !!feeRecipient; // already normalized to a non-zero address
  const feeActive = feeExpected;

  // Balances/allowance — generic over any tokenIn: native ETH via useBalance, else the ERC-20 balanceOf.
  const nonNativeIn = !!tokenIn && !tokenIn.isNative && isConfiguredToken(tokenIn);
  const ethBal = useBalance({
    address,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address },
  });
  const tokenInBal = useReadContract({
    address: nonNativeIn ? tokenIn!.address : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && nonNativeIn },
  });
  const allowanceRead = useReadContract({
    address: nonNativeIn ? tokenIn!.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerAddr ? [address, routerAddr] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && nonNativeIn && !!routerAddr },
  });
  const balanceIn = tokenIn?.isNative ? ethBal.data?.value : (tokenInBal.data as bigint | undefined);
  const allowance = allowanceRead.data as bigint | undefined;

  // USDC is a real routing (hop) asset on Base mainnet + Robinhood, but NOT on Base Sepolia / local fork
  // where "USDC" is the Aave test token with no pools beyond WETH — skip the USDC hop there.
  const usdcIsRoutingAsset = activeChain !== 84532 && activeChain !== 31337;
  const canQuote = dexLive && pairReady && amountIn > 0n && !!quoter && !!weth && isConnected;
  const quote = useSwapQuote({
    chainId: activeChain,
    quoter,
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    amountIn,
    weth,
    usdc,
    usdcIsRoutingAsset,
    enabled: canQuote,
  });

  const grossOut = quote.amountOut;
  const netOut =
    grossOut !== undefined ? (feeActive ? afterFee(grossOut, ROUTING_FEE_BIPS) : grossOut) : undefined;
  const minOut = grossOut !== undefined ? amountOutMinimum(grossOut, slippageBps) : undefined; // gross floor
  const netMinOut =
    minOut !== undefined ? (feeActive ? afterFee(minOut, ROUTING_FEE_BIPS) : minOut) : undefined;
  const feeAmount = grossOut !== undefined && netOut !== undefined ? grossOut - netOut : undefined;
  const needsApprove = nonNativeIn && amountIn > 0n && (allowance === undefined || allowance < amountIn);
  // USDT-style tokens revert on a non-zero→non-zero approve; reset to zero first when re-approving.
  const needsApproveReset = nonNativeIn && allowance !== undefined && allowance > 0n && allowance < amountIn;
  const insufficient = balanceIn !== undefined && amountIn > balanceIn;
  const highImpact = (quote.priceImpactBps ?? 0) >= HIGH_IMPACT_BPS;

  const exec: SwapExec | undefined = useMemo(() => {
    if (!routerAddr || !tokenIn || !tokenOut || !address || activeChain === undefined) return undefined;
    if (feeExpected && !feeReady) return undefined; // fee chains need the recipient before executing (never fee-free)
    const route = quote.route;
    if (route === undefined || minOut === undefined || amountIn <= 0n) return undefined;
    return {
      chainId: activeChain,
      router: routerAddr,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      // single-hop uses `fee`; multi-hop uses the packed `path` (fee is then unused).
      fee: route.kind === "single" ? route.fee : 0,
      path: route.kind === "multi" ? route.path : undefined,
      account: address,
      amountIn,
      amountOutMinimum: minOut,
      deadlineSeconds: DEFAULT_DEADLINE_SECONDS,
      fromNative: tokenIn.isNative,
      toNative: tokenOut.isNative,
      needsApprove,
      approveResetToZero: needsApproveReset,
      feeBips: feeActive ? ROUTING_FEE_BIPS : 0,
      feeRecipient: feeActive ? feeRecipient : undefined,
      onDone: () => {
        void ethBal.refetch();
        void tokenInBal.refetch();
        void allowanceRead.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerAddr, tokenIn, tokenOut, address, activeChain, feeActive, feeRecipient, quote.route, minOut, amountIn, needsApprove, needsApproveReset]);

  return {
    activeChain,
    netLabel,
    uniswapVenue,
    dexLive,
    tokenIn,
    tokenOut,
    pairReady,
    amountIn,
    balanceIn,
    quote,
    grossOut,
    netOut,
    netMinOut,
    feeAmount,
    needsApprove,
    insufficient,
    highImpact,
    feeActive,
    feeRecipient,
    feeRecipientPending: feeExpected && !feeReady,
    canQuote,
    exec,
  };
}
