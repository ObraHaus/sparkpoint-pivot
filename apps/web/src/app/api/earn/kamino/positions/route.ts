/**
 * 077 — read-only Kamino position read-back for the connected Solana wallet.
 *
 * Thin Next wrapper around the pure `readKaminoPositions` handler: flag-gated, curated-vault
 * filtered, read-only.
 */

import { NextResponse } from "next/server";

import { kaminoServerLiveEnabled } from "@/lib/earn/liveFlags";
import { readKaminoPositions } from "@/lib/earn/kaminoPositions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  const result = await readKaminoPositions(wallet, {
    enabled: kaminoServerLiveEnabled(),
    fetchImpl: fetch,
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
