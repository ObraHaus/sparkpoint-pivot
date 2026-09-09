"use client";

/**
 * NetworkLogo — a blockchain network's real logo (sourced online, see `@/lib/logos`) with a colored-dot
 * fallback (the network's brand color) when there's no logo (e.g. Robinhood testnet) or it fails to load.
 */

import { useState } from "react";
import { networkLogoUrl } from "@/lib/logos";

export function NetworkLogo({
  chainId,
  color,
  size = 16,
}: {
  chainId?: number;
  /** Brand color for the fallback dot. */
  color?: string;
  size?: number;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const url = networkLogoUrl(chainId);

  if (url && brokenUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon; onError falls back to the dot
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(url)}
        style={{ width: size, height: size, borderRadius: "50%", flex: "none", objectFit: "cover" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: "50%", background: color ?? "var(--muted-foreground)", flex: "none" }}
    />
  );
}
