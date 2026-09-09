import type { Metadata } from "next";
import Link from "next/link";

/**
 * `/geo-blocked` — the compliance notice the edge geo-fence (src/middleware.ts,
 * T026) redirects a known-restricted region to. Deliberately standalone and
 * dependency-light (no app shell, no wallet/agent), because it renders for users
 * the app surfaces are gated from.
 *
 * Non-custody (N2 / FR-044 / SC-014): being geo-fenced NEVER blocks withdrawal or
 * provability. This page prominently links the two surfaces the middleware always
 * lets through — `/exit` (the direct on-chain withdraw escape hatch) and `/trust`
 * (the Trust Center) — so a restricted user can still get their funds out and
 * verify what the protocol can and cannot do.
 */
export const metadata: Metadata = {
  title: "Region restricted",
  description:
    "The SparkPoint app is not available in your region. Withdrawals and the Trust Center remain fully accessible — the protocol can never hold or move your funds.",
  robots: { index: false, follow: false },
};

export default function GeoBlockedPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "var(--bg, #0b0e14)",
        color: "var(--fg, #e7ecf3)",
      }}
    >
      <div style={{ maxWidth: "34rem", textAlign: "center" }}>
        <p
          style={{
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.7,
            marginBottom: "0.75rem",
          }}
        >
          Region restricted
        </p>
        <h1 style={{ fontSize: "1.6rem", lineHeight: 1.25, marginBottom: "1rem" }}>
          The SparkPoint app isn&rsquo;t available in your region
        </h1>
        <p style={{ opacity: 0.85, lineHeight: 1.6, marginBottom: "1.75rem" }}>
          Access to the app surfaces is restricted here for compliance. This does{" "}
          <strong>not</strong> affect your funds: SparkPoint is fully
          self-custodial, so the protocol can never hold, move, or freeze your
          money. You can always withdraw directly on-chain and verify exactly what
          the protocol can and cannot do.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/exit"
            style={{
              padding: "0.7rem 1.25rem",
              borderRadius: "0.6rem",
              background: "var(--accent, #3b6ef2)",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Withdraw my funds
          </Link>
          <Link
            href="/trust"
            style={{
              padding: "0.7rem 1.25rem",
              borderRadius: "0.6rem",
              border: "1px solid var(--border, #2a3140)",
              color: "inherit",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Open the Trust Center
          </Link>
        </div>
      </div>
    </main>
  );
}
