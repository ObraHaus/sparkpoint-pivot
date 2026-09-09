"use client";

/**
 * PUBLIC withdraw-always escape hatch — `/exit` (T048, N2 / FR-034 / SC-003).
 *
 * The one page that must keep working when everything else is down: it imports NO
 * agent client and NO backend, reads the vault DIRECTLY over RPC (wagmi's
 * react-query reads hit the configured RPC transport, never the agent), and builds
 * the `redeem` calldata client-side from the bundled vault ABI (src/lib/chain/exit.ts).
 * It is never geo-blocked (src/middleware.ts always-allow), lives OUTSIDE the app
 * shell, and works while the vault is `paused()` — because on-chain withdraw/redeem
 * carry no pause, no cap, and fail-open fee accrual.
 *
 * The user is the sole signer: this page only reads + encodes; the wallet signs and
 * submits straight to the chain. If even this UI is unavailable, the same
 * `redeem(shares, you, you)` call can be made from BaseScan or `cast` — the address
 * + ABI are public and provable (shown below).
 */

import { useEffect, type CSSProperties } from "react";
import {
  useAccount,
  useConnect,
  useReadContract,
  useReadContracts,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import type { Address } from "viem";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { buildRedeemCall, vaultAddressFor } from "@/lib/chain/exit";
import { exitPublicConfig, exitReadChainId } from "@/lib/chain/exitPublicConfig";
import { explorerRoot } from "@/lib/chain/explorer";

/** USDC/6dp formatting — plain, no design-system dep (this page must always render). */
function usdc(raw: bigint): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const body = frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${body}`;
}

/**
 * 024 — BUG FIX plus de-duplication. This used to be a two-way ternary that returned
 * `https://basescan.org` for ANY chain that was not 84532 — so on Robinhood testnet 46630 it
 * produced a Base-mainnet explorer link for a Robinhood transaction: a confidently wrong reference
 * on the one page whose entire job is proving a user can verify and exit on-chain (Principle III).
 * Now resolved from the single chain-metadata registry, and honestly empty for a chain with no
 * explorer, so callers render a non-link rather than a misleading one.
 */
function explorerBase(chainId: number): string {
  return explorerRoot(chainId) ?? "";
}

export default function ExitPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain } = useSwitchChain();

  const vault = chainId === undefined ? undefined : vaultAddressFor(chainId);
  const enabled = isConnected && !!address && !!vault;
  // 042: `chainId` is pinned per-read because exitPublicConfig has no connector — without it,
  // reads would default to the config's FIRST chain, not the wallet's. Undefined (unsupported
  // chain) is fine: every read below is already disabled then (`vault` is undefined too).
  const readChainId = exitReadChainId(chainId);
  const vaultContract = { address: vault as Address, abi: sparkPointVaultAbi, chainId: readChainId } as const;

  // Direct-RPC reads — 042: pinned to each chain's PUBLIC endpoint via `exitPublicConfig`
  // (N2/FR-016). The app's main config routes browser reads through the SparkPoint-operated
  // RPC proxy; this page must keep working with that proxy (and everything else we run) DOWN,
  // so its reads never touch the proxied transports. Writes still go via the wallet below.
  const reads = useReadContracts({
    config: exitPublicConfig,
    query: { enabled },
    contracts: [
      { ...vaultContract, functionName: "balanceOf", args: [address as Address] },
      { ...vaultContract, functionName: "maxRedeem", args: [address as Address] },
      { ...vaultContract, functionName: "paused" },
    ],
  });

  const shares = reads.data?.[0]?.result as bigint | undefined;
  const redeemableShares = reads.data?.[1]?.result as bigint | undefined;
  const depositsPaused = reads.data?.[2]?.result as boolean | undefined;

  // Dependent read: the USDC those redeemable shares return now (already net of fee dilution).
  const previewRedeem = useReadContract({
    ...vaultContract,
    config: exitPublicConfig,
    functionName: "previewRedeem",
    args: [redeemableShares ?? 0n],
    query: { enabled: enabled && redeemableShares !== undefined && redeemableShares > 0n },
  });
  const redeemableAssets =
    redeemableShares !== undefined && redeemableShares === 0n
      ? 0n
      : (previewRedeem.data as bigint | undefined);

  const { sendTransaction, data: txHash, isPending: sending, error: sendError, reset } = useSendTransaction();
  // Receipt watch is a READ — pinned public like the other reads (the wallet already sent the tx).
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    config: exitPublicConfig,
    chainId: readChainId,
    hash: txHash,
  });

  // Feature 006: pause the force-refresh while a redemption is in flight (LOCKED). This is only a
  // SECONDARY net — /exit is ALSO hard-excluded from any auto-reload by pathname (see UpdateBanner),
  // because between reads / after a partial redeem the counter is 0 and this N2 page must always work.
  useHoldCriticalOp(sending || confirming || (!!txHash && !confirmed), "locked");

  // Refetch the position once a redemption confirms (refetch is not setState — lint-safe).
  useEffect(() => {
    if (confirmed) {
      void reads.refetch();
      void previewRedeem.refetch();
    }
  }, [confirmed, reads, previewRedeem]);

  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];

  function onWithdrawAll() {
    if (!vault || !address || redeemableShares === undefined) return;
    reset();
    // Calldata built client-side from the bundled ABI — no backend materializes it.
    const call = buildRedeemCall(vault as Address, redeemableShares, address as Address);
    sendTransaction({ to: call.to, data: call.data, value: call.value });
  }

  const loading = enabled && (reads.isLoading || (redeemableShares !== undefined && redeemableShares > 0n && previewRedeem.isLoading));

  return (
    <main style={S.page}>
      <div style={S.card}>
        <p style={S.kicker}>Withdraw · always available</p>
        <h1 style={S.h1}>Exit your position</h1>
        <p style={S.lede}>
          This page withdraws your funds directly on-chain. It works even if SparkPoint&rsquo;s app, AI,
          and servers are offline, and even while deposits are paused &mdash; the vault can never hold,
          freeze, or block your withdrawal. You are the only one who can sign it.
        </p>

        {!isConnected && (
          <div style={S.section}>
            <button style={S.primary} disabled={connecting} onClick={() => injected && connect({ connector: injected })}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p style={S.hint}>Connect the wallet that holds your vault shares.</p>
          </div>
        )}

        {isConnected && (
          <div style={S.section}>
            <div style={S.rowBetween}>
              <span style={S.muted}>Connected</span>
              <code style={S.code}>{address}</code>
            </div>

            {chainId !== undefined && vault === undefined && (
              <div>
                <p style={S.muted}>The vault isn&rsquo;t deployed on this network (chain {chainId}) yet.</p>
                {vaultAddressFor(84532) !== undefined && (
                  <button style={S.secondary} onClick={() => switchChain({ chainId: 84532 })}>
                    Switch to Base Sepolia
                  </button>
                )}
              </div>
            )}

            {enabled && loading && <p style={S.muted}>Reading the vault over RPC…</p>}

            {enabled && reads.isError && (
              <div style={S.warn}>
                <p style={{ margin: 0 }}>Couldn&rsquo;t read the vault over RPC.</p>
                <button style={S.secondary} onClick={() => void reads.refetch()}>Retry</button>
                <p style={S.hint}>
                  You can also redeem directly from your wallet or BaseScan &mdash; the vault address + ABI
                  are public.
                </p>
              </div>
            )}

            {enabled && !reads.isLoading && !reads.isError && shares === 0n && vault && (
              <div>
                <p style={S.muted}>This wallet holds no vault shares &mdash; nothing to withdraw.</p>
                <a style={S.link} href={`${explorerBase(chainId!)}/address/${vault}`} target="_blank" rel="noreferrer">
                  View the vault on BaseScan →
                </a>
              </div>
            )}

            {enabled && vault && shares !== undefined && shares > 0n && redeemableShares !== undefined && (
              <div>
                <div style={S.balanceBox}>
                  <span style={S.muted}>Redeemable now</span>
                  <span style={S.balance}>{redeemableAssets === undefined ? "…" : usdc(redeemableAssets)} USDC</span>
                </div>

                {depositsPaused && (
                  <p style={S.notice}>Deposits are currently paused &mdash; your withdrawal still works, as guaranteed.</p>
                )}
                {redeemableShares < shares && (
                  <p style={S.notice}>
                    Aave liquidity limits this transaction to the amount shown right now; repeat as liquidity
                    returns to withdraw the remainder.
                  </p>
                )}

                {!confirmed && (
                  <button style={S.primary} disabled={sending || confirming || redeemableShares === 0n} onClick={onWithdrawAll}>
                    {sending || confirming ? "Confirm in your wallet…" : "Withdraw everything"}
                  </button>
                )}

                {sendError && <p style={S.error}>{sendError.message}</p>}

                {txHash && (
                  <p style={confirmed ? S.success : S.muted}>
                    {confirmed ? "✓ Withdrawn. " : "Submitted. "}
                    <a style={S.link} href={`${explorerBase(chainId!)}/tx/${txHash}`} target="_blank" rel="noreferrer">
                      View transaction →
                    </a>
                  </p>
                )}

                <details style={S.details}>
                  <summary style={S.summary}>Do it yourself (without this page)</summary>
                  <p style={S.hint}>
                    Call <code style={S.code}>redeem({redeemableShares.toString()}, you, you)</code> on the vault at{" "}
                    <a style={S.link} href={`${explorerBase(chainId!)}/address/${vault}`} target="_blank" rel="noreferrer">
                      {vault}
                    </a>{" "}
                    from your wallet or <code style={S.code}>cast send</code>. The ABI is public and the call needs no approval.
                  </p>
                </details>
              </div>
            )}
          </div>
        )}

        <p style={S.footnote}>
          Non-custodial by construction. SparkPoint holds no admin key that can move your funds (N1), and
          withdrawals are never pausable (N2).
        </p>
      </div>
    </main>
  );
}

