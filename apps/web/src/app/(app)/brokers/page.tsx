"use client";

/**
 * /brokers — mint a Sparky Broker, and see the ones you hold (feature 043, US3 + US4).
 *
 * Everything on this page is an on-chain read. Activation state is read on every load and never
 * cached into component state as a flag: a flag can outlive the transfer that cleared it, and "a
 * stranger keeps the access their broker was sold with" is the one bug this whole collection exists
 * to prevent.
 *
 * ⚠️ The IMAGES are served by the collection's own deploy, not from here. `apps/web`'s middleware
 * fail-closes and allowlists three exact `/api` paths, so anything machine-facing added to this app
 * gets a silent 307 to a holding page — invisible from inside, broken from outside. That is why the
 * metadata service lives in its own repo with its own deploy, and why this page only ever links out
 * to it.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS, chainName } from "@sparkpoint/shared/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { brokerSaleAbi, sparkyBrokerAbi } from "@sparkpoint/shared/abis";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { brokerViews, deriveMintState, type BrokerToken } from "@/lib/chain/brokers";
import { useIndexedBrokers } from "@/lib/chain/useIndexedBrokers";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";

/** The chain the collection lives on. Robinhood testnet today; mainnet is a separate decision. */
const BROKER_CHAIN = CHAIN_IDS.robinhoodTestnet;
// The Sparky Broker collection lives on Robinhood testnet (46630); on the mainnet-beta build (only
// 4663 registered) it isn't part of the beta — show "coming soon" instead of a mint UI that targets
// an unregistered chain.
const BROKER_ON_THIS_BUILD = wagmiConfig.chains.some((c) => c.id === BROKER_CHAIN);

/** Where the collection's metadata and images are served from — its OWN deploy, never this app. */
const METADATA_ORIGIN =
  process.env.NEXT_PUBLIC_BROKER_METADATA_ORIGIN ?? "https://brokers-dev.aldrickb.app";

/**
 * ⚠️ KNOWN LIMIT, stated rather than hidden. `SparkyBroker` is solady ERC-721 and is **not
 * enumerable**, so there is no `tokenOfOwnerByIndex` and no way to ask the contract which ids a
 * wallet holds. This page therefore checks ownership of ids `1..totalMinted`, batched.
 *
 * That is now the FALLBACK path only: `GET /brokers/owned` (feature 044) walks `Transfer` logs in
 * the agent and scales to the full 5,555. The scan runs when the indexer cannot answer, because
 * the browser can still read the chain directly when the agent is down.
 * The cap below stops the page melting in the meantime; when it bites, the page says so instead of
 * silently showing a partial gallery, because a holder seeing 40 of their 60 brokers and being told
 * nothing is worse than being told the list is truncated.
 */
const OWNERSHIP_SCAN_LIMIT = 500;

