"use client";

/**
 * /brokers/[id]/activate — the confirm step (feature 043, US2).
 *
 * Same shape as the app's other money gates: what leaves your wallet, what you get, what ends it,
 * on which network. Two things here are load-bearing rather than decorative:
 *
 *   1. **The price is read LIVE from the registry at the moment of signing** (FR-015), never
 *      hardcoded and never carried over from a previous render. The contract's price is
 *      owner-settable under an immutable cap, so a quoted number that came from anywhere else could
 *      be stale — and a holder must never be charged more than the amount they were shown.
 *
 *   2. **"Retired", never "burned".** The SRK moves to an address nobody controls; the token has no
 *      burn function and its total supply is unchanged (a contract fuzz test asserts exactly that).
 *      Saying "burned" would be a supply claim that is not true.
 */

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS, chainName } from "@sparkpoint/shared/chains";
import { brokerActivationRegistryAbi, sparkyBrokerAbi } from "@sparkpoint/shared/abis";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { brokerView, deriveActivateState, formatSrk } from "@/lib/chain/brokers";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";

const BROKER_CHAIN = CHAIN_IDS.robinhoodTestnet;
const METADATA_ORIGIN =
  process.env.NEXT_PUBLIC_BROKER_METADATA_ORIGIN ?? "https://brokers-dev.aldrickb.app";
