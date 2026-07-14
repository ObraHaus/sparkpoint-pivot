"use client";

/**
 * useExecuteVaultTx (T046) — the REAL deposit / withdraw execution flow.
 *
 * The write half of the vault surface. Given a resolved deposit or withdraw
 * intent (built by the amount screen from LIVE useVault reads), it drives the
 * actual on-chain transactions the user signs from their OWN wallet:
 *
 *   • deposit  → (if allowance < amount) ERC-20 `approve(vault, amount)` on USDC,
 *                then `vault.deposit(amount, account)`  — a two-leg sequence.
 *   • withdraw → `vault.redeem(shares, account, account)`                — one leg.
 *
 * Each leg is submitted through wagmi's `useWriteContract` (`writeContractAsync` —
 * the user is the sole signer; SparkPoint holds no key) and CONFIRMED on the
 * connected transport's viem client (`usePublicClient().waitForTransactionReceipt`)
 * — a direct-RPC read, never the agent/indexer/backend. The receiver and owner are
 * ALWAYS the connecting account, so redeemed USDC returns to the user and the
 * deposit needs no third-party allowance. The sequence is a plain async flow (no
 * setState-in-effect), so approve→deposit chaining is explicit and race-free.
 *
 * Non-custody stance: nothing here can move funds without the user's signature, and
 * the withdraw leg (`redeem`) is the same call the PUBLIC /exit escape hatch encodes
 * (src/lib/chain/exit.ts) — the vault re-checks everything on-chain at execution and
 * never pause-gates withdrawals (N2). This hook only ORCHESTRATES the user's own txs.
 *
 * INERT when `exec` is `undefined`: the wagmi hooks still mount (Rules of Hooks) but
 * `start()` is a no-op — so ConfirmFlow can call it unconditionally and its non-onchain
 * callers (chat/premium/bridge/swap) are completely unaffected.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T046 (deposit/withdraw flows);
 * agent-service-api.md §3.7 (rounding favors the vault; net-of-fee). ABI: the T015
 * `sparkPointVaultAbi`; ERC-20 approve via viem `erc20Abi`.
 */

import { useCallback, useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import { erc20Abi, type Address, type Hex } from "viem";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { wagmiConfig } from "@/lib/wagmi";

/** Chain ids wagmi has a configured transport for (matches the write/client hooks' typing). */
type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** A resolved deposit intent — approve (if needed) then `deposit(assets, account)`. */
export interface DepositExec {
  readonly kind: "deposit";
  readonly chainId: number;
  readonly vault: Address;
  /** USDC token to `approve` before the deposit pull. */
  readonly usdc: Address;
  /** receiver of the minted shares == owner == the connecting account. */
  readonly account: Address;
  /** USDC (6-dp base units) to deposit. */
  readonly assets: bigint;
  /** Whether allowance(account, vault) < assets at review time → an approve leg is needed. */
  readonly needsApprove: boolean;
  /** Refresh callback fired once the deposit confirms (re-reads balances/allowance/caps). */
  readonly onDone?: () => void;
}

/** A resolved withdraw intent — `redeem(shares, account, account)` (never pause/cap-gated). */
export interface WithdrawExec {
  readonly kind: "withdraw";
  readonly chainId: number;
  readonly vault: Address;
  /** receiver of the redeemed USDC == owner == the connecting account. */
  readonly account: Address;
  /** Vault shares to redeem. */
  readonly shares: bigint;
  readonly onDone?: () => void;
}

export type VaultExec = DepositExec | WithdrawExec;

/** Execution stage. `approve`/`execute` are BUSY (awaiting wallet or confirmation). */
export type ExecStage = "idle" | "approve" | "execute" | "done" | "error";

export interface ExecController {
  readonly stage: ExecStage;
  /** A tx is in flight (awaiting the wallet or an on-chain receipt). */
  readonly isBusy: boolean;
  /** The final tx has confirmed. */
  readonly isDone: boolean;
  /** This intent will run an approve leg before the main tx (deposit only). */
  readonly needsApprove: boolean;
  /** The submitted ERC-20 approve tx hash (deposit, when an approve leg ran). */
  readonly approveHash: Hex | undefined;
  /** The confirmed deposit/redeem tx hash — the one the receipt links to. */
  readonly txHash: Hex | undefined;
  /** Short, human error message when a leg failed / was rejected (`undefined` otherwise). */
  readonly error: string | undefined;
  /** Human status label for the busy sign button. */
  readonly label: string;
  /** Begin (or restart) the flow — no-op when `exec` is undefined. */
  readonly start: () => void;
  /** Reset back to idle (clears hashes/error). */
  readonly reset: () => void;
}

/** viem/wagmi errors carry a `shortMessage`; fall back to `message`, trimmed for a toast. */
function shortError(err: unknown): string {
  const anyErr = err as { shortMessage?: string; message?: string } | null;
  const msg = anyErr?.shortMessage ?? anyErr?.message ?? "Transaction failed.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

/**
 * Drive the deposit(approve+deposit) / withdraw(redeem) sequence for `exec`.
 * See the file header for the non-custody stance and the inert-when-undefined contract.
 */
export function useExecuteVaultTx(exec: VaultExec | undefined): ExecController {
  const [stage, setStage] = useState<ExecStage>("idle");
  const [approveHash, setApproveHash] = useState<Hex>();
  const [txHash, setTxHash] = useState<Hex>();
  const [error, setError] = useState<string>();
  // True while a leg is awaiting the user's wallet (vs awaiting on-chain confirmation).
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: exec?.chainId as WagmiChainId | undefined });

  const start = useCallback(() => {
    const e = exec;
    if (e === undefined || publicClient === undefined) return;
    // Full reset so a retry after a rejection re-runs cleanly.
    setError(undefined);
    setApproveHash(undefined);
    setTxHash(undefined);

    void (async () => {
      try {
        // ── deposit leg 0: ERC-20 approve (only when allowance is short) ──
        if (e.kind === "deposit" && e.needsApprove) {
          setStage("approve");
          setAwaitingWallet(true);
          const approveTx = await writeContractAsync({
            address: e.usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [e.vault, e.assets],
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

        // ── terminal leg: deposit / redeem ──
        setStage("execute");
        setAwaitingWallet(true);
        const tx =
          e.kind === "deposit"
            ? await writeContractAsync({
                address: e.vault,
                abi: sparkPointVaultAbi,
                functionName: "deposit",
                args: [e.assets, e.account],
                chainId: e.chainId as WagmiChainId,
              })
            : await writeContractAsync({
                address: e.vault,
                abi: sparkPointVaultAbi,
                functionName: "redeem",
                args: [e.shares, e.account, e.account],
                chainId: e.chainId as WagmiChainId,
              });
        setAwaitingWallet(false);
        setTxHash(tx);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        if (receipt.status === "reverted") {
          setStage("error");
          setError("Transaction reverted on-chain — nothing moved.");
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
        ? "Approve USDC in your wallet…"
        : "Approving USDC…"
      : stage === "execute"
        ? awaitingWallet
          ? "Confirm in your wallet…"
          : "Confirming on-chain…"
        : "Waiting for your wallet…";

  return {
    stage,
    isBusy,
    isDone: stage === "done",
    needsApprove: exec?.kind === "deposit" ? exec.needsApprove : false,
    approveHash,
    txHash,
    error,
    label,
    start,
    reset,
  };
}
