"use client";

import { ThemeProvider } from "next-themes";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { NetworkProvider } from "@/lib/network";
import { OverlayProvider } from "@/components/overlays/OverlayProvider";

/**
 * App-wide providers.
 * - next-themes: persists the theme under `sp-theme`, toggles .light/.dark on <html>,
 *   and injects a pre-paint script so there is no flash of the wrong theme.
 * - wagmi + react-query: wallet connectivity (Base) — present but inert in this UI build.
 * - NetworkProvider: active network (Base/Sui) + mock session.
 * - OverlayProvider: Prove-it / wallet / network / notifications / ⌘K / toasts.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="sp-theme" disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <NetworkProvider>
            <OverlayProvider>{children}</OverlayProvider>
          </NetworkProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
