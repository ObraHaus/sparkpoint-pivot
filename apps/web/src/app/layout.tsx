import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sparkpoint.io";
const TAGLINE =
  "A fully self-custodial, chat-based AI DeFi assistant. The protocol can never hold, move, or lose your money.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sparky — AI-Native Onchain Hedge Fund",
    template: "%s — Sparky",
  },
  description: TAGLINE,
  applicationName: "Sparky",
  keywords: ["DeFi", "Base", "Ethereum", "Solana", "NEAR", "AI", "self-custodial", "yield vault", "multi-chain"],
  authors: [{ name: "Sparky" }],
  creator: "Sparky",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Sparky",
    title: "Sparky — AI-Native Onchain Hedge Fund",
    description: TAGLINE,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sparky — AI-Native Onchain Hedge Fund",
    description: TAGLINE,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080C17" },
    { media: "(prefers-color-scheme: light)", color: "#F6F9FE" },
  ],
  colorScheme: "dark light",
};

/**
 * Force DYNAMIC rendering for every page. Without this, Next serves the app HTML from its full-route
 * cache with `s-maxage=31536000` — a browser/CDN that reloads still gets the OLD HTML and therefore
 * the old JS, so a new deployment never reaches an open tab (the force-refresh banner reloads, sees
 * the same stale page, and trips its loop-breaker). `/_next/static` chunks keep their immutable
 * content-hash caching; only the HTML shell is no-store now.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: next-themes sets the theme class on <html> before paint.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
