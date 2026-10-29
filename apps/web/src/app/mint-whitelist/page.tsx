import type { Metadata } from "next";
import Link from "next/link";
import { PublicAccessApplicationForm } from "@/components/access/PublicAccessApplicationForm";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

/**
 * `/mint-whitelist` — the Sparky Broker GTD/FCFS mint whitelist application.
 *
 * The collection (5,555 on Robinhood Chain, minted through OpenSea/SeaDrop) opens in stages:
 * Treasury, GTD, FCFS, then Public. Wallets on the GTD/FCFS allowlists mint earlier and at the
 * capped allowlist price, so this page collects the wallets an operator can hand to the allowlist.
 *
 * Same public shape as `/apply` — no wallet, no signature, a standalone address so it can be
 * posted in Telegram/Discord and linked from both landings. It does NOT grant app access: the
 * beta application is still `/apply`, and the two lists are deliberately separate (see migration
 * 0042).
 *
 * A server component (so it can export `metadata`) wrapping the client form. Public under BOTH
 * middleware gates — see `apps/web/middleware.ts` and `src/lib/copy/publicPaths.test.ts`.
 */
export const metadata: Metadata = {
  title: "Sparky Broker mint whitelist — Sparky",
  description:
    "Apply for the Sparky Broker GTD/FCFS mint whitelist. 5,555 brokers, minting on OpenSea — no " +
    "wallet connection needed to apply.",
};

const SUBMITTED_MESSAGE =
  "You're on the list — your wallet will be added to the Sparky Broker mint whitelist. " +
  "Whitelisted wallets mint first in the GTD/FCFS stages; we'll reach you on the contact you gave. " +
  "You don't need to keep this page open.";

export default function MintWhitelistPage() {
  return (
    <div className="pubwrap">
      <PubTop />
      <div className="center-stage">
        <main className="connect-card">
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", margin: "0 0 8px" }}>
            Apply for the Sparky Broker mint whitelist
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--muted-foreground)",
              margin: "0 0 4px",
            }}
          >
            Sparky Broker is a collection of <b>5,555</b> NFTs on Robinhood Chain, minting through
            OpenSea in stages — <b>Treasury</b>, <b>GTD</b>, <b>FCFS</b>, then Public. Whitelisted
            wallets mint first, at the allowlist price. Tell us the wallet address you&rsquo;d like
            whitelisted — one spot per wallet, and you don&rsquo;t need to connect anything to
            apply.
          </p>
          <PublicAccessApplicationForm
            program="mint_whitelist"
            submitLabel="Apply for mint whitelist"
            successMessage={SUBMITTED_MESSAGE}
            reasonLabel="Why do you want a Sparky Broker?"
            reasonPlaceholder="A sentence or two is plenty."
            finePrint="Applying grants nothing on-chain and moves no funds — an operator adds approved wallets to the mint allowlist. We only use your contact to tell you the mint schedule."
          />
        </main>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted-foreground)",
            marginTop: 18,
            textAlign: "center",
          }}
        >
          Want to see the collection?{" "}
          <a
            href="https://opensea.io/collection/sparkybroker"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--primary)" }}
          >
            View on OpenSea
          </a>
          {" · "}
          <Link href="/" style={{ color: "var(--primary)" }}>
            Back to landing
          </Link>
        </p>
      </div>
    </div>
  );
}
