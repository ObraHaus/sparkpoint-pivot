import type { MetadataRoute } from "next";

// Generic PWA manifest baseline (feature: landing prod-readiness). Brand field
// #080C17; icons reference the App Router icon conventions (icon.svg + apple-icon).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SparkPoint — AI-Native Onchain Hedge Fund",
    short_name: "SparkPoint",
    description:
      "A fully self-custodial, chat-based AI DeFi assistant + AI-managed Aave Yield Vault on Base.",
    start_url: "/",
    display: "standalone",
    background_color: "#080C17",
    theme_color: "#080C17",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
