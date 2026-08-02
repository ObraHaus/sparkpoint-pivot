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

export function useSelfPremiumStatus(): PremiumStatus {
  const [status, setStatus] = useState<PremiumStatus>({ active: false, untilLabel: null });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/agent/usage/self", {
          headers: { "x-chain-id": "84532" },
          cache: "no-store",
        });
        if (!r.ok || !alive) return;
        const u = (await r.json()) as { tier?: string; expiresAt?: string | null };
        if (alive) setStatus(premiumStatusView(u.tier, u.expiresAt));
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
