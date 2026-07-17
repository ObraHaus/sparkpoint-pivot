"use client";

/**
 * useSwapConfirm — the resolver "brain" for a Uniswap V3 ETH↔USDC swap, so BOTH the `/swap` page and
 * the in-chat inline swap card build a `SwapExec` from ONE place (the swap analog of `useVaultConfirm`).
 *
 * Given a direction + amount + slippage it reads addresses/tokens/vault/balances/allowance on-chain
 * (direct-RPC + wagmi), fetches a live QuoterV2 quote (`useSwapQuote`), computes net/min/fee/needs-
 * approve, and assembles the fully-resolved `SwapExec` — or `undefined` until every input is ready
 * (fail-closed; never a fabricated number). It does NOT sign: the caller passes `exec` to
 * `useExecuteSwapTx` (user-signed). Non-custody: recipient is always the connecting account and the
 * 0.20% routing fee is split on-chain to the vault's `feeRecipient`.
 */

import { useMemo } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { wagmiConfig } from "@/lib/wagmi";
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
const DISPLAY_CHAIN_ID = 84532;

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

export interface SwapConfirmParams {
  /** true ⇒ ETH → USDC; false ⇒ USDC → ETH (only the ETH↔USDC pair exists). */
  ethToUsdc: boolean;
  /** input amount as a decimal string in `tokenIn` units — parsed with the LIVE token decimals
   * (which vary by chain, e.g. Robinhood USDC is 18-dp). Empty/invalid ⇒ no quote, `exec` undefined. */
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

export function useSwapConfirm({ ethToUsdc, amount, slippageBps }: SwapConfirmParams): SwapConfirmResult {
  const { address, isConnected, chainId } = useAccount();
  const activeChain = isConnected ? chainId : DISPLAY_CHAIN_ID;

  const dex = dexById("uniswap_v3");
  const dexLive = dexLiveOn(dex, activeChain);
  const netLabel = activeChain === 46630 ? "Robinhood Testnet" : activeChain === 8453 ? "Base" : "Base Sepolia";
  const uniswapVenue = dexDisplayLabel(dex, activeChain);

  const { router: routerAddr, quoter, vault, tokens } = useMemo(() => {
    try {
      const b = getAddresses(activeChain ?? DISPLAY_CHAIN_ID);
      return {
        router: b.uniswapV3SwapRouter02,
        quoter: b.uniswapV3QuoterV2,
        vault: b.vault,
        tokens: swapTokens(activeChain),
      };
    } catch {
      return { router: undefined, quoter: undefined, vault: undefined, tokens: [] as SwapToken[] };
    }
  }, [activeChain]);

  // §fee — the 0.20% routing fee is paid to the VAULT's feeRecipient(), read live. Fee-free on a chain
  // with no vault (e.g. Robinhood testnet), which then uses the plain swap path.
  const feeRecipientRead = useReadContract({
    address: vault,
    abi: sparkPointVaultAbi,
    functionName: "feeRecipient",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!vault },
  });
  const feeRecipient = feeRecipientRead.data as Address | undefined;
  const feeActive = !!vault;

  const eth = tokens.find((t) => t.isNative);
  const usdc = tokens.find((t) => !t.isNative);
  const tokenIn = ethToUsdc ? eth : usdc;
  const tokenOut = ethToUsdc ? usdc : eth;
  const pairReady = !!tokenIn && !!tokenOut && isConfiguredToken(tokenIn) && isConfiguredToken(tokenOut);
  const amountIn = tokenIn ? parseSafe(amount, tokenIn.decimals) : 0n;

  const ethBal = useBalance({
    address,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address },
  });
  const usdcBal = useReadContract({
    address: usdc?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && !!usdc && isConfiguredToken(usdc) },
  });
  const allowance = useReadContract({
    address: usdc?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerAddr ? [address, routerAddr] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && !!usdc && !!routerAddr && !ethToUsdc },
  });
  const balanceIn = tokenIn?.isNative ? ethBal.data?.value : (usdcBal.data as bigint | undefined);

  const canQuote = dexLive && pairReady && amountIn > 0n && !!quoter && isConnected;
  const quote = useSwapQuote({
    chainId: activeChain,
    quoter,
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    amountIn,
    decimalsIn: tokenIn?.decimals ?? 18,
    enabled: canQuote,
  });

  const grossOut = quote.amountOut;
  const netOut =
    grossOut !== undefined ? (feeActive ? afterFee(grossOut, ROUTING_FEE_BIPS) : grossOut) : undefined;
  const minOut = grossOut !== undefined ? amountOutMinimum(grossOut, slippageBps) : undefined; // gross floor
  const netMinOut =
    minOut !== undefined ? (feeActive ? afterFee(minOut, ROUTING_FEE_BIPS) : minOut) : undefined;
  const feeAmount = grossOut !== undefined && netOut !== undefined ? grossOut - netOut : undefined;
  const needsApprove =
    !ethToUsdc && amountIn > 0n && (allowance.data === undefined || (allowance.data as bigint) < amountIn);
  const insufficient = balanceIn !== undefined && amountIn > balanceIn;
  const highImpact = (quote.priceImpactBps ?? 0) >= HIGH_IMPACT_BPS;

  const exec: SwapExec | undefined = useMemo(() => {
    if (!routerAddr || !tokenIn || !tokenOut || !address || activeChain === undefined) return undefined;
    if (feeActive && !feeRecipient) return undefined; // fee chains need the recipient before executing
    if (quote.amountOut === undefined || quote.fee === undefined || minOut === undefined || amountIn <= 0n)
      return undefined;
    return {
      chainId: activeChain,
      router: routerAddr,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: quote.fee,
      account: address,
      amountIn,
      amountOutMinimum: minOut,
      deadlineSeconds: DEFAULT_DEADLINE_SECONDS,
      fromNative: tokenIn.isNative,
      toNative: tokenOut.isNative,
      needsApprove,
      feeBips: feeActive ? ROUTING_FEE_BIPS : 0,
      feeRecipient: feeActive ? feeRecipient : undefined,
      onDone: () => {
        void ethBal.refetch();
        void usdcBal.refetch();
        void allowance.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerAddr, tokenIn, tokenOut, address, activeChain, feeActive, feeRecipient, quote.amountOut, quote.fee, minOut, amountIn, needsApprove]);

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
    feeRecipientPending: feeActive && !feeRecipient,
    canQuote,
    exec,
  };
}
