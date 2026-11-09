/**
 * 077 + 078 — the ONE live earn review + confirm route.
 *
 * Both entry points (`/vault`'s earn rows and Sparky's earn card) link here with
 * `?protocol=&vault=&mode=&amount=&asset=`. The `protocol` query selects Kamino (Solana), Morpho
 * (Base) or Rhea (NEAR); the shared review/confirm surfaces are reused so the access points cannot
 * diverge. Every protocol has its own independent build flag and all flags default OFF.
 *
 * Rhea also keeps its server-side gate: with `EARN_LIVE_RHEA` unset/false the Rhea branch is a 404,
 * while Kamino/Morpho still render their own disabled notices. The browser build additionally
 * needs `NEXT_PUBLIC_EARN_LIVE_RHEA=true` to show the Rhea entry points.
 */

import { notFound } from "next/navigation";

import { LiveEarnFlow } from "@/components/vault/LiveEarnFlow";
import { RheaLiveEarn } from "@/components/vault/RheaLiveEarn";
import type { LiveEarnMode, LiveEarnProtocol } from "@/lib/earn/liveFlags";
import { serverLiveRheaEnabled } from "@/lib/near/liveEarn";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const protocolParam = first(params.protocol);
  const protocol: LiveEarnProtocol =
    protocolParam === "morpho" ? "morpho" : protocolParam === "rhea" ? "rhea" : "kamino";
  const modeParam = first(params.mode);
  const mode: LiveEarnMode = modeParam === "withdraw" ? "withdraw" : "deposit";

  if (protocol === "rhea") {
    if (!serverLiveRheaEnabled()) notFound();
    return <RheaLiveEarn />;
  }

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Live earn</h1>
          <div className="sub">Review first. Your wallet signs. SparkPoint holds nothing.</div>
        </div>
      </div>
      <LiveEarnFlow
        protocol={protocol}
        vault={first(params.vault)}
        chain={first(params.chain)}
        asset={first(params.asset)}
        mode={mode}
        initialAmount={first(params.amount)}
      />
    </div>
  );
}
