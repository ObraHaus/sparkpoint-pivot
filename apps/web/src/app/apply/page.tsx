import type { Metadata } from "next";
import Link from "next/link";
import { PublicAccessApplicationForm } from "@/components/access/PublicAccessApplicationForm";
import { PubTop } from "@/components/screens/PubTop";
import "@/components/screens/public.css";

/**
 * `/apply` — the standalone alpha application (045).
 *
 * The same form the landing page's closing section carries, on its own address so it can be linked
 * to. That is the whole reason this page exists: the landing is a scroll-driven WebGL sequence and
 * the form is at the bottom of it, which is fine for a visitor reading top to bottom and useless
 * for a message that says "here's where you apply". A URL that goes straight to the form is what
 * gets posted in a Telegram group.
 *
 * A server component (so it can export `metadata`) wrapping the client form, mirroring
 * `/coming-soon`. Public under BOTH middleware gates — see `apps/web/middleware.ts` and the guard
 * in `src/lib/copy/publicPaths.test.ts`.
 */
export const metadata: Metadata = {
  title: "Apply for alpha access — Sparky",
  description:
    "Request access to the Sparky alpha. No wallet connection needed — enter the address you'd " +
    "like whitelisted and an admin will review it by hand.",
};

export default function ApplyPage() {
  return (
    <div className="pubwrap">
      <PubTop />
      <div className="center-stage">
        <main className="connect-card">
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", margin: "0 0 8px" }}>
            Apply for alpha access
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--muted-foreground)",
              margin: "0 0 4px",
            }}
          >
            Sparky is in a gated alpha. Tell us the wallet address you&rsquo;d like whitelisted and
            how to reach you — you don&rsquo;t need to connect anything to apply.
          </p>
          <PublicAccessApplicationForm />
        </main>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted-foreground)",
            marginTop: 18,
            textAlign: "center",
          }}
        >
          Already whitelisted?{" "}
          <Link href="/connect" style={{ color: "var(--primary)" }}>
            Connect your wallet
          </Link>
        </p>
      </div>
    </div>
  );
}
