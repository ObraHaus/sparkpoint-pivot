import type { Metadata } from "next";
import { SparkLogo } from "@/components/ui/SparkLogo";
import { SubscribeForm } from "./SubscribeForm";
import "./coming-soon.css";

// Branded "Coming soon" CTA funnel — the redirect target for every gated route
// while the construction gate is on (feature 003-landing-only-gate). The primary
// (and only) action is the "Get launch updates" newsletter capture, ported from
// the landing's "05 — Fully self-custodial" block. Server component so it keeps
// exporting `metadata`; the interactive form lives in the client SubscribeForm.
// Pulls no gated chunks (logo is a /_next/static build asset; /api/subscribe and
// /_next/static are both gate-allow-listed).
export const metadata: Metadata = {
  title: "Sparky — Coming soon",
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return (
    <main className="cs-main">
      <div className="cs-card">
        <SparkLogo size={60} className="cs-logo" />
        <h1 className="cs-title">Get early access to Sparky</h1>
        <p className="cs-lede">
          Be first to know the moment the AI-native onchain hedge fund goes live.
        </p>
        <SubscribeForm />
      </div>
    </main>
  );
}
