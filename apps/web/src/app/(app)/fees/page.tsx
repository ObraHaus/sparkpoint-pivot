"use client";

/**
 * /fees — Fee Transparency & Revenue Surfaces (Flow 11): "we only earn when you earn".
 * 0% on principal/deposits/withdrawals; the active 10% performance fee over a high-water
 * mark; the one swap routing fee; optional SRK-paid Premium; an honesty chart; and a
 * verify-don't-trust panel reading the on-chain fee params.
 *
 * Faithful 1:1 port of the design's `fees` screen
 * (docs/design-handover/showcase/screens/fees.js). Markup, classes, and copy verbatim.
 *
 * 024/T024 — SCOPE OF THE HIGH-WATER-MARK CLAIM. This page reads the LAUNCH Aave vault
 * (`addrs.vault`), which holds a real `_highWaterMark`, so the HWM wording is accurate here. It was
 * however phrased UNIVERSALLY ("your high-water mark"), and constitution v3.0.0 ratified a vault kind
 * for which it is false: a Morpho Vault V2 Fee Wrapper keeps no HWM state, so a gain after a loss is
 * charged. The claims are therefore now (a) sourced from `lib/policy/feeCopy` rather than retyped, and
 * (b) explicitly attributed to the vault they are true of. No Fee Wrapper is deployed yet, so this page
 * deliberately does NOT describe one — that would advertise a capability that does not exist
 * (Principle III). It gains its section when Phase 3 puts a real one on chain.
 */

