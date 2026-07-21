"use client";

/**
 * TokenLogo — a token's real logo (sourced online, see `@/lib/logos`) with a letter-avatar fallback.
 *
 * Decorative only: the logo is NEVER a trust signal (the verified/unverified badge is authoritative).
 * A broken/missing image falls back to a deterministic colored initials avatar. Failure is tracked per
 * URL so the correct art shows again when the token changes — no effect / no stale-fallback state.
 */

import { useState } from "react";
import { avatarColor, tokenLogoUrl, type LogoToken } from "@/lib/logos";

export function TokenLogo({
  token,
  chainId,
  size = 22,
}: {
  token: LogoToken;
  chainId?: number;
  size?: number;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const url = tokenLogoUrl(chainId, token);

  if (url && brokenUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny remote icon; onError falls back to the avatar
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(url)}
        style={{ width: size, height: size, borderRadius: "50%", flex: "none", background: "var(--muted)", objectFit: "cover" }}
      />
    );
  }

  const initials = token.symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: avatarColor(token.symbol),
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(8, Math.round(size * 0.36)),
        fontWeight: 700,
        letterSpacing: 0.2,
        flex: "none",
      }}
    >
      {initials}
    </span>
  );
}
