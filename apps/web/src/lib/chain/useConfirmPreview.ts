"use client";

/**
 * useConfirmPreview (P0.1) — the REAL pre-sign gate for the vault confirm.
 *
 * Replaces the confirm gate's old cosmetic `setTimeout` "simulation" with two
 * INDEPENDENT, live health signals that must BOTH be green before the wallet is
 * ever asked to sign a deposit:
 *
 *   1. Agent quote — `POST /vault/quote/{deposit|withdraw}` through the same-origin
 *      BFF (`/api/agent/*`). ERC-4626-accurate preview + the policy caps meter
 *      (`caps.wouldBreach`) + the fee disclosure (agent-service-api.md §3.7).
 *   2. On-chain preview — a direct-RPC `eth_call` of `previewDeposit(assets)` /
 *      `previewRedeem(shares)` on the deployed vault (the same read the tx relies on).
 *
 * FAIL-CLOSED: `status` is `ok` ONLY when both signals are healthy. Any error — a
 * failed/again-unreachable quote, a reverting preview, or a policy cap breach
 * (`wouldBreach`) — yields `status: "error"` with a clear reason, and the caller
 * hides the Sign button entirely (no signature is ever offered off an unverified
 * state). While either is still loading, `status` is `loading` and Sign stays
 * disabled.
 *
 * NON-CUSTODY (N2 — withdraw is sacred): a WITHDRAW is gated ONLY on the on-chain
 * preview (direct RPC). The agent withdraw quote is fetched for disclosure but a
 * quote failure NEVER blocks a withdrawal (agent-service-api.md §3.7: withdraw
 * quotes are convenience-only; their absence must never block the exit). The
 * public `/exit` escape hatch does not use this hook at all.
 */

import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import type { VaultExec } from "@/lib/chain/useExecuteVaultTx";
import { useAgentClient } from "@/lib/agent/useAgent";
import { wagmiConfig } from "@/lib/wagmi";

/** Chain ids wagmi has a configured transport for (matches useVault's read typing). */
type ReadChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** A single signal's lifecycle (and the aggregate gate). */
export type PreviewStatus = "idle" | "loading" | "ok" | "error";

/** Minimal shape read from the §3.7 deposit quote (defensive — validated loosely). */
interface DepositQuoteLite {
  shares?: string;
  caps?: { wouldBreach?: boolean };
  performanceFee?: { disclosure?: string };
  stale?: boolean;
}

/** Minimal shape read from the §018/US2 `/vault/simulate/*` dry-run (defensive — validated loosely).
 * Mirrors `VaultSimulateResponse` from `@sparkpoint/shared/schemas`. */
interface VaultSimulateLite {
  approvalRequired?: boolean;
  simulation?: {
    willRevert?: boolean;
    revertReason?: string | null;
    gas?: { estimate?: string };
    asOfBlock?: number;
  } | null;
}

export interface ConfirmPreviewOptions {
  /**
   * `false` ⇒ the agent quote/simulate surfaces are NOT APPLICABLE to this execution: the agent
   * quotes/simulates the LAUNCH vault, and a curated third-party wrapper is not it (the agent
   * fails closed with NOT_DEPLOYED on 4663). The gate then rests on the direct-RPC ERC-4626
   * preview — which IS the read the transaction relies on — and the UI must not present the
   * absent agent step as a failure. Defaults to true (the launch vault path, unchanged).
   */
  readonly agentQuote?: boolean;
}

export interface ConfirmPreview {
  /** Aggregate gate. `ok` ⇒ safe to enable Sign; `error` ⇒ FAIL CLOSED (hide Sign). */
  readonly status: PreviewStatus;
  /** False when the agent quote/simulate steps do not apply to this execution (curated wrapper). */
  readonly agentQuoteApplicable: boolean;
  /** Agent `/vault/quote/*` health. For withdraw this is informational (never gates). */
  readonly quoteStatus: PreviewStatus;
  /** Direct-RPC `previewDeposit`/`previewRedeem` health. */
  readonly previewStatus: PreviewStatus;
  /** §018/US2 pre-sign dry-run (`/vault/simulate/*`) health. Advisory on withdraw (never gates, N2). */
  readonly simStatus: PreviewStatus;
  /** True when the deposit quote reports the policy caps would be breached (blocks Sign). */
  readonly wouldBreach: boolean;
  /** True when the dry-run predicts the tx would REVERT. On deposit this blocks Sign; on withdraw
   * it is advisory only (surfaced, never gating — the exit is sacred, N2). */
  readonly willRevert: boolean;
  /** Deposit only: the live USDC allowance is below the amount, so the dry-run was deferred — the
   * user must approve first. NOT a revert and NOT a hard block (the deposit flow approves first). */
  readonly approvalRequired: boolean;
  /** The decoded revert reason from the dry-run, when it predicts a revert. */
  readonly revertReason: string | undefined;
  /** The real `eth_estimateGas` (hex) from a passing dry-run, when available. */
  readonly gasEstimate: string | undefined;
  /** Short, human reason when `status === "error"` (rendered in the confirm gate). */
  readonly error: string | undefined;
  /** The verbatim fee disclosure from the deposit quote, when present (§3.7). */
  readonly disclosure: string | undefined;
}

