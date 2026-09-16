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

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS, chainName } from "@sparkpoint/shared/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { brokerRevenueDistributorAbi } from "@sparkpoint/shared/abis";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import {
  allocationUrl,
  deriveClaimState,
  findAllocation,
  formatTokenAmount,
  REVENUE_SHARE_CUSTODY_NOTE,
  REVENUE_SHARE_DISCLOSURE,
  type PublishedPeriod,
} from "@/lib/chain/brokers";

/** The chain the collection lives on. Robinhood testnet today; mainnet is a separate decision. */
const BROKER_CHAIN = CHAIN_IDS.robinhoodTestnet;
// On the mainnet-beta build (only 4663 registered) the collection's chain isn't registered, so show a
// plain "not on this network" state (NEVER "coming soon" — rule 3 above) instead of a dead
// "switch to Robinhood Testnet" prompt against an unregistered chain.
const BROKER_ON_THIS_BUILD = wagmiConfig.chains.some((c) => c.id === BROKER_CHAIN);

/** Minimal ERC-20 metadata reads — the period names its own units. */
const erc20MetaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

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

  const claimedAlready = useReadContract({
    ...read,
    functionName: "claimed",
    args: latest && owner ? [latest, owner] : undefined,
    query: { enabled: !!distributor && !!latest && !!owner },
  });

  const periodRow = period.data?.[0]?.result as
    | readonly [Address, bigint, bigint, `0x${string}`, bigint]
    | undefined;
  const published = periodRow ? Number(periodRow[4]) > 0 : undefined;
  const periodToken = periodRow?.[0];

  // Read the units from the token the period is actually denominated in. Hardcoding "USDC" here
  // would mislabel a period funded in anything else, which on testnet it currently is.
  const meta = useReadContracts({
    contracts: periodToken
      ? [
          { address: periodToken, abi: erc20MetaAbi, functionName: "symbol", chainId: BROKER_CHAIN },
          { address: periodToken, abi: erc20MetaAbi, functionName: "decimals", chainId: BROKER_CHAIN },
        ]
      : [],
    query: { enabled: !!periodToken },
  });
  const tokenSymbol = (meta.data?.[0]?.result as string | undefined) ?? "tokens";
  const tokenDecimals = Number((meta.data?.[1]?.result as number | undefined) ?? 18);

  const { writeContractAsync } = useWriteContract();

  // ⚠️ The amount and proof come from the PUBLISHED document, not the chain — a Merkle distributor
  // stores only the root. The document is served without a session on purpose: the split is a claim
  // about other people's money, so anyone must be able to fetch it and recompute the root.
  const [doc, setDoc] = useState<PublishedPeriod | undefined>();
  const [docMissing, setDocMissing] = useState(false);
  useEffect(() => {
    if (!latest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(allocationUrl(BROKER_CHAIN, Number(latest)));
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as PublishedPeriod;
        if (!cancelled) setDoc(body);
      } catch {
        // A published period whose document we cannot fetch is NOT "you get nothing" — it is a
        // missing artifact, and saying so is the only honest option. The claim stays disabled.
        if (!cancelled) setDocMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latest]);

  const mine = useMemo(() => findAllocation(doc, owner), [doc, owner]);
  const allocation: bigint | undefined =
    published !== true ? undefined : mine ? BigInt(mine.amount) : docMissing ? undefined : 0n;

  const verdict = deriveClaimState({
    distributor,
    periodCount: count,
    published,
    allocation,
    alreadyClaimed: claimedAlready.data as boolean | undefined,
    walletReady: onChain,
  });

  if (!BROKER_ON_THIS_BUILD) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Broker revenue share</h1>
        </header>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          The Sparky Broker collection isn&rsquo;t part of this network — its revenue distributor lives on Robinhood
          testnet. There is nothing to claim here.
        </div>
      </main>
    );
  }

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
            <>
              <p className="mt-4 text-3xl font-semibold tabular-nums">
                {formatTokenAmount(allocation, tokenDecimals, tokenSymbol)}
              </p>
              {mine && mine.grandfatheredTokenIds.length > 0 && (
                // Named on the screen, not just in the file. A weight nobody chose should be
                // visible to the person it was applied to.
                <p className="mt-2 text-sm text-muted-foreground">
                  Broker{mine.grandfatheredTokenIds.length > 1 ? "s" : ""}{" "}
                  {mine.grandfatheredTokenIds.map((t) => `#${t}`).join(", ")} were activated before
                  tiers existed, so they count at 1.0×.
                </p>
              )}
            </>
          )}

          {docMissing && published === true && (
            <p className="mt-3 text-sm text-muted-foreground">
              This period is published on-chain, but its allocation document could not be loaded, so
              the amount cannot be shown. Nothing is lost — the claim stays open.
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
                args: [latest, allocation, (mine?.proof ?? []) as readonly `0x${string}`[]],
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
