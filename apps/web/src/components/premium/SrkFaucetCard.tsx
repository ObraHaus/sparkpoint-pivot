"use client";

/**
 * SrkFaucetCard — the live SRK balance + the one-click testnet faucet, on /premium (feature 026).
 *
 * Everything shown is an on-chain read of the deployed `SrkFaucet`; the claim is a user-signed
 * `claim()` — SparkPoint holds nothing and signs nothing (the agent is provably keyless and is not
 * in this path at all). The faucet's parameters are admin-editable on-chain, so the amount and
 * cooldown are READ, never hardcoded into this copy.
 *
 * Mirrors the working test-USDC faucet pattern on /bridge (`MintTestUsdcButton`).
 */

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { srkFaucetAbi } from "@sparkpoint/shared/abis";
import { explorerTxUrl } from "@/lib/chain/explorer";
import {
  deriveSrkFaucetState,
  faucetErrorCopy,
  formatCountdown,
  SRK_FAUCET_ANCHOR,
  wholeSrk,
} from "@/lib/chain/srkFaucet";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

/** SRK + its faucet live on Base Sepolia only (the token is testnet-only by design). */
const SRK_CHAIN = 84532;

function shortErr(e: unknown): string {
  const a = e as { shortMessage?: string; message?: string } | null;
  return faucetErrorCopy(a?.shortMessage ?? a?.message ?? "Transaction failed.");
}

/** A ticking unix-seconds clock, so the cooldown countdown actually counts down. */
function useNowSeconds(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function SrkFaucetCard() {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const owner = address as Address | undefined;
  const addrs = getAddresses(SRK_CHAIN);
  const srk = addrs.srk as Address | undefined;
  const faucet = addrs.srkFaucet as Address | undefined;
  const onChain = isConnected && walletChain === SRK_CHAIN;

  const publicClient = usePublicClient({ chainId: SRK_CHAIN });
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [err, setErr] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();

  const faucetRead = { address: faucet, abi: srkFaucetAbi, chainId: SRK_CHAIN } as const;
  const enabled = { query: { enabled: !!faucet } } as const;

  const claimAmount = useReadContract({ ...faucetRead, functionName: "claimAmount", ...enabled });
  const cooldown = useReadContract({ ...faucetRead, functionName: "cooldown", ...enabled });
  const available = useReadContract({ ...faucetRead, functionName: "available", ...enabled });
  const nextClaimAt = useReadContract({
    ...faucetRead,
    functionName: "nextClaimAt",
    args: owner ? [owner] : undefined,
    query: { enabled: !!faucet && !!owner },
  });
  const srkBalance = useReadContract({
    address: srk,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId: SRK_CHAIN,
    query: { enabled: !!srk && !!owner, refetchInterval: 15_000 },
  });

  const nowSeconds = useNowSeconds(!!faucet);
  const state = deriveSrkFaucetState({
    faucet,
    claimAmount: claimAmount.data as bigint | undefined,
    cooldown: cooldown.data as bigint | undefined,
    available: available.data as bigint | undefined,
    nextClaimAt: nextClaimAt.data as bigint | undefined,
    nowSeconds,
    walletReady: onChain,
  });

  const busy = stage === "pending";
  // Feature 006: pause the force-refresh while the claim is signing/broadcasting (LOCKED).
  useHoldCriticalOp(busy, "locked");

  const claim = async () => {
    if (!faucet || !publicClient) return;
    setStage("pending");
    setErr(undefined);
    setTxHash(undefined);
    try {
      const tx = await writeContractAsync({
        address: faucet,
        abi: srkFaucetAbi,
        functionName: "claim",
        chainId: SRK_CHAIN,
      });
      setTxHash(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        setStage("error");
        setErr("The claim reverted — the faucet allows one claim per address per cooldown period.");
        return;
      }
      setStage("done");
      void srkBalance.refetch();
      void available.refetch();
      void nextClaimAt.refetch();
    } catch (e) {
      setStage("error");
      setErr(shortErr(e));
    }
  };

  const balanceStr =
    srkBalance.data !== undefined
      ? `${Number(formatUnits(srkBalance.data as bigint, 18)).toLocaleString()} SRK`
      : isConnected
        ? "…"
        : "connect a wallet";
  const amountStr = state.loaded
    ? `${wholeSrk((claimAmount.data as bigint) ?? 0n).toLocaleString()} SRK`
    : "…";
  const cooldownStr = state.loaded ? formatCountdown(Number((cooldown.data as bigint) ?? 0n)) : "…";
  const receiptUrl = txHash ? explorerTxUrl(SRK_CHAIN, txHash) : undefined;

  return (
    <div id={SRK_FAUCET_ANCHOR} className="card card-pad" style={{ marginBottom: 16, scrollMarginTop: 80 }}>
      <div className="card-hd">
        <span className="t">Get SRK — testnet faucet</span>
        <span className="lbl">Base Sepolia</span>
      </div>

      <div className="payrow">
        <span className="muted">Your SRK balance</span>
        <span className="tnum">{balanceStr}</span>
      </div>
      <div className="payrow">
        <span className="muted">Per claim</span>
        <span className="tnum">{amountStr}</span>
      </div>
      <div className="payrow">
        <span className="muted">Cooldown</span>
        <span className="tnum">{cooldownStr} per address</span>
      </div>
      {faucet && (
        <div className="payrow">
          <span className="muted">Faucet contract</span>
          <a
            className="mono"
            href={`https://sepolia.basescan.org/address/${faucet}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--primary)", fontSize: 11 }}
            title="The deployed faucet — verify it on Basescan"
          >
            {faucet.slice(0, 6)}…{faucet.slice(-4)} ↗
          </a>
        </div>
      )}

      <button
        className="btn btn-primary btn-md"
        style={{ width: "100%", marginTop: 14 }}
        disabled={!state.canClaim || busy}
        onClick={() => void claim()}
      >
        {busy ? "Confirm in your wallet…" : `Claim ${state.loaded ? amountStr : "SRK"}`}
      </button>

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        {state.blockedReason ??
          "You sign; the SRK lands straight in your wallet. SparkPoint holds nothing and can’t claim on your behalf."}
      </div>

      {stage === "done" && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--gain)" }}>
          ✓ Claimed {amountStr} to your wallet.{" "}
          {receiptUrl && (
            <a href={receiptUrl} target="_blank" rel="noreferrer" className="cite">
              View tx ↗
            </a>
          )}
        </div>
      )}
      {stage === "error" && err && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--loss)" }}>{err}</div>
      )}

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--border-soft)",
          fontSize: 11.5,
          color: "var(--muted-foreground)",
          lineHeight: 1.5,
        }}
      >
        SRK is a <b>testnet</b> utility token with a fixed supply — this faucet hands out a
        pre-funded float, it cannot mint. It never gates the vault, onboarding, chat or withdrawals.
      </div>
    </div>
  );
}