/** viem/agent errors carry a message; trim for a compact inline reason. */
function shortMessage(err: unknown, fallback: string): string {
  const anyErr = err as { shortMessage?: string; message?: string } | null;
  const msg = anyErr?.shortMessage ?? anyErr?.message ?? fallback;
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

/**
 * Drive the live quote + on-chain preview for `exec`. INERT (`idle`) when `exec`
 * is undefined — the hooks still mount (Rules of Hooks) but fire nothing, so a
 * caller can invoke this unconditionally.
 */
export function useConfirmPreview(
  exec: VaultExec | undefined,
  opts?: ConfirmPreviewOptions,
): ConfirmPreview {
  const { chainId: connectedChainId } = useAccount();
  const { client, online } = useAgentClient();
  const agentQuote = opts?.agentQuote !== false;

  const isDeposit = exec?.kind === "deposit";
  const amountArg: bigint | undefined = exec
    ? exec.kind === "deposit"
      ? exec.assets
      : exec.shares
    : undefined;
  // Only trust an on-chain preview / agent quote taken against the SAME chain the
  // exec targets — a mid-review network switch must not green-light a stale gate.
  const chainMatches = exec !== undefined && connectedChainId === exec.chainId;

  // ── 1. on-chain eth_call preview (direct RPC — the same read the tx relies on) ──
  // Two typed reads (one per side); each fires only for its own intent. Mirrors the
  // separate `previewDeposit`/`previewRedeem` reads in useVault.
  const vaultBase = {
    address: exec?.vault as `0x${string}`,
    abi: sparkPointVaultAbi,
    chainId: exec?.chainId as ReadChainId | undefined,
  } as const;

  const previewDepositRead = useReadContract({
    ...vaultBase,
    functionName: "previewDeposit",
    args: [isDeposit && amountArg !== undefined ? amountArg : 0n],
    query: { enabled: exec !== undefined && isDeposit && amountArg !== undefined && amountArg > 0n },
  });
  const previewRedeemRead = useReadContract({
    ...vaultBase,
    functionName: "previewRedeem",
    args: [!isDeposit && amountArg !== undefined ? amountArg : 0n],
    query: { enabled: exec !== undefined && !isDeposit && amountArg !== undefined && amountArg > 0n },
  });
  const previewRead = isDeposit ? previewDepositRead : previewRedeemRead;

  const previewStatus: PreviewStatus =
    exec === undefined
      ? "idle"
      : previewRead.isError
        ? "error"
        : previewRead.data === undefined
          ? "loading"
          : (previewRead.data as bigint) > 0n
            ? "ok"
            : "error";

  // ── 2. agent quote via the same-origin BFF (§3.7) — launch-vault only ──
  const quoteEnabled = agentQuote && exec !== undefined && client !== null && online;
  const quoteQuery = useQuery({
    queryKey: [
      "agent",
      "vault-quote",
      exec?.kind,
      exec?.chainId,
      exec?.account,
      amountArg?.toString() ?? null,
    ],
    enabled: quoteEnabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) =>
      client!.request<DepositQuoteLite>(`/vault/quote/${exec!.kind}`, {
        method: "POST",
        body:
          exec!.kind === "deposit"
            ? { by: "assets", amount: exec!.assets.toString() }
            : { by: "shares", amount: exec!.shares.toString() },
        signal,
      }),
  });

  const quoteData = quoteQuery.data;
  const wouldBreach = isDeposit && quoteData?.caps?.wouldBreach === true;
  const disclosure = quoteData?.performanceFee?.disclosure;

  const quoteStatus: PreviewStatus =
    exec === undefined || !quoteEnabled
      ? "idle"
      : quoteQuery.isError
        ? "error"
        : quoteQuery.data === undefined
          ? "loading"
          : "ok";

  // ── 3. §018/US2 pre-sign dry-run via the BFF — an eth_call of the REAL mutating calldata ──
  // Advisory-additional: on DEPOSIT a positive revert prediction blocks Sign (saves the user gas);
  // on WITHDRAW it is informational only and NEVER gates the exit (N2). A sim outage does NOT block
  // deposits either — only a *positive* `willRevert` does — so an advisory RPC hiccup can't strand a
  // user. `approvalRequired` (allowance < amount) is surfaced honestly, not a revert.
  const simEnabled = quoteEnabled;
  const simQuery = useQuery({
    queryKey: [
      "agent",
      "vault-simulate",
      exec?.kind,
      exec?.chainId,
      exec?.account,
      amountArg?.toString() ?? null,
    ],
    enabled: simEnabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) =>
      client!.request<VaultSimulateLite>(`/vault/simulate/${exec!.kind}`, {
        method: "POST",
        body:
          exec!.kind === "deposit"
            ? { by: "assets", amount: exec!.assets.toString() }
            : { by: "shares", amount: exec!.shares.toString() },
        signal,
      }),
  });

  const simData = simQuery.data;
  const willRevert = simData?.simulation?.willRevert === true;
  const approvalRequired = isDeposit && simData?.approvalRequired === true;
  const revertReason = simData?.simulation?.revertReason ?? undefined;
  const gasEstimate = simData?.simulation?.gas?.estimate;

  const simStatus: PreviewStatus =
    exec === undefined || !simEnabled
      ? "idle"
      : simQuery.isError
        ? "error"
        : simQuery.data === undefined
          ? "loading"
          : "ok";

  // ── aggregate gate ──
  let status: PreviewStatus;
  let error: string | undefined;

  if (exec === undefined) {
    status = "idle";
  } else if (previewStatus === "error") {
    status = "error";
    error = previewRead.error
      ? shortMessage(previewRead.error, "On-chain preview failed — can't sign safely.")
      : "On-chain preview returned zero — can't sign safely.";
  } else if (!chainMatches) {
    // A network mismatch (or a not-yet-resolved chain) can't be verified → fail closed.
    status = previewStatus === "loading" ? "loading" : "error";
    if (status === "error") error = "Wrong network for this transaction — switch, then retry.";
  } else if (isDeposit && !agentQuote) {
    // CURATED WRAPPER (053): the agent quote/simulate target the launch vault, so they are not
    // part of this gate. The direct-RPC ERC-4626 preview is the check, and the wrapper + factory
    // enforce their own caps/provenance on-chain.
    status = previewStatus === "ok" ? "ok" : previewStatus === "loading" ? "loading" : "error";
  } else if (isDeposit) {
    // DEPOSIT is gated on the quote + the preview (deposits are cap/pause-gated), PLUS a positive
    // pre-sign dry-run revert (§018/US2). A sim outage does NOT block (advisory) — but we wait for
    // the dry-run to RESOLVE before enabling Sign so a predicted revert is never missed.
    if (wouldBreach) {
      status = "error";
      error = "This deposit would exceed your policy cap — nothing to sign.";
    } else if (quoteStatus === "error") {
      status = "error";
      error = quoteQuery.error
        ? shortMessage(quoteQuery.error, "Couldn't verify this deposit with Sparky — can't sign safely.")
        : "Couldn't verify this deposit with Sparky — can't sign safely.";
    } else if (willRevert) {
      status = "error";
      error = revertReason
        ? `This deposit would revert on-chain: ${revertReason}`
        : "This deposit would revert on-chain — nothing to sign.";
    } else if (previewStatus === "ok" && quoteStatus === "ok" && simStatus !== "loading") {
      status = "ok";
    } else {
      status = "loading";
    }
  } else {
    // WITHDRAW (N2): gated ONLY on the on-chain preview. The quote AND the dry-run are informational
    // — neither a quote failure nor a sim verdict/outage may ever block an exit.
    status = previewStatus === "ok" ? "ok" : "loading";
  }

  return {
    status,
    agentQuoteApplicable: agentQuote,
    quoteStatus,
    previewStatus,
    simStatus,
    wouldBreach,
    willRevert,
    approvalRequired,
    revertReason,
    gasEstimate,
    error,
    disclosure,
  };
}
