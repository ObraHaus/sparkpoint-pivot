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
 * connecting account.
 *
 * TWO fee shapes exist, and the chain's book decides which one applies:
 *   • OUTPUT-side (feature 007, vault chains): the swap sends output to the SwapRouter02 itself and a
 *     `sweepTokenWithFee`/`unwrapWETH9WithFee` pay-leg forwards (output − fee) to the user and the fee
 *     to the vault's live `feeRecipient()`.
 *   • INPUT-side (W.7 fee-router, 4663 once wired): the swap goes through the custom `FeeRouter`,
 *     which charges `floor(amountIn × feeBps / 10000)` in `tokenIn`, pauses that at the splitter, and
 *     swaps only the net input. The bps and the destination are read LIVE from the router
 *     (`feeBps()`/`splitter()`) so the disclosed numbers are the charged ones — never a hardcoded
 *     "0.20%" string.
 * A chain with neither (alpha, and beta until the router deploys) has NO fee: `feeActive` is false and
 * the direct SwapRouter02 path is byte-identical to before.
 */

import { useMemo } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { sparkPointVaultAbi, feeRouterAbi } from "@sparkpoint/shared/abis";
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
  inputFee,
  netInput,
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
  /** OUTPUT-side routing-fee amount in `tokenOut` base units (grossOut − netOut). */
  feeAmount?: bigint;
  /** INPUT-side fee in `tokenIn` base units (fee-router mode only). */
  feeAmountIn?: bigint;
  needsApprove: boolean;
  insufficient: boolean;
  highImpact: boolean;
  feeActive: boolean;
  feeRecipient?: Address;
  /** a fee chain whose recipient hasn't resolved yet — must not execute until it does. */
  feeRecipientPending: boolean;
  /**
   * W.7 — the chain's book wires a `feeRouter`: the fee is charged on the INPUT side by the router
   * itself and this resolver quotes the NET input. False everywhere else (alpha byte-identical).
   */
  feeRouterActive: boolean;
  /** The router's on-chain fee in bps (`feeBps()`), read live; undefined until the read lands. */
  feeBpsLive?: number;
  /** The fee destination the router will pay (`splitter()`), read live; the disclosed destination. */
  feeDestination?: Address;
  /** true while the router's constants are unresolved — review must block, never guess a fee. */
  feeRouterPending: boolean;
  canQuote: boolean;
  /**
   * Connected on a chain this build does NOT serve (beta build = Robinhood Chain 4663 only).
   * When true the surfaces must NOT quote — they must ask the wallet to switch, because the
   * alternative (silently resolving to a fallback chain) quoted the wrong network and mislabelled it.
   */
  wrongChain: boolean;
  /** fully-resolved intent (undefined until quote + recipient + amount all ready). */
  exec?: SwapExec;
}