/** Inline, token-based styles — no design-system import, so the page renders even degraded. */
const S: Record<string, CSSProperties> = {
  page: { minHeight: "100dvh", display: "grid", placeItems: "center", padding: "2rem", background: "var(--bg, #0b0e14)", color: "var(--fg, #e7ecf3)" },
  card: { width: "100%", maxWidth: "36rem", padding: "2rem", borderRadius: "1rem", border: "1px solid var(--border, #232a36)", background: "var(--surface, #11151d)" },
  kicker: { fontSize: "0.75rem", letterSpacing: "0.09em", textTransform: "uppercase", opacity: 0.65, margin: "0 0 0.5rem" },
  h1: { fontSize: "1.6rem", margin: "0 0 0.75rem" },
  lede: { opacity: 0.85, lineHeight: 1.6, margin: "0 0 1.25rem" },
  section: { display: "flex", flexDirection: "column", gap: "0.85rem", padding: "1rem 0", borderTop: "1px solid var(--border, #232a36)" },
  rowBetween: { display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" },
  balanceBox: { display: "flex", flexDirection: "column", gap: "0.25rem", padding: "1rem", borderRadius: "0.7rem", background: "var(--surface-2, #0e1620)", margin: "0 0 1rem" },
  balance: { fontSize: "1.9rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  primary: { padding: "0.85rem 1.25rem", borderRadius: "0.6rem", border: "none", background: "var(--accent, #3b6ef2)", color: "#fff", fontWeight: 600, fontSize: "1rem", cursor: "pointer", width: "100%" },
  secondary: { padding: "0.55rem 1rem", borderRadius: "0.55rem", border: "1px solid var(--border, #2a3140)", background: "transparent", color: "inherit", fontWeight: 600, cursor: "pointer", marginTop: "0.5rem" },
  muted: { opacity: 0.7, margin: "0.25rem 0" },
  hint: { opacity: 0.6, fontSize: "0.85rem", margin: "0.4rem 0 0", lineHeight: 1.5 },
  code: { fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.8rem", wordBreak: "break-all", opacity: 0.9 },
  link: { color: "var(--accent, #6ea0ff)", textDecoration: "none", fontWeight: 600 },
  notice: { fontSize: "0.9rem", opacity: 0.85, padding: "0.6rem 0.8rem", borderRadius: "0.5rem", background: "var(--surface-2, #0e1620)", margin: "0 0 0.85rem", lineHeight: 1.5 },
  warn: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  error: { color: "var(--loss, #ff6b6b)", fontSize: "0.9rem", margin: "0.6rem 0 0", lineHeight: 1.5 },
  success: { color: "var(--gain, #37d39b)", margin: "0.85rem 0 0", fontWeight: 600 },
  footnote: { fontSize: "0.8rem", opacity: 0.55, lineHeight: 1.5, margin: "1.25rem 0 0", paddingTop: "1rem", borderTop: "1px solid var(--border, #232a36)" },
  details: { marginTop: "1rem" },
  summary: { cursor: "pointer", opacity: 0.75, fontSize: "0.9rem" },
};
