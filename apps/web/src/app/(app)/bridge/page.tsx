"use client";

/**
 * /bridge — during Alpha this is NOT a live bridge. The old Base↔Sui form was a full mock (fixture
 * balances, a fabricated $0.40 fee), so it's replaced with an honest "unavailable during Alpha"
 * notice + a real, chain-keyed FAUCETS panel so a tester can actually fund a testnet wallet. Bridging
 * ships later; Sui is a fast-follow. The route + nav entry stay. (R5 A5.)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useNetwork } from "@/lib/network";
import { wagmiConfig } from "@/lib/wagmi";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { StatusTag } from "@/components/ui/status-tag";
import { stageCopy } from "@/lib/stage";
import "@/components/screens/bridge.css";

const BASE_SEPOLIA = 84532;
const ROBINHOOD_TESTNET = 46630;

interface FaucetLink {
  label: string;
  href: string;
  note?: string;
}

function FaucetCard({ title, subtitle, links }: { title: string; subtitle: string; links: FaucetLink[] }) {
  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div className="card-hd">
        <span className="t">{title}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "2px 0 10px" }}>{subtitle}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border-soft)",
              color: "var(--foreground)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            <Icon name="ext" size={14} />
            <span style={{ flex: 1 }}>
              {l.label}
              {l.note && (
                <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
                  {l.note}
                </span>
              )}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** Aave-market test faucet: `mint(token, to, amount)` mints straight to `to` (the connecting wallet). */
const FAUCET_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** One-click mint amount: 1,000 test USDC (6 decimals) — well above the per-user vault cap. */
const MINT_AMOUNT = 1_000n * 10n ** 6n;

function shortErr(e: unknown): string {
  const a = e as { shortMessage?: string; message?: string } | null;
  const m = a?.shortMessage ?? a?.message ?? "Transaction failed.";
  return m.length > 140 ? `${m.slice(0, 137)}…` : m;
}

/**
 * One-click, user-signed mint of the Aave-market test USDC (replaces sending the tester to Basescan's
 * raw writeContract). Non-custodial: the user signs `mint(usdc, theirAddress, 1000e6)` and the USDC
 * lands straight in their wallet. Only enabled while the wallet is on the faucet chain (Base Sepolia).
 */
function MintTestUsdcButton({ faucet, usdc, chainId }: { faucet: Address; usdc: Address; chainId: WagmiChainId }) {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const onChain = isConnected && walletChain === chainId;
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId });
  const [stage, setStage] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [err, setErr] = useState<string>();
  const [txHash, setTxHash] = useState<Hex>();
  const bal = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isConnected && !!address },
  });
  const usdcBalance = bal.data !== undefined ? Number(formatUnits(bal.data as bigint, 6)) : undefined;

  const mint = async () => {
    if (!address || !publicClient) return;
    setStage("pending");
    setErr(undefined);
    setTxHash(undefined);
    try {
      const tx = await writeContractAsync({
        address: faucet,
        abi: FAUCET_MINT_ABI,
        functionName: "mint",
        args: [usdc, address, MINT_AMOUNT],
        chainId,
      });
      setTxHash(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        setStage("error");
        setErr("The mint reverted — the faucet enforces a per-address cooldown. Try again later, or swap ETH → USDC below.");
        return;
      }
      setStage("done");
      void bal.refetch();
    } catch (e) {
      setStage("error");
      setErr(shortErr(e));
    }
  };

  const busy = stage === "pending";
  const receiptUrl = txHash ? explorerTxUrl(chainId, txHash) : undefined;
  return (
    <div>
      <button className="btn btn-primary btn-md" style={{ width: "100%" }} disabled={!onChain || busy} onClick={mint}>
        {busy ? "Confirm in your wallet…" : "Mint 1,000 test USDC"}
      </button>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        {!isConnected
          ? "Connect your wallet to mint."
          : !onChain
            ? "Switch your wallet to Base Sepolia to mint."
            : usdcBalance !== undefined
              ? `You sign; the USDC lands in your wallet (SparkPoint holds nothing). Balance: ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC.`
              : "You sign; the USDC lands straight in your wallet — SparkPoint holds nothing."}
      </div>
      {stage === "done" && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--gain)" }}>
          ✓ Minted 1,000 test USDC to your wallet.{" "}
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
    </div>
  );
}

