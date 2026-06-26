import type { Metadata } from "next";
import Link from "next/link";

// Branded "Coming soon" page — the redirect target for every gated route while
// the construction gate is on (feature 003-landing-only-gate). Plain server
// component: no client providers, no Three.js, pulls no gated chunks.
export const metadata: Metadata = {
  title: "SparkPoint — Coming soon",
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background:
          "radial-gradient(120% 120% at 50% 0%, #0a1326 0%, #04070e 60%)",
        color: "#e7ecf5",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          aria-hidden
          style={{ marginBottom: "1.5rem" }}
        >
          <defs>
            <linearGradient id="cs-spark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff6b5e" />
              <stop offset="50%" stopColor="#ffc94d" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <path
            d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"
            fill="url(#cs-spark)"
          />
        </svg>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 0.75rem",
          }}
        >
          SparkPoint is under construction
        </h1>
        <p style={{ margin: "0 0 1.75rem", lineHeight: 1.6, color: "#9aa6bd" }}>
          We&rsquo;re putting the finishing touches on the app. The full
          experience &mdash; your AI DeFi assistant and the Aave Yield Vault
          &mdash; is coming soon.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "0.7rem 1.4rem",
            borderRadius: 999,
            background: "#e7ecf5",
            color: "#04070e",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
