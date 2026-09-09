"use client";

/**
 * /trust/exit — Withdraw / Exit: the normal in-app withdrawal plus the on-chain,
 * backend-independent self-service exit (withdraw-always).
 *
 * Faithful 1:1 port of the design's `trust/exit` screen
 * (docs/design-handover/showcase/screens/trust.js). The three-step on-chain
 * redeem(shares, you, you) exit is reproduced verbatim.
 */

import { useRouter } from "next/navigation";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";

const VAULT_CHAIN = VAULT_CHAIN_ID;

export default function Page() {
  const router = useRouter();
  const vault = getAddresses(VAULT_CHAIN).vault;

  return (
    <div className="page page-narrow">
      <a
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14 }}
        onClick={() => router.push(toHref("trust"))}
      >
        <Icon name="chevr" size={15} /> Back to Trust Center
      </a>
      <div className="pagehead">
        <div>
          <h1>Withdraw / Exit</h1>
          <div className="sub">Withdraw anytime — even if Sparky is offline.</div>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-hd">
          <span className="t">Normal withdrawal</span>
          <span className="pill ghosty" style={{ cursor: "default" }}>
            <Icon name="check" size={13} /> Recommended
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.55, marginBottom: 14 }}>
          Withdraw through the app — simulated, guardrail-checked, and signed by you. Funds land back in your wallet.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("vault/withdraw"))}>
            Withdraw USDC
          </button>
          <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("vault/withdraw"))}>
            Withdraw everything
          </button>
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">On-chain self-service exit</span>
          <span className="pill ghosty" style={{ cursor: "default" }}>
            <Icon name="lock" size={13} /> Backend-independent
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.55, marginBottom: 6 }}>
          If our app and AI are entirely offline, you can still redeem directly from the vault contract using any tool
          (e.g. Etherscan&apos;s write tab).
        </div>
        <div className="exit-step">
          <span className="num">1</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Open the vault on Basescan</div>
            {vault ? (
              <a
                className="mono"
                style={{ fontSize: 12, color: "var(--primary)", marginTop: 3, display: "inline-flex", gap: 4 }}
                href={explorerAddressUrl(VAULT_CHAIN, vault)}
                target="_blank"
                rel="noreferrer"
              >
                {vault} <Icon name="ext" size={11} />
              </a>
            ) : (
              <div className="mono" style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3 }}>
                vault not deployed on this network
              </div>
            )}
          </div>
        </div>
        <div className="exit-step">
          <span className="num">2</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              Call <span className="mono">redeem(shares, you, you)</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3 }}>
              Burns your spvUSDC, sends USDC to your address.
            </div>
          </div>
        </div>
        <div className="exit-step" style={{ borderBottom: "none" }}>
          <span className="num">3</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sign with your wallet</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3 }}>
              No Sparky involvement required.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
