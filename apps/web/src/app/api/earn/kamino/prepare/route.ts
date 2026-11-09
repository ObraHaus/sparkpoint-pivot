/**
 * 077 — Kamino unsigned deposit/withdraw transaction proxy.
 *
 * Thin Next wrapper around the pure `prepareKaminoTransaction` handler. It returns Kamino's
 * base64 **unsigned** versioned transaction after validating the flag, the curated allowlist,
 * live vault limits, and the full transaction shape. It never signs or broadcasts.
 */

import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { kaminoServerLiveEnabled } from "@/lib/earn/liveFlags";
import {
  SOLANA_MAINNET_RPC,
  decodeKaminoTransaction,
  resolveKaminoLookupAddresses,
} from "@/lib/earn/kaminoLive";
import { prepareKaminoTransaction } from "@/lib/earn/kaminoPrepare";

export const dynamic = "force-dynamic";

function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || SOLANA_MAINNET_RPC;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await prepareKaminoTransaction(body, {
    enabled: kaminoServerLiveEnabled(),
    fetchImpl: fetch,
    resolveLookupAddresses: async (encodedTransaction) => {
      const transaction = decodeKaminoTransaction(encodedTransaction);
      if (transaction.message.addressTableLookups.length === 0) {
        return { writable: [], readOnly: [] };
      }
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      return resolveKaminoLookupAddresses(connection, transaction);
    },
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
