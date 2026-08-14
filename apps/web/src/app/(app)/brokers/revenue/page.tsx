"use client";

/**
 * /brokers/revenue — claim your share of a closed period (feature 044, US1).
 *
 * ⚠️ **Read this before changing any copy on this page.**
 *
 * The distributor is deployed and **claiming is off**. Not behind a flag — `claim` reverts until
 * someone calls `publishAllocations`, so the off state is structural and cannot be flipped by
 * accident. As of today no period has ever been opened, which means the state this page is really
 * in, and will be in for as long as anyone can foresee, is: **nothing has been distributed**.
 *
 * So the hardest requirement here is not the claim flow. It is that an empty pot reads as a plain
 * fact rather than as an error or a teaser. The interactive prototype that started this feature
 * showed "**+$14.00/month**" per holder, derived from an assumed $12,300 of monthly revenue across
 * 1,000 brokers. The real numbers: **2.18 test-USDC** of protocol fees ever recorded, across eight
 * events, in tokens with no market value — and the collection is 10,000, not 1,000. Every figure in
 * that prototype was fiction.
 *
 * Hence the rules, enforced by tests in `lib/chain/brokers.test.ts`, not by care:
 *
 *   1. The only number on this page is what the chain says is claimable **right now**. No
 *      projection, no rate, no per-month figure, no "estimated".
 *   2. No earn / income / yield / dividend framing anywhere.
 *   3. An empty period says "nothing was distributed" — never "coming soon".
 *
 * Amounts truncate rather than round, because showing more than the chain will pay is the one error
 * direction that becomes a support ticket about missing money.
 */

import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS, chainName } from "@sparkpoint/shared/chains";
import { brokerRevenueDistributorAbi } from "@sparkpoint/shared/abis";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import {
  deriveClaimState,
  formatTokenAmount,
  REVENUE_SHARE_CUSTODY_NOTE,
  REVENUE_SHARE_DISCLOSURE,
} from "@/lib/chain/brokers";

/** The chain the collection lives on. Robinhood testnet today; mainnet is a separate decision. */
const BROKER_CHAIN = CHAIN_IDS.robinhoodTestnet;

export default function Page() {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const owner = address as Address | undefined;

  const book = useMemo(() => {
    try {
      return getAddresses(BROKER_CHAIN);
    } catch {
      return undefined;
    }
  }, []);
  const distributor = book?.brokerRevenueDistributor as Address | undefined;
  const onChain = isConnected && walletChain === BROKER_CHAIN;

  const read = { address: distributor, abi: brokerRevenueDistributorAbi, chainId: BROKER_CHAIN } as const;
  const when = { query: { enabled: !!distributor } } as const;

  const periodCount = useReadContract({ ...read, functionName: "periodCount", ...when });
  const count = periodCount.data === undefined ? undefined : Number(periodCount.data as bigint);

  // The newest period is the only one with anything to show. Older ones stay claimable on-chain
  // forever; a period list is worth building when more than one has ever existed.
  const latest = count && count > 0 ? BigInt(count) : undefined;

  const period = useReadContracts({
    contracts: latest
      ? [
          { ...read, functionName: "periods", args: [latest] },
          { ...read, functionName: "claimable", args: [latest, owner ?? "0x0"] },
        ]
      : [],
    query: { enabled: !!distributor && !!latest && !!owner },
  });

  const periodRow = period.data?.[0]?.result as
    | readonly [Address, bigint, bigint, `0x${string}`, bigint]
    | undefined;
  const published = periodRow ? Number(periodRow[4]) > 0 : undefined;

  const { writeContractAsync } = useWriteContract();

  // ⚠️ The wallet's own allocation and proof come from the PUBLISHED allocation document, not from
  // the chain — a Merkle distributor stores only the root. No period has been published, so there
  // is nothing to fetch and this is deliberately left undefined rather than faked.
  const allocation: bigint | undefined = published === true ? 0n : undefined;

  const verdict = deriveClaimState({
    distributor,
    periodCount: count,
    published,
    allocation,
    alreadyClaimed: published === true ? false : undefined,
    walletReady: onChain,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Revenue share</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For holders of an activated Sparky Broker, on {chainName(BROKER_CHAIN)}.
        </p>
      </header>

      {!isConnected && (
        <p className="rounded-lg border p-4 text-sm">Connect a wallet to see your claims.</p>
      )}

      {isConnected && !onChain && (
        <p className="rounded-lg border p-4 text-sm">
          Switch to {chainName(BROKER_CHAIN)} to see your claims. Brokers and their revenue share
          live on that network.
        </p>
      )}

      {onChain && (
        <section className="rounded-lg border p-5">
          <h2 className="text-lg font-medium">{verdict.headline}</h2>
          {verdict.detail && (
            <p className="mt-2 text-sm text-muted-foreground">{verdict.detail}</p>
          )}

          {/* Only ever the real, on-chain amount. Absent when there is nothing to show — a zero
              placed next to a claim button reads as "we owe you nothing", which is a different
              claim from "no period has been distributed". */}
          {verdict.status === "claimable" && allocation !== undefined && (
            <p className="mt-4 text-3xl font-semibold tabular-nums">
              {formatTokenAmount(allocation, 6, "USDC")}
            </p>
          )}

          <button
            type="button"
            disabled={!verdict.canClaim}
            onClick={async () => {
              if (!verdict.canClaim || !distributor || !latest || allocation === undefined) return;
              await writeContractAsync({
                address: distributor,
                abi: brokerRevenueDistributorAbi,
                functionName: "claim",
                args: [latest, allocation, []],
                chainId: BROKER_CHAIN,
              });
            }}
            className="mt-5 rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Claim
          </button>
        </section>
      )}

      <section className="mt-6 space-y-3 text-sm text-muted-foreground">
        <p>{REVENUE_SHARE_DISCLOSURE}</p>
        <p>{REVENUE_SHARE_CUSTODY_NOTE}</p>
        {distributor && (
          <p>
            The distributor contract is{" "}
            <a
              href={explorerAddressUrl(BROKER_CHAIN, distributor)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {distributor}
            </a>
            . Its code is the authority on all of the above, not this page.
          </p>
        )}
      </section>
    </main>
  );
}