export function useSwapConfirm(params: SwapConfirmParams): SwapConfirmResult {
  const { tokenIn: explicitIn, tokenOut: explicitOut, ethToUsdc = true, amount, slippageBps } = params;
  const { address, isConnected, chainId } = useAccount();
  // The mainnet-beta build registers ONLY Robinhood Chain 4663: a wallet on any other chain resolves
  // to an unsupported state here. Never let that silently fall back to Base Sepolia (it quoted the
  // wrong network and printed the wrong label) — clamp the display/quote chain to the build chain
  // and surface `wrongChain` so the caller asks for a switch instead.
  const IS_BETA_BUILD = APP_DEFAULT_CHAIN_ID === 4663;
  const wrongChain = IS_BETA_BUILD && isConnected && chainId !== undefined && chainId !== APP_DEFAULT_CHAIN_ID;
  const activeChain = IS_BETA_BUILD
    ? (isConnected && chainId === APP_DEFAULT_CHAIN_ID ? chainId : DISPLAY_CHAIN_ID)
    : (isConnected ? chainId : DISPLAY_CHAIN_ID);

  const dex = dexById("uniswap_v3");
  const dexLive = dexLiveOn(dex, activeChain);
  const netLabel = activeChain === 46630 ? "Robinhood Testnet" : activeChain === 4663 ? "Robinhood Chain" : activeChain === 8453 ? "Base" : "Base Sepolia";
  const uniswapVenue = dexDisplayLabel(dex, activeChain);

  const { router: routerAddr, quoter, vault, weth, usdc, swapFeeRecipient, feeRouter } = useMemo(() => {
    try {
      const b = getAddresses(activeChain ?? DISPLAY_CHAIN_ID);
      // A configured routing-fee treasury, ignoring an unset/zero value (never activate a fee to 0x0).
      const treasury = b.swapFeeRecipient && b.swapFeeRecipient.toLowerCase() !== ZERO_ADDR ? b.swapFeeRecipient : undefined;
      const feeRouterAddr = b.feeRouter && b.feeRouter.toLowerCase() !== ZERO_ADDR ? b.feeRouter : undefined;
      return {
        router: b.uniswapV3SwapRouter02,
        quoter: b.uniswapV3QuoterV2,
        vault: b.vault,
        weth: b.weth,
        usdc: b.usdc,
        swapFeeRecipient: treasury,
        feeRouter: feeRouterAddr,
      };
    } catch {
      return { router: undefined, quoter: undefined, vault: undefined, weth: undefined, usdc: undefined, swapFeeRecipient: undefined, feeRouter: undefined };
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

  // §fee-router (W.7) — when the book wires a router, the fee is INPUT-side and this resolver must
  // quote the NET input. The constants that drive the disclosure are read from the router itself.
  const feeRouterActive = !!feeRouter;
  const feeRouterBpsRead = useReadContract({
    address: feeRouter,
    abi: feeRouterAbi,
    functionName: "feeBps",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && feeRouterActive },
  });
  const feeRouterSplitterRead = useReadContract({
    address: feeRouter,
    abi: feeRouterAbi,
    functionName: "splitter",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && feeRouterActive },
  });
  const feeBpsLive = feeRouterBpsRead.data !== undefined ? Number(feeRouterBpsRead.data) : undefined;
  const feeDestination = feeRouterSplitterRead.data as Address | undefined;
  // Synchronous readiness: a still-loading constant BLOCKS quoting/reviewing (never a guessed fee).
  const feeRouterPending = feeRouterActive && (feeBpsLive === undefined || feeDestination === undefined);
  const feeAmountIn =
    feeRouterActive && feeBpsLive !== undefined ? inputFee(amountIn, feeBpsLive) : undefined;
  // The router pulls the gross input but swaps only the net; QuoterV2 must see the same net amount.
  const amountInForQuote = !feeRouterActive
    ? amountIn
    : feeBpsLive !== undefined
      ? netInput(amountIn, feeBpsLive)
      : 0n;

  // §fee (007) — the OUTPUT-side routing fee (vault chains): a configured per-chain treasury wins
  // SYNCHRONOUSLY, so a chain with NO vault (e.g. Robinhood 46630) still charges the fee. Where unset,
  // fall back to the vault's live `feeRecipient()`. Disabled entirely when the fee-router is wired:
  // its input-side fee IS the routing fee.
  const feeRecipientRead = useReadContract({
    address: vault,
    abi: sparkPointVaultAbi,
    functionName: "feeRecipient",
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!vault && !swapFeeRecipient && !feeRouterActive },
  });
  const vaultFeeRecipient = feeRecipientRead.data as Address | undefined;
  const feeRecipient = swapFeeRecipient ?? vaultFeeRecipient;
  // `feeExpected` is SYNCHRONOUS (never derived from the async recipient value), so a still-loading vault
  // recipient BLOCKS the swap below rather than silently degrading it to a fee-free swap.
  const feeExpected = !feeRouterActive && (!!swapFeeRecipient || !!vault);
  const feeReady = !!feeRecipient; // already normalized to a non-zero address
  const feeActive = feeRouterActive || feeExpected;

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
  // The spender is whoever pulls the input: the fee-router when wired (it holds the input for the
  // duration of the call), else the SwapRouter02.
  const approveSpender = feeRouterActive ? feeRouter : routerAddr;
  const allowanceRead = useReadContract({
    address: nonNativeIn ? tokenIn!.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && approveSpender ? [address, approveSpender] : undefined,
    chainId: activeChain as WagmiChainId | undefined,
    query: { enabled: isConnected && !!address && nonNativeIn && !!approveSpender },
  });
  const balanceIn = tokenIn?.isNative ? ethBal.data?.value : (tokenInBal.data as bigint | undefined);
  const allowance = allowanceRead.data as bigint | undefined;

  // USDC is a real routing (hop) asset on Base mainnet + Robinhood, but NOT on Base Sepolia / local fork
  // where "USDC" is the Aave test token with no pools beyond WETH — skip the USDC hop there.
  const usdcIsRoutingAsset = activeChain !== 84532 && activeChain !== 31337;
  const canQuote =
    dexLive &&
    pairReady &&
    amountIn > 0n &&
    !!quoter &&
    !!weth &&
    isConnected &&
    !wrongChain &&
    !feeRouterPending &&
    (!feeRouterActive || amountInForQuote > 0n);
  const quote = useSwapQuote({
    chainId: activeChain,
    quoter,
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    amountIn: amountInForQuote,
    weth,
    usdc,
    usdcIsRoutingAsset,
    singleHopOnly: feeRouterActive,
    enabled: canQuote,
  });

  const grossOut = quote.amountOut;
  const netOut =
    grossOut === undefined
      ? undefined
      : feeRouterActive
        ? grossOut // the fee came off the INPUT; the swap output is entirely the user's
        : feeActive
          ? afterFee(grossOut, ROUTING_FEE_BIPS)
          : grossOut;
  const minOut = grossOut !== undefined ? amountOutMinimum(grossOut, slippageBps) : undefined; // swap floor
  const netMinOut =
    minOut === undefined
      ? undefined
      : feeRouterActive
        ? minOut
        : feeActive
          ? afterFee(minOut, ROUTING_FEE_BIPS)
          : minOut;
  const feeAmount =
    !feeRouterActive && grossOut !== undefined && netOut !== undefined ? grossOut - netOut : undefined;
  const needsApprove = nonNativeIn && amountIn > 0n && (allowance === undefined || allowance < amountIn);
  // USDT-style tokens revert on a non-zero→non-zero approve; reset to zero first when re-approving.
  const needsApproveReset = nonNativeIn && allowance !== undefined && allowance > 0n && allowance < amountIn;
  const insufficient = balanceIn !== undefined && amountIn > balanceIn;
  const highImpact = (quote.priceImpactBps ?? 0) >= HIGH_IMPACT_BPS;

  const exec: SwapExec | undefined = useMemo(() => {
    if (!tokenIn || !tokenOut || !address || activeChain === undefined) return undefined;
    const routerTarget = feeRouterActive ? feeRouter : routerAddr;
    if (!routerTarget) return undefined;
    if (wrongChain) return undefined; // never build a swap the wallet's chain can't execute
    if (feeRouterPending) return undefined; // the router's constants must resolve before executing
    if (!feeRouterActive && feeExpected && !feeReady) return undefined; // fee chains need the recipient before executing (never fee-free)
    const route = quote.route;
    if (route === undefined || minOut === undefined || amountIn <= 0n) return undefined;
    // The fee-router executes exactly one exact-input hop; a multi-hop route cannot be expressed.
    if (feeRouterActive && route.kind !== "single") return undefined;
    return {
      kind: feeRouterActive ? "feeRouter" : "router02",
      chainId: activeChain,
      router: routerTarget,
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
      // The output-side pay-leg fields are inert in fee-router mode (the input-side fee is charged
      // by the router itself), so the direct-path swapCalls never double-charges.
      feeBips: !feeRouterActive && feeActive ? ROUTING_FEE_BIPS : 0,
      feeRecipient: !feeRouterActive && feeActive ? feeRecipient : undefined,
      onDone: () => {
        void ethBal.refetch();
        void tokenInBal.refetch();
        void allowanceRead.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerAddr, feeRouter, feeRouterActive, feeRouterPending, feeExpected, feeReady, tokenIn, tokenOut, address, activeChain, feeActive, feeRecipient, quote.route, minOut, amountIn, needsApprove, needsApproveReset]);

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
    feeAmountIn,
    needsApprove,
    insufficient,
    highImpact,
    feeActive,
    feeRecipient,
    feeRecipientPending: feeExpected && !feeReady,
    feeRouterActive,
    feeBpsLive,
    feeDestination,
    feeRouterPending,
    canQuote,
    wrongChain,
    exec,
  };
}
