/**
 * /srk — what the SRK utility token is, and (more importantly) what it is NOT. Informational only.
 *
 * Feature 026 split this screen: the live balance, the faucet and the acquire flow all moved to
 * the Premium page, next to the thing SRK actually buys. What stayed is the explainer — and the dead
 * bits went with it (the hardcoded "0 SRK" balance card and the "How to earn" button that did
 * nothing were showcase leftovers, and a fabricated balance on a trust surface is worse than none).
 * The route is unchanged and is listed under the rail's "Information" group.
 */

import Link from "next/link";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { SrkFaucetCard } from "@/components/premium/SrkFaucetCard";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/support.css";

/** SRK is Base-Sepolia-only by design (a fixed-supply TEST token, hand-distributed). */
const SRK_CHAIN = 84532;

const FACTS: [string, string][] = [
  [
    "It never gates the product",
    "The vault, deposits, yield, withdrawals, onboarding and the chat assistant all work fully without a single SRK. Nothing core depends on it, and nothing ever will.",
  ],
  [
    "It buys one optional thing",
    "Activating a Sparky Broker. You retire SRK once, and that broker carries Premium — deeper analysis, higher limits, advanced analytics — for as long as you hold it. That is the whole utility surface.",
  ],
  [
    "It is a testnet token with a fixed supply",
    "The alpha SRK is a plain 18-decimal ERC-20 deployed for testing. Its entire supply was minted once at creation: there is no mint function and no owner, so the supply can never change. It is deliberately NOT the older, exchange-listed SparkPoint token — only the name and symbol are shared, for familiarity.",
  ],
  [
    "Retiring it does not destroy it",
    "Activating a broker sends SRK to an address nobody controls. The token has no burn function, so the total supply is unchanged — which is why every surface says retired rather than burned.",
  ],
  [
    "It is not an investment",
    "No yield accrues to it, it confers no claim on the vault or on protocol fees, and SparkPoint quotes no dollar price for it — there is no oracle.",
  ],
];

export default function Page() {
  const srk = getAddresses(SRK_CHAIN).srk;

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>SRK</h1>
          <div className="sub">A non-essential utility token. Nothing core depends on it.</div>
        </div>
      </div>

      {/* 043 — the faucet lives HERE now, not on /premium. Premium is no longer something you buy
          with SRK, so the acquire path belongs beside the token it hands out. */}
      <SrkFaucetCard />

      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
          background: "var(--info-subtle)",
          borderColor: "color-mix(in srgb,var(--info) 22%,transparent)",
          display: "flex",
          gap: 10,
        }}
      >
        <Icon name="info" size={16} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          SRK never gates the vault, onboarding, or chat. The product works fully without it. Its one
          use is activating a{" "}
          <Link href="/brokers" style={{ color: "var(--primary)" }}>
            Sparky Broker
          </Link>
          , which is what unlocks Premium — and the faucet above is how you get some.
        </span>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-hd">
          <span className="t">What SRK is</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
          {FACTS.map(([title, body]) => (
            <div key={title}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.55, marginTop: 3 }}>
                {body}
              </div>
            </div>
          ))}
        </div>
      </div>

      {srk && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="card-hd">
            <span className="t">The contract</span>
            <span className="lbl">Base Sepolia</span>
          </div>
          <a
            className="mono"
            href={`https://sepolia.basescan.org/token/${srk}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--primary)", fontSize: 12, wordBreak: "break-all" }}
          >
            {srk} ↗
          </a>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
            Verify the fixed supply yourself — the contract exposes no mint path.
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "center" }}>
        <Link href={toHref("fees")} style={{ color: "var(--primary)" }}>
          How we actually make money →
        </Link>
      </div>
    </div>
  );
}
