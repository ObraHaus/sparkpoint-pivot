"use client";

/**
 * /bridge — during Alpha this is NOT a live bridge. The old Base↔Sui form was a full mock (fixture
 * balances, a fabricated $0.40 fee), so it's replaced with an honest "unavailable during Alpha"
 * notice + a real, chain-keyed FAUCETS panel so a tester can actually fund a testnet wallet. Bridging
 * ships later; Sui is a fast-follow. The route + nav entry stay. (R5 A5.)
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useNetwork } from "@/lib/network";
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
  const baseSepoliaUsdc: FaucetLink[] = faucet
    ? [
        {
          label: "Mint test USDC (Aave-market faucet)",
          href: `https://sepolia.basescan.org/address/${faucet}#writeContract`,
          note: `Call mint(token, to, amount) with token = ${usdc} · 6 decimals · per-address timelock`,
        },
      ]
    : [];
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
          <div className="card card-pad" style={{ marginBottom: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.55 }}>
            You can also bring Sepolia ETH over via the canonical Arbitrum bridge (~10 min). There is no official Circle
            USDC or Aave market on this testnet yet, so the vault stays Base-only during Alpha.
          </div>
        </>
      ) : (
        <>
          <FaucetCard
            title="Base Sepolia — native ETH (for gas)"
            subtitle="You need a little Base Sepolia ETH to pay gas before depositing."
            links={baseSepoliaEth}
          />
          {baseSepoliaUsdc.length > 0 && (
            <FaucetCard
              title="Base Sepolia — test USDC (to deposit)"
              subtitle="The vault accepts the Aave-market test USDC. Mint some to your wallet, then deposit in the vault."
              links={baseSepoliaUsdc}
            />
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
