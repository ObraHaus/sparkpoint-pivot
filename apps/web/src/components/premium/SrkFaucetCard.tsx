"use client";

/**
 * SrkFaucetCard — the live SRK balance + the one-click testnet faucet, on /srk (043b moved it
 * there from /premium: Premium is not bought with SRK any more, so the acquire path belongs beside
 * the token it hands out rather than beside a price).
 *
 * Everything shown is an on-chain read of the deployed `SrkFaucet`; the claim is a user-signed
 * `claim()` — SparkPoint holds nothing and signs nothing (the agent is provably keyless and is not
 * in this path at all). The faucet's parameters are admin-editable on-chain, so the amount and
 * cooldown are READ, never hardcoded into this copy.
 *
 * Mirrors the working test-USDC faucet pattern on /bridge (`MintTestUsdcButton`).
 */

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS, chainName } from "@sparkpoint/shared/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { srkFaucetAbi } from "@sparkpoint/shared/abis";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
import {
  deriveSrkFaucetState,
  faucetErrorCopy,
  formatCountdown,
  pickSrkFaucetChain,
  SRK_FAUCET_ANCHOR,
  type SrkFaucetChain,
  wholeSrk,
} from "@/lib/chain/srkFaucet";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

/**
 * The chains that carry a testnet SRK and a faucet, in preference order.
 *
 * Base Sepolia is first for continuity; Robinhood testnet joined in 043 phase 1
 * with its OWN, unrelated SRK deployment: the Sparky Broker NFT lives on Robinhood Chain and
 * activating a broker retires SRK, and a burn on one chain cannot flip state on another in the same
 * transaction — so the SRK a broker retires has to live on the broker's chain.
 *
 * ⚠️ The two SRKs are different tokens with different addresses. A balance on one is not a balance
 * on the other, and this card never adds them up: it shows exactly one chain at a time and says
 * which.
 */
type SrkChainId = typeof CHAIN_IDS.baseSepolia | typeof CHAIN_IDS.robinhoodTestnet;
const SRK_CHAIN_IDS: readonly SrkChainId[] = [CHAIN_IDS.baseSepolia, CHAIN_IDS.robinhoodTestnet];
// SRK is a testnet-only test token; on the mainnet-beta build (only 4663 registered) NONE of its
// faucet chains are registered, so the faucet is genuinely unavailable there (shown as a disabled note).
const SRK_ON_THIS_BUILD = SRK_CHAIN_IDS.some((id) => wagmiConfig.chains.some((c) => c.id === id));

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

  /**
   * Every SRK chain, with its addresses resolved — what `pickSrkFaucetChain` chooses from. The
   * literal `chainId` type is carried through (the picker is generic) because wagmi's hooks accept
   * only the chain ids the app is configured with, not a bare `number`.
   */
  const chains: readonly (SrkFaucetChain & { chainId: SrkChainId })[] = useMemo(
    () =>
      SRK_CHAIN_IDS.map((chainId) => ({
        chainId,
        name: chainName(chainId),
        srk: getAddresses(chainId).srk,
        faucet: getAddresses(chainId).srkFaucet,
      })),
    [],
  );

  // The card shows exactly ONE chain. It follows the wallet when the wallet is on a faucet chain, so
  // a tester who switched to Robinhood to activate a broker is not told to go back to Base Sepolia.
  // A manual pick overrides that, so both faucets stay reachable without switching networks first.
  const [picked, setPicked] = useState<SrkChainId>();
  const active = pickSrkFaucetChain(chains, picked ?? walletChain);

  const chainId = active?.chainId;
  const srk = active?.srk as Address | undefined;
  const faucet = active?.faucet as Address | undefined;
  const onChain = isConnected && chainId !== undefined && walletChain === chainId;

  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [err, setErr] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();

  const faucetRead = { address: faucet, abi: srkFaucetAbi, chainId } as const;
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
    chainId,
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
    chainName: active?.name,
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
        chainId,
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
  const receiptUrl = txHash ? explorerTxUrl(chainId, txHash) : undefined;
  const faucetUrl = explorerAddressUrl(chainId, faucet);
  const offered = chains.filter((c) => Boolean(c.faucet));

  if (!SRK_ON_THIS_BUILD) {
    return (
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-hd">
          <span className="t">SRK faucet</span>
          <span className="lbl">not on this network</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          SRK isn&rsquo;t part of the Robinhood Chain beta — the beta&rsquo;s utility token arrives with the token
          launch. There is no SRK faucet on this network.
        </div>
      </div>
    );
  }

  return (
    <div id={SRK_FAUCET_ANCHOR} className="card card-pad" style={{ marginBottom: 16, scrollMarginTop: 80 }}>
      <div className="card-hd">
        <span className="t">Get SRK — testnet faucet</span>
        {offered.length > 1 ? (
          <span style={{ display: "flex", gap: 6 }}>
            {offered.map((c) => (
              <button
                key={c.chainId}
                type="button"
                className="lbl"
                aria-pressed={c.chainId === chainId}
                onClick={() => {
                  setPicked(c.chainId);
                  setStage("idle");
                  setErr(undefined);
                  setTxHash(undefined);
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 999,
                  padding: "2px 9px",
                  background: c.chainId === chainId ? "var(--surface-2)" : "transparent",
                  color: c.chainId === chainId ? "var(--foreground)" : "var(--muted-foreground)",
                }}
              >
                {c.name}
              </button>
            ))}
          </span>
        ) : (
          <span className="lbl">{active?.name ?? "—"}</span>
        )}
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
          {faucetUrl ? (
            <a
              className="mono"
              href={faucetUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--primary)", fontSize: 11 }}
              title={`The deployed faucet — verify it on the ${active?.name ?? "network"} explorer`}
            >
              {faucet.slice(0, 6)}…{faucet.slice(-4)} ↗
            </a>
          ) : (
            // No explorer for this chain: show the address, never a fabricated link.
            <span className="mono" style={{ fontSize: 11 }}>
              {faucet.slice(0, 6)}…{faucet.slice(-4)}
            </span>
          )}
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
        {offered.length > 1 && (
          <>
            {" "}
            Each network has its <b>own</b> SRK, so balances don’t carry across. The one that
            matters here is Robinhood Testnet SRK — that is what a Sparky Broker retires to
            activate.
          </>
        )}
      </div>
    </div>
  );
}
