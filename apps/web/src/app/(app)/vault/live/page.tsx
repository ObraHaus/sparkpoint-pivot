"use client";

/**
 * 077 — the ONE live earn review + confirm route.
 *
 * Both entry points (`/vault`'s earn rows and Sparky's earn card) link here with
 * `?protocol=&vault=&mode=&amount=`. The page only picks the protocol component; the review and
 * the user's wallet confirmation live in the shared `LiveEarnFlow` so the two access points can
 * never diverge. Everything is behind the build flags and off by default.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { LiveEarnFlow } from "@/components/vault/LiveEarnFlow";
import type { LiveEarnMode, LiveEarnProtocol } from "@/lib/earn/liveFlags";

function LiveEarnRoute() {
  const params = useSearchParams();
  const protocolParam = params.get("protocol");
  const protocol: LiveEarnProtocol = protocolParam === "morpho" ? "morpho" : "kamino";
  const modeParam = params.get("mode");
  const mode: LiveEarnMode = modeParam === "withdraw" ? "withdraw" : "deposit";

  return (
    <LiveEarnFlow
      protocol={protocol}
      vault={params.get("vault")}
      chain={params.get("chain")}
      asset={params.get("asset")}
      mode={mode}
      initialAmount={params.get("amount")}
    />
  );
}

function Shell() {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Live earn</h1>
          <div className="sub">Review first. Your wallet signs. SparkPoint holds nothing.</div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Shell />}>
      <LiveEarnRoute />
    </Suspense>
  );
}
