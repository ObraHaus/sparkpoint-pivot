import { notFound } from "next/navigation";

import { RheaXchainReview } from "@/components/vault/RheaXchainReview";
import { serverXchainEnabled } from "@/lib/earn/xchain";

/**
 * 079 — the cross-chain Rhea (071 MCA/1Click) review route.
 *
 * Gated: the route 404s unless `EARN_LIVE_RHEA_XCHAIN` or `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` is
 * exactly "true". A live `dry=false` commit additionally needs the server flag AND the 1Click key
 * presence boolean, enforced by the agent — never by this page.
 */
export const dynamic = "force-dynamic";

export default async function RheaXchainPage({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string; amount?: string; vault?: string; chain?: string }>;
}) {
  if (!serverXchainEnabled()) notFound();
  const params = await searchParams;
  return (
    <RheaXchainReview
      initialOrigin={params.origin}
      initialAmount={params.amount}
      initialVault={params.vault}
    />
  );
}
