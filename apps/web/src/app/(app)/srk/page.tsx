/**
 * /srk — what the SRK utility token is, and (more importantly) what it is NOT. Informational only.
 *
 * 2026-09-18 (operator): the route moved INSIDE Learn (no longer a rail item), the faucet card was
 * removed, and the page now says plainly that this is a placeholder token. Acquisition is a link to
 * the Pons launchpad once that URL is confirmed; until then the card explains without a link.
 */

import Link from "next/link";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/support.css";

/** SRK is Base-Sepolia-only by design (a fixed-supply TEST token, hand-distributed). */
const SRK_CHAIN = APP_DEFAULT_CHAIN_ID;

/**
 * Where to buy SRK — the Pons launchpad. Set this the moment the operator confirms the URL; the
 * card below renders the link only when it is present (never a guessed/broken link).
 */
const PONS_SRK_URL: string | undefined = undefined;

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
    "It is a placeholder token with a fixed supply",
    "A plain 18-decimal ERC-20 for testing. Its entire supply was minted once at creation: there is no mint function and no owner, so the supply can never change. It is deliberately NOT the older, exchange-listed SparkPoint token — only the name and symbol are shared, for familiarity.",
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
          <div className="sub">A placeholder utility token. Nothing core depends on it.</div>
        </div>
      </div>

      {/* Acquisition — no faucet. The launchpad link unlocks when the operator confirms the URL. */}
      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
          background: "var(--info-subtle)",
          borderColor: "color-mix(in srgb,var(--info) 22%,transparent)",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, flex: 1, minWidth: 220 }}>
          <b style={{ color: "var(--foreground)" }}>This is a placeholder token.</b> It exists so the
          mechanics can be tested — it carries no promise, no yield and no claim on anything. If you
          do want some, it is traded on the <b>Pons</b> launchpad.
        </span>
        {PONS_SRK_URL ? (
          <a className="btn btn-primary btn-md" href={PONS_SRK_URL} target="_blank" rel="noreferrer">
            Buy SRK on Pons <Icon name="ext" size={12} />
          </a>
        ) : (
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            Pons link coming
          </span>
        )}
      </div>

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
          , which is what unlocks Premium. It is a placeholder token — nothing core depends on it.
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
            href={explorerAddressUrl(SRK_CHAIN, srk)}
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
