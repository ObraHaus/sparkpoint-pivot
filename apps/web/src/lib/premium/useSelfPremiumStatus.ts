"use client";

/**
 * The wallet's own plan, from the self-scoped `/usage/self` read — shared by /premium,
 * /premium/pay and Settings → Account so the three surfaces can never disagree.
 *
 * Fail-open: any failure (offline, non-beta 403, agent down) reads as "not premium", which
 * renders each surface's pre-existing free-state UI — a tier hiccup can never hide the upgrade
 * path or invent a subscription.
 */

import { useEffect, useState } from "react";

import { premiumStatusView, type PremiumStatus } from "@/lib/premium/tierStatus";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

export function useSelfPremiumStatus(): PremiumStatus {
  const [status, setStatus] = useState<PremiumStatus>({ active: false, untilLabel: null });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/agent/usage/self", {
          headers: { "x-chain-id": APP_CHAIN_ID_HEADER },
          cache: "no-store",
        });
        if (!r.ok || !alive) return;
        const u = (await r.json()) as {
          tier?: string;
          expiresAt?: string | null;
          // 043 — which source is paying, so /premium can say what would END the access.
          premiumSource?: "broker" | "stored" | null;
          brokerTokenId?: number | null;
        };
        if (alive) {
          setStatus({
            ...premiumStatusView(u.tier, u.expiresAt),
            source: u.premiumSource ?? null,
            brokerTokenId: u.brokerTokenId ?? undefined,
          });
        }
      } catch {
        /* advisory only — fall back to the free rendering */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
