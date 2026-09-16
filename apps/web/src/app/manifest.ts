import type { MetadataRoute } from "next";

// Generic PWA manifest baseline (feature: landing prod-readiness). Brand field
// #080C17; icons reference the App Router icon conventions (icon.svg + apple-icon).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sparky — AI-Native Onchain Hedge Fund",
    short_name: "Sparky",
    description:
      "A fully self-custodial, chat-based AI DeFi assistant.",
    start_url: "/",
    display: "standalone",
    background_color: "#080C17",
    theme_color: "#080C17",
    icons: [
      { src: "/icon.png", type: "image/png", sizes: "512x512" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