/** Hint that the swap page can also turn ETH into USDC (works on Base Sepolia + Robinhood testnet). */
function SwapHint({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--border-soft)",
        fontSize: 12.5,
        color: "var(--muted-foreground)",
        lineHeight: 1.55,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: "var(--primary)", flex: "none", marginTop: 1 }}>
        <Icon name="swap" size={14} />
      </span>
      <span>
        Prefer to swap? You can swap <b>ETH → USDC</b> on the{" "}
        <a onClick={() => router.push(toHref("swap"))} style={{ color: "var(--primary)", cursor: "pointer" }}>
          Swap page
        </a>{" "}
        — real on-chain swaps on Base Sepolia and Robinhood testnet.
      </span>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const { chainId, isConnected } = useNetwork();
  const addrs = getAddresses(BASE_SEPOLIA);
  const usdc = addrs.usdc;
  const faucet = addrs.usdcFaucet;

  // Which faucet set to show — follow the connected chain; default to Base Sepolia otherwise.
  const onRobinhood = chainId === ROBINHOOD_TESTNET;

  const baseSepoliaEth: FaucetLink[] = [
    { label: "Base Sepolia faucet list (Base docs)", href: "https://docs.base.org/chain/network-faucets" },
    { label: "Coinbase Developer Platform faucet", href: "https://portal.cdp.coinbase.com/products/faucet", note: "Base Sepolia ETH" },
    { label: "Alchemy Base Sepolia faucet", href: "https://www.alchemy.com/faucets/base-sepolia", note: "Base Sepolia ETH" },
  ];
  const robinhood: FaucetLink[] = [
    { label: "Robinhood Chain testnet faucet (official)", href: "https://faucet.testnet.chain.robinhood.com/", note: "browser-only, bot-challenged — amounts are per the faucet site" },
    { label: "Chainlink faucets", href: "https://faucets.chain.link/", note: "select the Robinhood testnet if listed" },
  ];

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Bridge
            <StatusTag variant="mock" label={`Unavailable during ${stageCopy.label}`} />
          </h1>
          <div className="sub">Cross-network bridging (Base ↔ Sui) ships after Alpha. Sui is a fast-follow.</div>
        </div>
      </div>

      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          background: "var(--caution-subtle)",
          borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)",
        }}
      >
        <span style={{ color: "var(--caution)", marginTop: 1 }}>
          <Icon name="info" size={18} />
        </span>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
          <b style={{ color: "var(--foreground)" }}>Bridging isn’t available during Alpha.</b> SparkPoint is
          testnet-only right now (Base Sepolia). In the meantime, use the faucets below to fund a testnet wallet so
          you can try the vault. When bridging ships it will be fully self-custodial — you sign, funds land in your own
          wallet on the other side.
        </div>
      </div>

      <div className="pagehead" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Testnet faucets</h2>
          <div className="sub">
            {isConnected
              ? onRobinhood
                ? "For your connected wallet on Robinhood Chain testnet."
                : "For your connected wallet on Base Sepolia."
              : "Connect a wallet to auto-select faucets for its network. Showing Base Sepolia by default."}
          </div>
        </div>
      </div>

      {onRobinhood ? (
        <>
          <FaucetCard
            title="Robinhood Chain testnet — native ETH"
            subtitle="Chain 46630 · Arbitrum-Nitro L2 on Sepolia · native ETH pays gas."
            links={robinhood}
          />
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
              You can also bring Sepolia ETH over via the canonical Arbitrum bridge (~10 min). There is no official Circle
              USDC or Aave market on this testnet yet, so the vault stays Base-only during Alpha.
            </div>
            <SwapHint router={router} />
          </div>
        </>
      ) : (
        <>
          <FaucetCard
            title="Base Sepolia — native ETH (for gas)"
            subtitle="You need a little Base Sepolia ETH to pay gas before depositing."
            links={baseSepoliaEth}
          />
          {faucet && (
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <div className="card-hd">
                <span className="t">Base Sepolia — test USDC (to deposit)</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "2px 0 12px" }}>
                The vault accepts the Aave-market test USDC. Mint 1,000 to your wallet in one click — you sign, it lands
                in your wallet — then deposit in the vault.
              </div>
              <MintTestUsdcButton faucet={faucet} usdc={usdc} chainId={BASE_SEPOLIA} />
              <SwapHint router={router} />
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 6 }}>
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("vault"))}>
          Go to the vault →
        </button>
      </div>
    </div>
  );
}