const DEAD = "0x000000000000000000000000000000000000dEaD";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tokenId = Number(id);
  const router = useRouter();

  const { address, isConnected, chainId: walletChain } = useAccount();
  const owner = address as Address | undefined;

  let book;
  try {
    book = getAddresses(BROKER_CHAIN);
  } catch {
    book = undefined;
  }
  const nft = book?.brokerNft as Address | undefined;
  const registry = book?.brokerRegistry as Address | undefined;
  const srk = book?.srk as Address | undefined;
  const onChain = isConnected && walletChain === BROKER_CHAIN;

  const publicClient = usePublicClient({ chainId: BROKER_CHAIN });
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<"idle" | "approving" | "activating" | "done" | "error">("idle");
  const [err, setErr] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();

  const valid = Number.isInteger(tokenId) && tokenId > 0;

  // The price, live from the chain. Refetched often enough that a long-open tab cannot quote a
  // stale number at the moment the holder signs.
  const price = useReadContract({
    address: registry,
    abi: brokerActivationRegistryAbi,
    functionName: "price",
    chainId: BROKER_CHAIN,
    query: { enabled: !!registry, refetchInterval: 15_000 },
  });

  const tokenOwner = useReadContract({
    address: nft,
    abi: sparkyBrokerAbi,
    functionName: "ownerOf",
    args: valid ? [BigInt(tokenId)] : undefined,
    chainId: BROKER_CHAIN,
    query: { enabled: !!nft && valid },
  });

  const activatedAt = useReadContract({
    address: nft,
    abi: sparkyBrokerAbi,
    functionName: "activatedAt",
    args: valid ? [BigInt(tokenId)] : undefined,
    chainId: BROKER_CHAIN,
    query: { enabled: !!nft && valid },
  });

  const balance = useReadContract({
    address: srk,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId: BROKER_CHAIN,
    query: { enabled: !!srk && !!owner, refetchInterval: 15_000 },
  });

  const allowance = useReadContract({
    address: srk,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && registry ? [owner, registry] : undefined,
    chainId: BROKER_CHAIN,
    query: { enabled: !!srk && !!owner && !!registry },
  });

  const ownsToken =
    tokenOwner.data === undefined
      ? undefined
      : String(tokenOwner.data).toLowerCase() === (owner ?? "").toLowerCase();
  const activatedBlock = activatedAt.data as bigint | undefined;

  const state = deriveActivateState({
    registry,
    price: price.data as bigint | undefined,
    balance: balance.data as bigint | undefined,
    allowance: allowance.data as bigint | undefined,
    ownsToken,
    alreadyActivated: activatedBlock === undefined ? undefined : activatedBlock > 0n,
    walletReady: onChain,
  });

  const busy = stage === "approving" || stage === "activating";
  useHoldCriticalOp(busy, "locked");

  const view = brokerView({ id: tokenId, activatedAt: activatedBlock ?? 0n }, METADATA_ORIGIN);

  const run = async () => {
    if (!registry || !srk || !publicClient) return;
    // Read the price ONE more time, immediately before signing. Everything above is display; this
    // is the number that will actually be charged.
    const live = await publicClient.readContract({
      address: registry,
      abi: brokerActivationRegistryAbi,
      functionName: "price",
    });
    setErr(undefined);
    try {
      if (state.needsApproval) {
        setStage("approving");
        // Approve EXACTLY the price — no infinite approval. The registry spends it in the same
        // transaction it is granted for, so there is never a standing allowance to a contract.
        const approveTx = await writeContractAsync({
          address: srk,
          abi: erc20Abi,
          functionName: "approve",
          args: [registry, live],
          chainId: BROKER_CHAIN,
        });
        const r = await publicClient.waitForTransactionReceipt({ hash: approveTx });
        if (r.status === "reverted") {
          setStage("error");
          setErr("The approval reverted — nothing was spent.");
          return;
        }
      }

      setStage("activating");
      const tx = await writeContractAsync({
        address: registry,
        abi: brokerActivationRegistryAbi,
        functionName: "activate",
        args: [BigInt(tokenId)],
        chainId: BROKER_CHAIN,
      });
      setTxHash(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        setStage("error");
        setErr("The activation reverted — your SRK was not spent and nothing changed.");
        return;
      }
      setStage("done");
      void activatedAt.refetch();
      void balance.refetch();
      void allowance.refetch();
    } catch (e) {
      setStage("error");
      const m = e as { shortMessage?: string; message?: string } | null;
      setErr(m?.shortMessage ?? m?.message ?? "The activation failed.");
    }
  };

  if (!valid) {
    return (
      <div className="page page-narrow">
        <div className="card card-pad">That isn’t a broker id.</div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <a
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14, cursor: "pointer" }}
        onClick={() => router.push("/brokers")}
      >
        <Icon name="chevr" size={15} /> Back
      </a>

      <div className="pagehead">
        <div>
          <h1>Activate broker {view.label}</h1>
          <div className="sub">
            {state.loaded && activatedBlock !== undefined && activatedBlock > 0n
              ? "This broker is already active."
              : `Retire ${formatSrk(price.data as bigint | undefined)} to switch it on.`}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 20, alignItems: "start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the collection's own deploy */}
          <img
            src={view.imagePath}
            alt={`Sparky Broker ${view.label}`}
            width={160}
            height={160}
            style={{ width: "100%", height: "auto", borderRadius: 10, imageRendering: "pixelated" }}
          />
          <div>
            <div className="payrow">
              <span className="muted">You send</span>
              <span className="tnum">
                {formatSrk(price.data as bigint | undefined)} →{" "}
                <span className="mono" title={DEAD}>
                  0x…dEaD
                </span>
              </span>
            </div>
            <div className="payrow">
              <span className="muted">You get</span>
              <span>Premium, and a payout weight, while you hold this broker</span>
            </div>
            <div className="payrow">
              <span className="muted">On sale</span>
              <span>Activation clears. The buyer retires their own.</span>
            </div>
            <div className="payrow">
              <span className="muted">Network</span>
              <span>{chainName(BROKER_CHAIN)}</span>
            </div>
            <div className="payrow">
              <span className="muted">Your SRK</span>
              <span className="tnum">{formatSrk(balance.data as bigint | undefined)}</span>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary btn-md"
                disabled={!state.canActivate || busy}
                onClick={() => void run()}
              >
                {stage === "approving"
                  ? "Approve in your wallet…"
                  : stage === "activating"
                    ? "Confirm the activation…"
                    : state.needsApproval
                      ? "Approve & activate"
                      : "Activate"}
              </button>
              <button className="btn btn-md" onClick={() => router.push("/brokers")} disabled={busy}>
                Cancel
              </button>
            </div>

            <div
              style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}
            >
              {state.blockedReason ??
                "You sign; the SRK goes straight to an address nobody controls. SparkPoint never holds it, and never holds your broker."}
            </div>

            {state.short > 0n && (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--loss)" }}>
                You need {formatSrk(state.short)} more.{" "}
                <a className="cite" onClick={() => router.push(toHref("premium"))} style={{ cursor: "pointer" }}>
                  Claim SRK from the faucet ↗
                </a>
              </div>
            )}

            {stage === "done" && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--gain)" }}>
                ✓ Activated. Premium is on now, with no expiry date.{" "}
                {txHash && explorerTxUrl(BROKER_CHAIN, txHash) && (
                  <a
                    href={explorerTxUrl(BROKER_CHAIN, txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="cite"
                  >
                    View tx ↗
                  </a>
                )}
              </div>
            )}
            {stage === "error" && err && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--loss)" }}>{err}</div>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border-soft)",
            fontSize: 11.5,
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
          }}
        >
          This is <b>not</b> a subscription. Nothing renews and nothing expires — it ends when you
          transfer the broker, and the next owner retires their own SRK. The SRK is{" "}
          <b>retired</b>, not burned: it moves to an address nobody controls, and the token’s total
          supply does not change.
        </div>
      </div>
    </div>
  );
}
