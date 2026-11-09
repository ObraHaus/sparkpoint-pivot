import { notFound } from "next/navigation";

import { serverLiveRheaEnabled } from "@/lib/near/liveEarn";
import { RheaLiveEarn } from "@/components/vault/RheaLiveEarn";

/**
 * 078 — Rhea same-chain live earn (supply + withdraw via the user's own NEAR wallet).
 *
 * Server-gated: with `EARN_LIVE_RHEA` unset/false this route is a 404. The browser build also needs
 * `NEXT_PUBLIC_EARN_LIVE_RHEA=true` to show the entry points. Both default off.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  if (!serverLiveRheaEnabled()) notFound();
  return <RheaLiveEarn />;
}
