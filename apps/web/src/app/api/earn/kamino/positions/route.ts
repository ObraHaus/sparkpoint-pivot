/**
 * 077 — read-only Kamino position read-back for the connected Solana wallet.
 *
 * Calls Kamino's public user-positions endpoint, keeps only the curated vaults, and attaches the
 * vault's `tokensPerShare` so the UI can show an estimated underlying amount. It reads only; it
 * never signs or moves anything.
 */

import { NextResponse } from "next/server";

import { isValidAddress } from "@/lib/crosschain/address";
import { kaminoServerLiveEnabled } from "@/lib/earn/liveFlags";
import {
  KAMINO_API_URL,
  applyDecimalRate,
  formatTokenAmount,
  parseKaminoPositions,
  findKaminoVault,
} from "@/lib/earn/kaminoLive";

export const dynamic = "force-dynamic";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  if (!kaminoServerLiveEnabled()) {
    return jsonError(404, "flag_off", "Live Kamino earn is disabled in this deployment.");
  }

  const wallet = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!isValidAddress(wallet, "sol")) {
    return jsonError(400, "invalid_wallet", "A base58 Solana wallet address is required.");
  }

  let raw: unknown;
  try {
    const response = await fetch(`${KAMINO_API_URL}/kvaults/users/${encodeURIComponent(wallet)}/positions`, {
      headers: { "User-Agent": "sparkpoint-web/1.0" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (response.status === 404) return NextResponse.json({ wallet, positions: [] });
    if (!response.ok) {
      return jsonError(502, "kamino_positions_error", "Kamino could not read that wallet's positions.");
    }
    raw = await response.json();
  } catch {
    return jsonError(502, "kamino_unreachable", "Kamino's positions API could not be reached.");
  }

  const rows = parseKaminoPositions(raw);
  const positions = await Promise.all(
    rows.map(async (row) => {
      const meta = findKaminoVault(row.vaultAddress);
      const metrics = await fetch(`${KAMINO_API_URL}/kvaults/vaults/${row.vaultAddress}/metrics`, {
        headers: { "User-Agent": "sparkpoint-web/1.0" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const tokensPerShare =
        metrics && typeof metrics.tokensPerShare === "string" ? metrics.tokensPerShare : null;
      const estimatedTokens =
        tokensPerShare && meta
          ? (() => {
              const estimate = applyDecimalRate(row.sharesRaw, tokensPerShare);
              return estimate === null ? null : formatTokenAmount(estimate, meta.assetDecimals);
            })()
          : null;
      return {
        vaultAddress: row.vaultAddress,
        vaultName: row.vaultName,
        shares: row.shares,
        tokensPerShare,
        estimatedTokens,
        assetSymbol: meta?.assetSymbol ?? null,
      };
    }),
  );

  return NextResponse.json(
    { wallet, positions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
