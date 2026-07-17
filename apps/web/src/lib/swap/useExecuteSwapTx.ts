"use client";

/**
 * useExecuteSwapTx — the REAL Uniswap V3 swap execution flow (manual swap page).
 *
 * Mirrors `useExecuteVaultTx`'s approve→action two-leg, user-signed pattern for a Uniswap V3
 * `SwapRouter02` swap. The user is the SOLE signer (`writeContractAsync`); SparkPoint holds no key
 * and takes no custody. The recipient is ALWAYS the connecting account. Native ETH is handled the
 * standard Uniswap way, and the `multicall(deadline, …)` overload gives deadline protection:
 *
 *   • ETH → USDC : multicall(deadline, [exactInputSingle{ tokenIn: WETH, recipient: user }]) with
 *                  msg.value = amountIn (the router wraps ETH). No approve leg.
 *   • USDC → ETH : approve(router, amountIn) →
 *                  multicall(deadline, [exactInputSingle{ recipient: ADDRESS_THIS, amountOutMinimum: 0 },
 *                                       unwrapWETH9(amountOutMinimum, user)]) — the unwrap enforces
 *                  the slippage floor and forwards native ETH to the user.
 *
 * INERT when `exec` is `undefined` (Rules-of-Hooks safe). Slippage floor (`amountOutMinimum`) +
 * `deadline` are always present — critical given the thin testnet pool.
 */

import { useCallback, useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import { erc20Abi, encodeFunctionData, type Address, type Hex } from "viem";
import { wagmiConfig } from "@/lib/wagmi";
import { swapRouter02Abi, ADDRESS_THIS } from "./abis";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** A resolved swap intent — built by the swap page from a live QuoterV2 quote + slippage setting. */
export interface SwapExec {
  readonly chainId: number;
  /** Uniswap V3 SwapRouter02. */
  readonly router: Address;
  /** tokenIn on-chain address — for the native-ETH input this is WETH (the router wraps msg.value). */
  readonly tokenIn: Address;
  /** tokenOut on-chain address — for the native-ETH output this is WETH (unwrapped to ETH). */
  readonly tokenOut: Address;
  /** The pool fee tier chosen (best-output tier from the quote). */
  readonly fee: number;
  /** recipient of the output == the connecting account (non-custody). */
  readonly account: Address;
  readonly amountIn: bigint;
  /** Slippage floor: min output accepted (quote × (1 − slippage)). */
  readonly amountOutMinimum: bigint;
  /** Deadline HORIZON in seconds; the absolute unix deadline is stamped at signing time (keeps the
   * render pure — no `Date.now()` during render). The `multicall` reverts after it. */
  readonly deadlineSeconds: number;
  /** true ⇒ native ETH input (send msg.value, no ERC-20 approve). */
  readonly fromNative: boolean;
  /** true ⇒ native ETH output (swap to WETH held by the router, then unwrapWETH9 to the user). */
  readonly toNative: boolean;
  /** true ⇒ an ERC-20 `approve(router, amountIn)` leg is needed (token-in that isn't native). */
  readonly needsApprove: boolean;
  /** §fee — SparkPoint routing fee in bips (≤100=1% cap), taken IN the swap and paid straight to
   * ``feeRecipient`` on-chain (the app never custodies it). The user receives output − fee. */
  readonly feeBips: number;
  /** The routing-fee recipient (the vault's ``feeRecipient()``, read live). */
  readonly feeRecipient: Address;
  readonly onDone?: () => void;
}

export type SwapExecStage = "idle" | "approve" | "execute" | "done" | "error";

export interface SwapExecController {
  readonly stage: SwapExecStage;
  readonly isBusy: boolean;
  readonly isDone: boolean;
  readonly needsApprove: boolean;
  readonly approveHash: Hex | undefined;
  readonly txHash: Hex | undefined;
  readonly error: string | undefined;
  readonly label: string;
  readonly start: () => void;
  readonly reset: () => void;
}

function shortError(err: unknown): string {
  const anyErr = err as { shortMessage?: string; message?: string } | null;
  const msg = anyErr?.shortMessage ?? anyErr?.message ?? "Transaction failed.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

/**
 * Encode the router calls for a swap direction (fed into `multicall(deadline, data)`).
 *
 * §fee: the swap sends its output to the router (ADDRESS_THIS), then the fee-bearing payment leg
 * (`unwrapWETH9WithFee` for native-ETH out, `sweepTokenWithFee` for ERC-20 out) forwards
 * (output − routing fee) to the user and the fee straight to ``feeRecipient`` on-chain. The payment
 * leg's ``amountMinimum`` enforces the slippage floor on the GROSS output (checked before the split).
 */
function swapCalls(e: SwapExec): Hex[] {
  const swap = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: e.tokenIn,
        tokenOut: e.tokenOut,
        fee: e.fee,
        recipient: ADDRESS_THIS, // output stays in the router so the fee leg can split it
        amountIn: e.amountIn,
        amountOutMinimum: 0n, // the fee leg below enforces the real min (on the gross output)
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const payLeg = e.toNative
    ? encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "unwrapWETH9WithFee",
        args: [e.amountOutMinimum, e.account, BigInt(e.feeBips), e.feeRecipient],
      })
    : encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "sweepTokenWithFee",
        args: [e.tokenOut, e.amountOutMinimum, e.account, BigInt(e.feeBips), e.feeRecipient],
      });
  return [swap, payLeg];
}