export default function Page() {
  const router = useRouter();
  const { address, isConnected, chainId: walletChain } = useAccount();
  const owner = address as Address | undefined;

  const book = useMemo(() => {
    try {
      return getAddresses(BROKER_CHAIN);
    } catch {
      return undefined;
    }
  }, []);
  const nft = book?.brokerNft as Address | undefined;
  const sale = book?.brokerSale as Address | undefined;
  const onChain = isConnected && walletChain === BROKER_CHAIN;

  const publicClient = usePublicClient({ chainId: BROKER_CHAIN });
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [err, setErr] = useState<string>();

  const nftRead = { address: nft, abi: sparkyBrokerAbi, chainId: BROKER_CHAIN } as const;
  const saleRead = { address: sale, abi: brokerSaleAbi, chainId: BROKER_CHAIN } as const;
  const whenNft = { query: { enabled: !!nft } } as const;
  const whenSale = { query: { enabled: !!sale } } as const;

  const totalMinted = useReadContract({ ...nftRead, functionName: "totalMinted", ...whenNft });
  const maxSupply = useReadContract({ ...nftRead, functionName: "MAX_SUPPLY", ...whenNft });
  const saleOpen = useReadContract({ ...saleRead, functionName: "saleOpen", ...whenSale });
  const perWalletCap = useReadContract({ ...saleRead, functionName: "perWalletCap", ...whenSale });
  const mintedByWallet = useReadContract({
    ...saleRead,
    functionName: "mintedBy",
    args: owner ? [owner] : undefined,
    query: { enabled: !!sale && !!owner },
  });

  const minted = totalMinted.data as bigint | undefined;

  // The indexer walks Transfer logs and scales to the full 5,555. The scan below is the fallback
  // for when it cannot answer -- the browser can still read the chain directly even if the agent
  // is down, and a bounded scan is correct while the collection is small.
  const indexed = useIndexedBrokers(onChain);
  const useScan = indexed.source === "scan";

  const scanCount = !useScan || minted === undefined ? 0 : Math.min(Number(minted), OWNERSHIP_SCAN_LIMIT);
  const truncated = useScan && minted !== undefined && Number(minted) > OWNERSHIP_SCAN_LIMIT;
  const ids = useMemo(() => Array.from({ length: scanCount }, (_, i) => BigInt(i + 1)), [scanCount]);

  const owners = useReadContracts({
    contracts: ids.map((id) => ({ ...nftRead, functionName: "ownerOf" as const, args: [id] })),
    query: { enabled: !!nft && !!owner && ids.length > 0 },
  });

  const mine = useMemo(() => {
    if (indexed.ids !== undefined) return indexed.ids.map((n) => BigInt(n));
    if (!owner || !owners.data) return [];
    return ids.filter((_, i) => {
      const r = owners.data?.[i];
      return r?.status === "success" && String(r.result).toLowerCase() === owner.toLowerCase();
    });
  }, [indexed.ids, ids, owners.data, owner]);

  // Batched — N brokers cost ONE call rather than N, which is the reason `activationsOf` exists.
  const activations = useReadContract({
    ...nftRead,
    functionName: "activationsOf",
    args: mine.length > 0 ? [mine] : undefined,
    query: { enabled: !!nft && mine.length > 0 },
  });

  const tokens: BrokerToken[] = useMemo(() => {
    const blocks = activations.data as readonly bigint[] | undefined;
    return mine.map((id, i) => ({ id: Number(id), activatedAt: blocks?.[i] ?? 0n }));
  }, [mine, activations.data]);

  const views = brokerViews(tokens, METADATA_ORIGIN);
  const activeCount = views.filter((v) => v.activated).length;

  const mintState = deriveMintState({
    sale,
    open: saleOpen.data as boolean | undefined,
    mintedByWallet: mintedByWallet.data as bigint | undefined,
    perWalletCap: perWalletCap.data as bigint | undefined,
    totalMinted: minted,
    maxSupply: maxSupply.data as bigint | undefined,
    walletReady: onChain,
  });

  const busy = stage === "pending";
  useHoldCriticalOp(busy, "locked");

  const mint = async () => {
    if (!sale || !publicClient) return;
    setStage("pending");
    setErr(undefined);
    try {
      const tx = await writeContractAsync({
        address: sale,
        abi: brokerSaleAbi,
        functionName: "mint",
        chainId: BROKER_CHAIN,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        setStage("error");
        setErr("The mint reverted — nothing was charged and nothing changed.");
        return;
      }
      setStage("done");
      void totalMinted.refetch();
      void mintedByWallet.refetch();
      void owners.refetch();
    } catch (e) {
      setStage("error");
      const m = e as { shortMessage?: string; message?: string } | null;
      setErr(m?.shortMessage ?? m?.message ?? "The mint failed.");
    }
  };

  const supplyLabel =
    mintState.mintedSoFar === undefined || mintState.supply === undefined
      ? "…"
      : `${mintState.mintedSoFar.toLocaleString()} / ${mintState.supply.toLocaleString()}`;

  if (!BROKER_ON_THIS_BUILD) {
    return (
      <div className="page">
        <div className="pagehead">
          <div>
            <h1>Sparky Broker</h1>
            <div className="sub">Coming soon to Robinhood mainnet</div>
          </div>
        </div>
        <div className="card card-pad" style={{ marginTop: 12, fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
          The Sparky Broker NFT isn&rsquo;t part of the Robinhood mainnet beta yet — it launches on OpenSea in a later
          step. There&rsquo;s nothing to mint or activate on this network right now.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Sparky Broker</h1>
          <div className="sub">
            5,555 brokers. Retiring SRK activates one, permanently: Premium for as long as you hold
            it, with nothing to renew. Sell it and the activation clears — the next owner retires
            their own.
          </div>
        </div>
      </div>

      {!nft ? (
        <div className="card card-pad">
          <div className="payrow">
            <span className="muted">Sparky Broker on this network</span>
            <span>Unavailable — the collection lives on {chainName(BROKER_CHAIN)}</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── mint ─────────────────────────────────────────────────────────────── */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="card-hd">
              <span className="t">Claim a desk on the floor</span>
              <span className="lbl">{chainName(BROKER_CHAIN)}</span>
            </div>

            <div className="payrow">
              <span className="muted">Minted</span>
              <span className="tnum">{supplyLabel}</span>
            </div>
            <div className="payrow">
              <span className="muted">Price</span>
              <span className="tnum">Free</span>
            </div>
            <div className="payrow">
              <span className="muted">This wallet may mint</span>
              <span className="tnum">
                {mintState.loaded ? `${mintState.remaining} more` : "…"}
              </span>
            </div>

            <button
              className="btn btn-primary btn-md"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!mintState.canMint || busy}
              onClick={() => void mint()}
            >
              {busy ? "Confirm in your wallet…" : "Mint a broker"}
            </button>

            <div
              style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}
            >
              {mintState.blockedReason ??
                "Free to mint, and open to anyone. A new broker arrives inactive — activating it is a separate, deliberate step."}
            </div>

            {stage === "done" && (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--gain)" }}>
                ✓ Minted. It’s inactive until you retire SRK against it.
              </div>
            )}
            {stage === "error" && err && (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--loss)" }}>{err}</div>
            )}
          </div>

          {/* ── your brokers ─────────────────────────────────────────────────────── */}
          <div className="card card-pad">
            <div className="card-hd">
              <span className="t">
                Your brokers{tokens.length > 0 ? ` · ${tokens.length}` : ""}
              </span>
              {tokens.length > 0 && (
                <span className="lbl">
                  {activeCount === 0
                    ? "None activated"
                    : activeCount === tokens.length
                      ? "All activated"
                      : `${activeCount} activated`}
                </span>
              )}
            </div>

            {!isConnected ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Connect a wallet to see the brokers you hold.
              </div>
            ) : owners.isLoading || activations.isLoading ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Reading the chain…
              </div>
            ) : tokens.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                You don’t hold a broker yet.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  {views.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => router.push(`/brokers/${v.id}/activate`)}
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 10,
                        padding: 8,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the
                          collection's own deploy, deliberately not through this app's image
                          optimiser (which would proxy it back through the gated middleware). */}
                      <img
                        src={v.imagePath}
                        alt={`Sparky Broker ${v.label}${v.activated ? ", activated" : ""}`}
                        width={240}
                        height={240}
                        style={{
                          width: "100%",
                          height: "auto",
                          display: "block",
                          borderRadius: 6,
                          imageRendering: "pixelated",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 7,
                          fontSize: 11,
                        }}
                      >
                        <span className="mono" style={{ color: "var(--muted-foreground)" }}>
                          {v.label}
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 9.5,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            padding: "2px 6px",
                            borderRadius: 999,
                            fontWeight: v.activated ? 700 : 400,
                            background: v.activated ? "var(--warn)" : "transparent",
                            color: v.activated ? "#0B1120" : "var(--muted-foreground)",
                            border: v.activated ? "none" : "1px solid var(--border-soft)",
                          }}
                        >
                          {v.statusLabel}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    fontSize: 11.5,
                    color: "var(--muted-foreground)",
                    lineHeight: 1.5,
                  }}
                >
                  An activated broker wears a two-pixel gold frame — the picture and the entitlement
                  are the same fact. Activation state is read from the chain on every load, never
                  from a stored flag.
                </div>
              </>
            )}

            {truncated && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--loss)" }}>
                Showing brokers among the first {OWNERSHIP_SCAN_LIMIT.toLocaleString()} minted only —
                this list is incomplete.
              </div>
            )}

            {nft && (
              <div className="payrow" style={{ marginTop: 12 }}>
                <span className="muted">Collection</span>
                {explorerAddressUrl(BROKER_CHAIN, nft) ? (
                  <a
                    className="mono"
                    href={explorerAddressUrl(BROKER_CHAIN, nft)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--primary)", fontSize: 11 }}
                  >
                    {nft.slice(0, 6)}…{nft.slice(-4)} ↗
                  </a>
                ) : (
                  <span className="mono" style={{ fontSize: 11 }}>
                    {nft.slice(0, 6)}…{nft.slice(-4)}
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