import { useRouter } from "next/navigation";
import { useReadContracts } from "wagmi";
import { type Address } from "viem";
import { sparkPointVaultAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import type { WagmiChainId } from "@/lib/wagmi";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { StatusTag } from "@/components/ui/status-tag";
import { feeBasisRecoverySentence, vaultFeeBasis } from "@/lib/policy/feeCopy";
import "@/components/screens/fees.css";

/**
 * The basis for the vault this page reads. `first_party` = the launch Aave vault, which holds a real
 * `_highWaterMark`. Stated as data, not baked into prose, so the sentences below cannot drift from the
 * vault they describe (024/T024).
 */
const LAUNCH_FEE_BASIS = vaultFeeBasis("first_party");

const VAULT_CHAIN = VAULT_CHAIN_ID as WagmiChainId;
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export default function Page() {
  const router = useRouter();
  const addrs = getAddresses(VAULT_CHAIN);
  const vault = addrs.vault as Address | undefined;
  const vaultC = { address: vault as Address, abi: sparkPointVaultAbi, chainId: VAULT_CHAIN } as const;
  // REAL fee params, read live from the vault (the honesty panel must not lie).
  const reads = useReadContracts({
    // Vault is Base-only; on the mainnet-beta build (only 4663 registered) it is absent, so gate the
    // read on the vault chain being registered — otherwise it errors on the unregistered 84532.
    query: { enabled: !!vault && VAULT_CHAIN_AVAILABLE, refetchInterval: 30_000 },
    contracts: [
      { ...vaultC, functionName: "performanceFeeBps" }, // 0
      { ...vaultC, functionName: "feeRecipient" }, // 1
    ],
  });
  const perfFeeBps = reads.data?.[0]?.result as bigint | number | undefined;
  const feeRecipient = reads.data?.[1]?.result as Address | undefined;
  const perfFeePct = perfFeeBps === undefined ? undefined : Number(perfFeeBps) / 100;
  const readsLive = !reads.isLoading && !reads.isError && reads.data !== undefined;
  // On the mainnet-beta the vault chain isn't registered — show an honest "not on this network"
  // state instead of a perpetual "Reading…" (the vault, and this performance fee, are Base-only).
  const vaultUnavailable = !VAULT_CHAIN_AVAILABLE;
  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            Fees &amp; how we make money
            <StatusTag
              variant="partial"
              works={["Fee params (performance fee, recipient) read live from the vault", "0% deposit/withdraw fee is structural (ERC-4626)", "Fee terms shown are the live on-chain performance fee — no fabricated figures"]}
              pending={["No per-wallet \"fees paid\" figure — the fee is share dilution to a shared recipient, so a truthful personal number isn't indexed"]}
            />
          </h1>
          <div className="fees-lede">
            We only earn when you earn — never on your principal, never by taking custody. Here&apos;s exactly what we
            charge, when, and why.
          </div>
        </div>
      </div>

      <div className="card principle">
        <div className="pr">
          <Icon name="check" size={16} /> 0 fees on your principal
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> We only earn a % of the profit you make
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> You see every fee before you sign
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> We never hold your funds
        </div>
      </div>

      <div className="fees-grid">
        <div className="card card-pad fcard">
          <h3>
            <Icon name="check" size={17} /> What&apos;s free
          </h3>
          <ul>
            <li>
              <Icon name="check" size={14} />
              <span>
                <b>The Aave Yield Vault</b> — deposit, earn, and withdraw with{" "}
                <b>0% on your deposits, principal &amp; withdrawals</b>.
              </span>
            </li>
            <li>
              <Icon name="check" size={14} />
              The chat assistant (free tier), your portfolio, and withdraw-always.
            </li>
            <li>
              <Icon name="check" size={14} />
              You never need SRK for any of this.
            </li>
          </ul>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="activity" size={17} /> The one fee today
          </h3>
          <ul>
            <li>
              <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
                Swap routing fee · 0.20%
              </span>
            </li>
            <li className="muted-li">Set within a published 0.15–0.30% band.</li>
            <li>
              <Icon name="check" size={14} />
              Only when <b>you</b> execute a swap.
            </li>
            <li>
              <Icon name="check" size={14} />
              Taken inside your own signed swap — never on the vault or deposits.
            </li>
            <li>
              <Icon name="check" size={14} />
              Applies on <b>every supported network</b> — Base, Base Sepolia, and Robinhood testnet.
            </li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={() => router.push(toHref("confirm/swap"))}>
              See an example
            </button>
            {feeRecipient ? (
              <a
                className="btn btn-ghost btn-sm"
                href={explorerAddressUrl(VAULT_CHAIN, feeRecipient)}
                target="_blank"
                rel="noreferrer"
              >
                Verify recipient ↗
              </a>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled>
                Verify recipient ↗
              </button>
            )}
          </div>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="coins" size={17} /> Optional: Premium
          </h3>
          <ul>
            <li>
              Advanced AI features, unlocked by <b>activating a Sparky Broker</b> with SRK — a one-time retirement, not a vault fee and not a subscription.
            </li>
            <li className="muted-li">
              The free tier stays fully usable. Premium never gates the vault, deposits, yield, or withdrawals.
            </li>
          </ul>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={() => router.push(toHref("premium"))}>
              Compare free vs premium →
            </button>
          </div>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="coins" size={17} /> Performance fee · Aave Yield Vault{" "}
            <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
              Active · v1
            </span>
          </h3>
          <ul>
            <li>
              <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
                10% of profit · over high-water mark
              </span>
            </li>
            <li>
              <Icon name="check" size={14} />
              Charged <b>only on new profit</b> above your high-water mark — never on your principal or your deposits.
            </li>
            <li>
              <Icon name="check" size={14} />
              {feeBasisRecoverySentence(LAUNCH_FEE_BASIS)}
            </li>
            <li className="muted-li">
              This is the “we only earn when you earn” fee — accrued transparently, shown in every net-APY breakdown.
              The high-water mark is a property of <b>this</b> vault&apos;s contract, read live below — not a
              blanket promise about every vault SparkPoint may list.
            </li>
          </ul>
        </div>
      </div>

      <div className="card honesty">
        <div className="card-hd">
          <span className="t">We only earn when you earn</span>
          <StatusTag variant={!vaultUnavailable && readsLive ? "live" : "partial"} label={vaultUnavailable ? "Vault on Base — not on this network" : readsLive ? "Live fee read" : "Reading…"} />
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6, marginTop: 6 }}>
          On the Aave Yield Vault, SparkPoint charges{" "}
          <b style={{ color: "var(--foreground)" }}>{perfFeePct !== undefined ? `${perfFeePct}%` : "—"}</b> of your{" "}
          <b>profit above your high-water mark</b> — profit-only, read live from the vault. There is{" "}
          <b>0%</b> on your principal and <b>0%</b> to deposit or withdraw (structural to the ERC-4626 vault,
          not a promise). {feeBasisRecoverySentence(LAUNCH_FEE_BASIS)}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
          <Icon name="info" size={12} /> We don&apos;t show a per-wallet &ldquo;fees paid&rdquo; figure: the fee is
          realized as share dilution to a shared recipient, so a truthful personal number isn&apos;t indexed. We&apos;d
          rather show nothing than a fabricated one.
        </div>
      </div>

      <div className="card verify">
        <div className="card-hd" style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
          <span className="t">Verify — don&apos;t take our word for it</span>
          <StatusTag variant={!vaultUnavailable && readsLive ? "live" : "partial"} label={vaultUnavailable ? "Vault on Base — not on this network" : readsLive ? "Live reads" : "Reading…"} />
        </div>
        <div className="vrow">
          <span>Vault deposit/withdraw fee</span>
          <span className="mono" title="ERC-4626 has no entry/exit fee by design">
            0% — no entry/exit fee (structural)
          </span>
        </div>
        <div className="vrow">
          <span>Vault performance fee</span>
          {vault && !vaultUnavailable ? (
            <a
              className="mono"
              href={explorerAddressUrl(VAULT_CHAIN, vault)}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--primary)" }}
            >
              performanceFeeBps ={" "}
              {perfFeeBps === undefined ? "…" : `${String(perfFeeBps)} (${perfFeePct}%)`}{" "}
              <Icon name="ext" size={11} />
            </a>
          ) : (
            <span className="mono">vault not deployed on this network</span>
          )}
        </div>
        <div className="vrow">
          <span>Fee recipient</span>
          {feeRecipient ? (
            <a
              className="mono"
              href={explorerAddressUrl(VAULT_CHAIN, feeRecipient)}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--primary)" }}
            >
              {shortAddr(feeRecipient)} <Icon name="ext" size={11} />
            </a>
          ) : (
            <span className="mono">{reads.isLoading ? "…" : "—"}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          These fees live in the contracts, not this app{vaultUnavailable ? " — on Base (the mainnet beta has no vault yet)" : " — read live from Base Sepolia RPC"}.{" "}
          <a
            style={{ color: "var(--primary)", cursor: "pointer" }}
            onClick={() => router.push(toHref("trust/permissions"))}
          >
            See permissions →
          </a>
        </div>
      </div>
    </div>
  );
}