export function useExecuteSwapTx(exec: SwapExec | undefined): SwapExecController {
  const [stage, setStage] = useState<SwapExecStage>("idle");
  const [approveHash, setApproveHash] = useState<Hex>();
  const [txHash, setTxHash] = useState<Hex>();
  const [error, setError] = useState<string>();
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: exec?.chainId as WagmiChainId | undefined });

  const start = useCallback(() => {
    const e = exec;
    if (e === undefined || publicClient === undefined) return;
    setError(undefined);
    setApproveHash(undefined);
    setTxHash(undefined);

    void (async () => {
      try {
        // ── leg 0: ERC-20 approve (only when the token-in isn't native ETH) ──
        if (e.needsApprove && !e.fromNative) {
          setStage("approve");
          setAwaitingWallet(true);
          const approveTx = await writeContractAsync({
            address: e.tokenIn,
            abi: erc20Abi,
            functionName: "approve",
            args: [e.router, e.amountIn],
            chainId: e.chainId as WagmiChainId,
          });
          setAwaitingWallet(false);
          setApproveHash(approveTx);
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
          if (approveReceipt.status === "reverted") {
            setStage("error");
            setError("Approval reverted on-chain — nothing moved.");
            return;
          }
        }

        // ── terminal leg: the swap (multicall for deadline + native-ETH unwrap) ──
        setStage("execute");
        setAwaitingWallet(true);
        // Stamp the absolute deadline at signing time (in this callback — not during render).
        const deadline = BigInt(Math.floor(Date.now() / 1000) + e.deadlineSeconds);
        const tx = await writeContractAsync({
          address: e.router,
          abi: swapRouter02Abi,
          functionName: "multicall",
          args: [deadline, swapCalls(e)],
          value: e.fromNative ? e.amountIn : 0n,
          chainId: e.chainId as WagmiChainId,
        });
        setAwaitingWallet(false);
        setTxHash(tx);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        if (receipt.status === "reverted") {
          setStage("error");
          setError("Swap reverted on-chain — nothing moved (try a higher slippage).");
          return;
        }
        setStage("done");
        e.onDone?.();
      } catch (err) {
        setAwaitingWallet(false);
        setStage("error");
        setError(shortError(err));
      }
    })();
  }, [exec, publicClient, writeContractAsync]);

  const reset = useCallback(() => {
    setStage("idle");
    setError(undefined);
    setApproveHash(undefined);
    setTxHash(undefined);
    setAwaitingWallet(false);
  }, []);

  const isBusy = stage === "approve" || stage === "execute";
  const label =
    stage === "approve"
      ? awaitingWallet
        ? "Approve token in your wallet…"
        : "Approving…"
      : stage === "execute"
        ? awaitingWallet
          ? "Confirm swap in your wallet…"
          : "Swapping on-chain…"
        : "Waiting for your wallet…";

  return {
    stage,
    isBusy,
    isDone: stage === "done",
    needsApprove: exec?.needsApprove ?? false,
    approveHash,
    txHash,
    error,
    label,
    start,
    reset,
  };
}
