"use client";

import { ThemeProvider } from "next-themes";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { NetworkProvider } from "@/lib/network";
import { OverlayProvider } from "@/components/overlays/OverlayProvider";
import { UpdateBanner } from "@/components/shell/UpdateBanner";
import { WhatsNewModal } from "@/components/shell/WhatsNewModal";
import { useSession } from "@/lib/auth/useSiwe";

/**
 * Renders nothing. It exists only to keep ONE `useSession()` instance mounted on EVERY route, so the
 * account-binding effect inside it (clears a stale session when the connected wallet switches or
 * disconnects) runs app-wide — even on app routes that never otherwise read the session (e.g.
 * /portfolio) and with no overlay open. Without this, the binding ran only where the session is
 * consumed (/verify, the deposit gate, the avatar menu), so a wallet switch on any other route left
 * the previous wallet's session live until the next such page — the middleware kept admitting it.
 */
function SessionWalletBinder(): null {
  useSession();
  return null;
}

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
            <OverlayProvider>
              {children}
              {/* Feature 006 — force-refresh banner (dormant until NEXT_PUBLIC_FORCE_REFRESH=true). */}
              <UpdateBanner />
              {/* Feature 006 — What's New greeting (opens only when there are unseen changelog entries). */}
              <WhatsNewModal />
              {/* Keep the session bound to the live wallet on every route (see SessionWalletBinder). */}
              <SessionWalletBinder />
            </OverlayProvider>
          </NetworkProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
